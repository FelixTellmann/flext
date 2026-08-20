import { db } from "@server/db/drizzle";
import { action, mailbox, message, senderPolicy } from "@server/db/schema";
import { APPLIED_STATUS } from "@server/mail/actions/executor";
import { isSentByMeSql, threadGroupKeySql } from "@server/mail/query/signal-sql";
import type { LiveMessageFacts, PolicySuspensionEntry, RescueCandidateRow, RescuePort, RescueStampEntry } from "@server/mail/rescue/detect";
import type { MessageAddress } from "@server/mail/rescue/locate";
import type { MailboxFlavor } from "@server/mail/types";
import { parseMailboxFlavor, parseStringList } from "@server/mail/types";
import { and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm";

// The only drizzle-backed implementation of the rescue port, kept out of detect.ts so a test importing
// the pass cannot reach a real connection: every DATABASE_URL variant points at the same production
// MySQL, holding 44,102 live Action rows and 103 live policies.

type MailboxSentConfig = { flavor: MailboxFlavor; sent_folders: string[] };

async function loadMailboxSentConfig(mailbox_id: string): Promise<MailboxSentConfig> {
  const rows = await db
    .select({ flavor: mailbox.flavor, sent_folders: mailbox.sent_folders })
    .from(mailbox)
    .where(eq(mailbox.id, mailbox_id))
    .limit(1);

  return {
    flavor: parseMailboxFlavor(rows[0]?.flavor ?? "generic"),
    sent_folders: parseStringList(rows[0]?.sent_folders ?? null),
  };
}

// `rescuedAt IS NULL` is HERE, in the query, and not in the caller — that is what makes the pass
// idempotent, and what stops a policy the operator deliberately un-suspended from being suspended again
// by the same evidence on the next run. `appliedAt IS NOT NULL` narrows the column for the same reason
// the status filter exists: §8's test is "after appliedAt", so a row without one has nothing to judge.
async function loadRescueCandidates(input: { mailbox_id: string; batch_size: number }): Promise<RescueCandidateRow[]> {
  if (input.mailbox_id.length === 0) {
    throw new Error("loadRescueCandidates needs a mailbox id: an unscoped sweep would read applied actions across every mailbox at once.");
  }
  if (!Number.isInteger(input.batch_size) || input.batch_size < 1) {
    throw new Error(
      `loadRescueCandidates needs a positive batch size, got ${input.batch_size}. The caller bounds how much of the journal one run reads.`,
    );
  }

  const rows = await db
    .select({
      action_id: action.id,
      message_id: action.message_id,
      sender_policy_id: action.sender_policy_id,
      kind: action.kind,
      to_state_json: action.to_state_json,
      applied_at: action.applied_at,
    })
    .from(action)
    .where(
      and(
        eq(action.status, APPLIED_STATUS),
        eq(action.mailbox_id, input.mailbox_id),
        isNull(action.rescued_at),
        isNotNull(action.applied_at),
      ),
    )
    .orderBy(asc(action.applied_at), asc(action.id))
    .limit(input.batch_size);

  // applied_at narrows here rather than in a cast: the WHERE clause already excludes the null case, and
  // a row that somehow arrived without one is dropped rather than turned into a judgement against
  // whatever `new Date(null)` would produce.
  return rows.flatMap((row) => (row.applied_at === null ? [] : [{ ...row, applied_at: row.applied_at }]));
}

// The newest sent-by-me message in the same thread. Both halves come from signal-sql.ts rather than being
// respelled: a folder-only "sent by me" is permanently false on Gmail (measured: folder finds 1012/0/0/0
// across the four mailboxes, the \Sent label finds 0/35/96/124), and the group key must be the same
// COALESCE the rest of the system groups threads by, or a null threadKey silently matches nothing.
async function loadLastSentByMeAt(input: { mailbox_id: string; group_key: string; config: MailboxSentConfig }): Promise<Date | null> {
  const rows = await db
    .select({ last_reply_at: sql<Date | null>`MAX(${message.internal_date})` })
    .from(message)
    .where(
      and(
        eq(message.mailbox_id, input.mailbox_id),
        sql`${threadGroupKeySql()} = ${input.group_key}`,
        isSentByMeSql(input.config.flavor, input.config.sent_folders),
        isNull(message.disappeared_at),
      ),
    );

  return rows[0]?.last_reply_at ?? null;
}

function liveMessageWhere(mailbox_id: string, address: MessageAddress) {
  if (address.by === "row") {
    return and(eq(message.mailbox_id, mailbox_id), eq(message.id, address.message_id));
  }
  return and(
    eq(message.mailbox_id, mailbox_id),
    eq(message.folder, address.folder),
    eq(message.uid, address.uid),
    eq(message.uid_validity, address.uid_validity),
  );
}

// `disappearedAt` is deliberately NOT filtered. The row this resolves to is the destination the server
// confirmed, and an openedAt already stamped on it is real evidence the operator read the message —
// evidence that stays true if they later deleted it. Filtering here would discard exactly those rescues.
async function loadLiveMessage(input: { mailbox_id: string; address: MessageAddress }): Promise<LiveMessageFacts | null> {
  const rows = await db
    .select({ subject: message.subject, opened_at: message.opened_at, group_key: threadGroupKeySql().as("group_key") })
    .from(message)
    .where(liveMessageWhere(input.mailbox_id, input.address))
    .limit(1);

  const row = rows[0];
  if (row === undefined) {
    return null;
  }

  const config = await loadMailboxSentConfig(input.mailbox_id);
  const last_reply_at = await loadLastSentByMeAt({ mailbox_id: input.mailbox_id, group_key: row.group_key, config });

  return { subject: row.subject, opened_at: row.opened_at, last_reply_at };
}

// Guarded `WHERE rescuedAt IS NULL` for the same reason the load is filtered on it: first stamp wins, so
// a concurrent pass cannot move the moment a rescue was detected.
async function markRescued(entries: RescueStampEntry[]): Promise<void> {
  for (const entry of entries) {
    await db
      .update(action)
      .set({ rescued_at: entry.rescued_at, updatedAt: new Date() })
      .where(and(eq(action.id, entry.action_id), isNull(action.rescued_at)));
  }
}

// Guarded `WHERE suspendedAt IS NULL` in the UPDATE, not in the caller. An already-suspended policy keeps
// its ORIGINAL reason: the first rescue is the one that explains the suspension, and overwriting it
// destroys the evidence the operator needs in order to judge whether to clear it.
async function suspendPolicy(entry: PolicySuspensionEntry): Promise<void> {
  await db
    .update(senderPolicy)
    .set({ suspended_at: entry.suspended_at, suspension_reason: entry.reason, updatedAt: new Date() })
    .where(and(eq(senderPolicy.id, entry.sender_policy_id), isNull(senderPolicy.suspended_at)));
}

export function createDatabaseRescuePort(): RescuePort {
  return { loadRescueCandidates, loadLiveMessage, markRescued, suspendPolicy };
}
