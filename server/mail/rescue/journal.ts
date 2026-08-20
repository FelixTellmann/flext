import { db } from "@server/db/drizzle";
import { action, mailbox, message, senderPolicy } from "@server/db/schema";
import { APPLIED_STATUS } from "@server/mail/actions/executor";
import { isSentByMeSql, threadGroupKeySql } from "@server/mail/query/signal-sql";
import type {
  LiveMessageFacts,
  PolicySuspensionEntry,
  RescueCandidateRow,
  RescueCursor,
  RescuePort,
  RescueStampEntry,
} from "@server/mail/rescue/detect";
import { messageAddressKey } from "@server/mail/rescue/detect";
import type { MessageAddress } from "@server/mail/rescue/locate";
import type { MailboxFlavor } from "@server/mail/types";
import { parseMailboxFlavor, parseStringList } from "@server/mail/types";
import type { SQL } from "drizzle-orm";
import { and, asc, eq, gt, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";

// The only drizzle-backed implementation of the rescue port, kept out of detect.ts so a test importing
// the pass cannot reach a real connection: every DATABASE_URL variant points at the same production
// MySQL, holding 44,102 live Action rows and 103 live policies.

// §8.1 defines a full shadow cycle as 30 days with zero rescues, and the detector's window must be at
// least as long as that gate: a window of, say, 7 days would let a policy accrue rescue-free days out of
// rows the detector had already stopped watching, so the gate would be measuring SILENCE rather than
// safety. Exactly 30 keeps the steady-state candidate set to 30 days of applies rather than the whole
// journal.
//
// The window is also what makes the ascending order safe. `rescuedAt IS NULL` is an exit condition that
// fires only on the rare event this design hopes never happens, so with it alone the oldest un-rescued
// rows sort first, fill every batch, and never leave — freezing the head of the list and never examining
// a newly applied action again, while still reporting a healthy-looking `examined: N, rescued: 0`. An
// age window always fires, so every candidate leaves the set on its own.
//
// The cost, stated rather than hidden: a rescue signalled on day 31 or later is not detected. That is a
// strictly smaller blind spot than the `starred` gap signals.ts already states openly.
const RESCUE_WINDOW_DAYS = 30;

type MailboxSentConfig = { flavor: MailboxFlavor; sent_folders: string[] };

// Memoized per port instance, not per call: the flavour and sent-folder list are configuration, they do
// not change inside a run, and re-reading them once per candidate was the cheap third of the per-address
// cost. Held in the factory's closure rather than at module scope so a long-lived process cannot serve a
// mailbox whose configuration the operator has since edited.
async function resolveSentConfig(cache: Map<string, MailboxSentConfig>, mailbox_id: string): Promise<MailboxSentConfig> {
  const cached = cache.get(mailbox_id);
  if (cached !== undefined) {
    return cached;
  }

  const loaded = await loadMailboxSentConfig(mailbox_id);
  cache.set(mailbox_id, loaded);
  return loaded;
}

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
// The age window (see RESCUE_WINDOW_DAYS) is what stops the oldest rows from occupying every batch
// forever; ascending order then means the longest-unjudged row inside the window goes first.
//
// `after` is keyset pagination on that same (appliedAt, id) order, not OFFSET: detectRescues calls this
// in a loop to walk the whole window chunk by chunk, and the candidate set shifts under a running pass as
// rows get stamped — OFFSET counts POSITION in that shifting set, which skips or repeats rows depending on
// which direction it shifted. `(appliedAt, id) > (after.appliedAt, after.actionId)` names an identity
// instead, so a row stamped mid-pass simply stops matching `rescuedAt IS NULL` and drops out cleanly.
async function loadRescueCandidates(input: {
  mailbox_id: string;
  batch_size: number;
  after: RescueCursor | null;
}): Promise<RescueCandidateRow[]> {
  if (input.mailbox_id.length === 0) {
    throw new Error("loadRescueCandidates needs a mailbox id: an unscoped sweep would read applied actions across every mailbox at once.");
  }
  if (!Number.isInteger(input.batch_size) || input.batch_size < 1) {
    throw new Error(
      `loadRescueCandidates needs a positive batch size, got ${input.batch_size}. The caller bounds how much of the journal one round trip reads.`,
    );
  }

  const cursor_condition =
    input.after === null
      ? undefined
      : (or(
          gt(action.applied_at, input.after.applied_at),
          and(eq(action.applied_at, input.after.applied_at), gt(action.id, input.after.action_id)),
        ) as SQL);

  const clauses: SQL[] = [
    eq(action.status, APPLIED_STATUS) as SQL,
    eq(action.mailbox_id, input.mailbox_id) as SQL,
    isNull(action.rescued_at) as SQL,
    isNotNull(action.applied_at) as SQL,
    sql`${action.applied_at} > NOW() - INTERVAL ${sql.raw(String(RESCUE_WINDOW_DAYS))} DAY`,
  ];
  if (cursor_condition !== undefined) {
    clauses.push(cursor_condition);
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
    .where(and(...clauses))
    .orderBy(asc(action.applied_at), asc(action.id))
    .limit(input.batch_size);

  // applied_at narrows here rather than in a cast: the WHERE clause already excludes the null case, and
  // a row that somehow arrived without one is dropped rather than turned into a judgement against
  // whatever `new Date(null)` would produce.
  return rows.flatMap((row) => (row.applied_at === null ? [] : [{ ...row, applied_at: row.applied_at }]));
}

// The newest sent-by-me message per thread, for the WHOLE mailbox, in one grouped scan — the shape
// loadThreadFacts in server/mail/shadow/run.ts and the sent-config join in
// server/mail/query/needs-action.ts already use. Per-address it would be a scan each time:
// `COALESCE(threadKey, id) = ?` cannot use an index (the only Message indexes are on mailbox/folder/uid,
// gmMsgid, messageId, senderId, fromAddress and internalDate), so one query per candidate is one scan per
// candidate.
//
// Both halves come from signal-sql.ts rather than being respelled: a folder-only "sent by me" is
// permanently false on Gmail (measured: folder finds 1012/0/0/0 across the four mailboxes, the \Sent
// label finds 0/35/96/124), and the group key must be the same COALESCE the rest of the system groups
// threads by, or a null threadKey silently matches nothing. The sent-by-me predicate also does most of
// the volume reduction here: it is applied before the grouping, so the aggregate runs over the mailbox's
// sent mail (~1,012 rows) rather than all ~30,000 of its messages.
async function loadLastSentByMeByThread(input: { mailbox_id: string; config: MailboxSentConfig }): Promise<Map<string, Date>> {
  const group_key = threadGroupKeySql();

  const rows = await db
    .select({ group_key: group_key.as("group_key"), last_reply_at: sql<Date | null>`MAX(${message.internal_date})` })
    .from(message)
    .where(
      and(
        eq(message.mailbox_id, input.mailbox_id),
        isSentByMeSql(input.config.flavor, input.config.sent_folders),
        isNull(message.disappeared_at),
      ),
    )
    .groupBy(group_key);

  const by_thread = new Map<string, Date>();
  for (const row of rows) {
    if (row.last_reply_at !== null) {
      by_thread.set(row.group_key, row.last_reply_at);
    }
  }
  return by_thread;
}

function liveMessageWhere(mailbox_id: string, addresses: MessageAddress[]): SQL {
  const row_ids = addresses.flatMap((address) => (address.by === "row" ? [address.message_id] : []));
  const moved = addresses.flatMap((address) => (address.by === "address" ? [address] : []));

  const clauses: SQL[] = [];
  if (row_ids.length > 0) {
    clauses.push(inArray(message.id, row_ids) as SQL);
  }
  for (const address of moved) {
    clauses.push(
      and(eq(message.folder, address.folder), eq(message.uid, address.uid), eq(message.uid_validity, address.uid_validity)) as SQL,
    );
  }

  // The mailbox scope is AND-ed outside the OR, never repeated inside it: one missing copy would let a
  // (folder, uid) pair from another mailbox answer for this one.
  return and(eq(message.mailbox_id, mailbox_id), or(...clauses) as SQL) as SQL;
}

// `disappearedAt` is deliberately NOT filtered here, and deliberately IS filtered in the reply search
// above. The asymmetry is the point: this read asks "did the operator open THIS message?", and an
// openedAt already stamped on the row stays true evidence even if they deleted the message afterwards —
// filtering would discard exactly those rescues. The reply search asks "is there a sent message in this
// thread?", where a vanished row is a copy the sync has already superseded, and counting it would date
// the reply from a row no longer describing the mailbox.
//
// Three queries per BATCH — the rows, the mailbox's sent config (memoized), the thread aggregate — where
// the per-address version cost three per CANDIDATE, two of them full scans.
function createLiveMessageLoader(sent_config_by_mailbox: Map<string, MailboxSentConfig>) {
  return async (input: { mailbox_id: string; addresses: MessageAddress[] }): Promise<Map<string, LiveMessageFacts>> => {
    const live_by_key = new Map<string, LiveMessageFacts>();
    if (input.addresses.length === 0) {
      return live_by_key;
    }

    const rows = await db
      .select({
        id: message.id,
        folder: message.folder,
        uid: message.uid,
        uid_validity: message.uid_validity,
        subject: message.subject,
        opened_at: message.opened_at,
        group_key: threadGroupKeySql().as("group_key"),
      })
      .from(message)
      .where(liveMessageWhere(input.mailbox_id, input.addresses));

    const config = await resolveSentConfig(sent_config_by_mailbox, input.mailbox_id);
    const last_reply_by_thread = await loadLastSentByMeByThread({ mailbox_id: input.mailbox_id, config });

    // Keyed under BOTH spellings, because the caller asked under exactly one of them and this query
    // cannot tell which: an address lookup and a row lookup can land on the same row.
    for (const row of rows) {
      const facts: LiveMessageFacts = {
        subject: row.subject,
        opened_at: row.opened_at,
        last_reply_at: last_reply_by_thread.get(row.group_key) ?? null,
      };
      live_by_key.set(messageAddressKey({ by: "row", message_id: row.id }), facts);
      live_by_key.set(messageAddressKey({ by: "address", folder: row.folder, uid: row.uid, uid_validity: row.uid_validity }), facts);
    }

    return live_by_key;
  };
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
//
// The boolean is that guard's answer coming back out: affectedRows is 0 exactly when the WHERE matched
// nothing, which here means the policy was already suspended (or gone). Every row this statement matches
// does change, because the guard requires the column to be null and the SET writes a non-null date.
async function suspendPolicy(entry: PolicySuspensionEntry): Promise<boolean> {
  const [header] = await db
    .update(senderPolicy)
    .set({ suspended_at: entry.suspended_at, suspension_reason: entry.reason, updatedAt: new Date() })
    .where(and(eq(senderPolicy.id, entry.sender_policy_id), isNull(senderPolicy.suspended_at)));

  return header.affectedRows > 0;
}

export function createDatabaseRescuePort(): RescuePort {
  return { loadRescueCandidates, loadLiveMessages: createLiveMessageLoader(new Map()), markRescued, suspendPolicy };
}
