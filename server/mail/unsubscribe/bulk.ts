import { db } from "@server/db/drizzle";
import { action, mailbox, message } from "@server/db/schema";
import { createDatabasePromotionPort, promotePolicyAutonomy } from "@server/mail/actions/autonomy";
import { executeActions } from "@server/mail/actions/executor";
import { createDatabaseJournal } from "@server/mail/actions/journal";
import { classifyMailboxError } from "@server/mail/errors";
import { mailboxConnection } from "@server/mail/mailbox";
import { createImapProvider } from "@server/mail/providers/imap";
import type { PolicyRow } from "@server/mail/query/policies";
import { loadPolicyIndex, upsertPolicy } from "@server/mail/query/policies";
import type { PendingSenderAction } from "@server/mail/shadow/run";
import { journalSenderArchives } from "@server/mail/shadow/run";
import { parseMailboxFlavor } from "@server/mail/types";
import type { UnsubscribeAttemptRecord } from "@server/mail/unsubscribe/attempts";
import { recordUnsubscribeAttempt } from "@server/mail/unsubscribe/attempts";
import { performOneClick } from "@server/mail/unsubscribe/one-click";
import type { SenderArchiveSummary } from "@server/mail/unsubscribe/outcome";
import { dedupeAddresses, pickOneClickTarget, summarizeSenderArchive } from "@server/mail/unsubscribe/outcome";
import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";

// docs/decisions/2026-09-06-unsubscribe-button-and-digest-links.md: the button does three things per
// ticked sender, in this order, each recorded even when the one before it failed — a POST that timed out
// is no reason to keep receiving the list, and the rule is what hides what still arrives.

// The rules this button creates carry their own source so /admin/senders can tell "the operator
// unsubscribed" from "the operator assigned archive".
export const UNSUBSCRIBE_POLICY_SOURCE = "unsubscribe";

export type SenderPolicyOutcome = "created" | "promoted" | "left";

export type UnsubscribeSenderOutcome = SenderArchiveSummary & {
  from_address: string;
  attempt: UnsubscribeAttemptRecord | null;
  policy: SenderPolicyOutcome;
  // Anything a step threw, worded for the result table; the steps after it still ran.
  errors: string[];
};

export type UnsubscribeBulkResult = {
  senders: UnsubscribeSenderOutcome[];
  mailbox_errors: { label: string; error: string }[];
  // Rows past the per-mailbox cap, or in a disabled mailbox, wait as shadow rows under the policy at
  // auto; the next tick promotes and executes them.
  more_waiting: boolean;
};

export type UnsubscribeBulkInput = {
  from_addresses: string[];
  // The executor's batch size: how many rows per mailbox this press executes before the rest wait.
  pending_cap: number;
};

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Step (a): the newest message from this sender that offers the one-click route, POSTed once. Skipped,
// and recorded as such, when no message does — a mailto-only sender waits for phase 7's sender.
async function attemptOneClick(from_address: string, now: Date): Promise<UnsubscribeAttemptRecord> {
  const rows = await db
    .select({
      mailbox_id: message.mailbox_id,
      list_unsubscribe: message.list_unsubscribe,
      list_unsubscribe_post: message.list_unsubscribe_post,
    })
    .from(message)
    .where(
      and(
        sql`LOWER(${message.from_address}) = LOWER(${from_address})`,
        isNotNull(message.list_unsubscribe_post),
        isNull(message.disappeared_at),
      ),
    )
    .orderBy(desc(message.internal_date))
    .limit(10);

  const target = pickOneClickTarget(rows);
  if (target === null) {
    return recordUnsubscribeAttempt({
      sender_address: from_address,
      mailbox_id: null,
      method: "http",
      status: "skipped",
      response_code: null,
      error: "no message from this sender carries List-Unsubscribe-Post with an http List-Unsubscribe target",
      attempted_at: now,
    });
  }

  const outcome = await performOneClick({ url: target.url });
  return recordUnsubscribeAttempt({
    sender_address: from_address,
    mailbox_id: target.mailbox_id,
    method: "http",
    status: outcome.status,
    response_code: outcome.response_code,
    error: outcome.error,
    attempted_at: now,
  });
}

// Step (b): an archive rule for the address, marked read, at auto. An existing rule that says anything
// but archive is the operator's earlier call and is left alone; an existing archive rule is promoted,
// and re-asserted with mark_read when it lacked it, because the decision says "marked read" and the
// executor reads that flag off the policy.
async function ensureArchivePolicy(input: {
  from_address: string;
  existing: PolicyRow | undefined;
}): Promise<{ outcome: SenderPolicyOutcome; sender_policy_id: string | null; error: string | null }> {
  const { existing } = input;
  if (existing !== undefined && existing.action !== "archive") {
    return { outcome: "left", sender_policy_id: null, error: null };
  }

  let policy = existing;
  if (policy === undefined || !policy.mark_read) {
    policy = await upsertPolicy({
      scope: "address",
      value: policy?.value ?? input.from_address,
      action: "archive",
      client: policy?.client ?? null,
      topic: policy?.topic ?? null,
      mark_read: true,
      source: policy?.source ?? UNSUBSCRIBE_POLICY_SOURCE,
    });
  }
  const outcome: SenderPolicyOutcome = existing === undefined ? "created" : "promoted";

  if (policy.autonomy === "auto") {
    return { outcome, sender_policy_id: policy.id, error: null };
  }
  // The button press on a checked list is the review the archive gate asks for: the same act as
  // approving proposals on the shadow page (the decision doc's reasoning).
  const promotion = await promotePolicyAutonomy({
    sender_policy_id: policy.id,
    reviewed_shadow_record: true,
    port: createDatabasePromotionPort(),
  });
  if (promotion.outcome === "refused") {
    return { outcome, sender_policy_id: null, error: `promotion refused (${promotion.gate}): ${promotion.detail}` };
  }
  return { outcome, sender_policy_id: policy.id, error: null };
}

// Step (c)'s second half: the pending rows, per mailbox, through the same executor the Apply button
// uses — narrowed to exactly this press's ids, so an approved-but-unapplied backlog is not swept along.
async function executePending(input: {
  by_mailbox: { mailbox_id: string; pending: PendingSenderAction[] }[];
  pending_cap: number;
}): Promise<{ statuses: Map<string, string>; mailbox_errors: UnsubscribeBulkResult["mailbox_errors"] }> {
  const mailbox_errors: UnsubscribeBulkResult["mailbox_errors"] = [];
  const all_ids: string[] = [];

  for (const entry of input.by_mailbox) {
    if (entry.pending.length === 0) {
      continue;
    }
    all_ids.push(...entry.pending.map((row) => row.action_id));
    const [row] = await db.select().from(mailbox).where(eq(mailbox.id, entry.mailbox_id)).limit(1);
    if (row === undefined || !row.enabled) {
      mailbox_errors.push({ label: row?.label ?? entry.mailbox_id, error: "mailbox is disabled; its rows stay pending for Apply" });
      continue;
    }

    let provider: Awaited<ReturnType<typeof createImapProvider>> | null = null;
    try {
      provider = await createImapProvider(mailboxConnection(row));
      await executeActions({
        mailbox_id: row.id,
        flavor: parseMailboxFlavor(row.flavor),
        provider,
        journal: createDatabaseJournal(),
        batch_size: input.pending_cap,
        hierarchy_delimiter: row.hierarchy_delimiter ?? "",
        action_ids: entry.pending.map((pending) => pending.action_id),
      });
    } catch (error) {
      // Per-mailbox isolation, as undoByPolicy does it: one dead connection fails that mailbox's rows
      // and leaves the other mailboxes' archives standing.
      const failure = classifyMailboxError(error);
      mailbox_errors.push({ label: row.label, error: `${failure.kind}: ${failure.message}` });
    } finally {
      await provider?.disconnect().catch(() => undefined);
    }
  }

  const statuses = new Map<string, string>();
  if (all_ids.length > 0) {
    const rows = await db.select({ id: action.id, status: action.status }).from(action).where(inArray(action.id, all_ids));
    for (const row of rows) {
      statuses.set(row.id, row.status);
    }
  }
  return { statuses, mailbox_errors };
}

export async function unsubscribeBulk(input: UnsubscribeBulkInput): Promise<UnsubscribeBulkResult> {
  const now = new Date();
  const addresses = dedupeAddresses(input.from_addresses);
  const policy_index = await loadPolicyIndex();

  const attempts = new Map<string, UnsubscribeAttemptRecord | null>();
  const policies = new Map<string, SenderPolicyOutcome>();
  const errors = new Map<string, string[]>();
  const to_archive: { from_address: string; sender_policy_id: string }[] = [];

  for (const from_address of addresses) {
    const sender_errors: string[] = [];
    errors.set(from_address, sender_errors);

    try {
      attempts.set(from_address, await attemptOneClick(from_address, now));
    } catch (error) {
      attempts.set(from_address, null);
      sender_errors.push(`unsubscribe request: ${describeError(error)}`);
    }

    try {
      const policy = await ensureArchivePolicy({ from_address, existing: policy_index.by_address.get(from_address.toLowerCase()) });
      policies.set(from_address, policy.outcome);
      if (policy.error !== null) {
        sender_errors.push(`rule: ${policy.error}`);
      }
      if (policy.sender_policy_id !== null) {
        to_archive.push({ from_address, sender_policy_id: policy.sender_policy_id });
      }
    } catch (error) {
      policies.set(from_address, "left");
      sender_errors.push(`rule: ${describeError(error)}`);
    }
  }

  const journal = await journalSenderArchives({ senders: to_archive, pending_cap: input.pending_cap, now });
  const execution = await executePending({ by_mailbox: journal.by_mailbox, pending_cap: input.pending_cap });

  const senders = addresses.map((from_address) => {
    const key = from_address.toLowerCase();
    const counts = journal.by_sender.get(key) ?? { pending: 0, waiting: 0, refused: 0 };
    const pending_action_ids = journal.by_mailbox.flatMap((entry) =>
      entry.pending.filter((row) => row.from_address === key).map((row) => row.action_id),
    );
    return {
      from_address,
      attempt: attempts.get(from_address) ?? null,
      policy: policies.get(from_address) ?? "left",
      errors: errors.get(from_address) ?? [],
      ...summarizeSenderArchive({ counts, pending_action_ids, statuses: execution.statuses }),
    };
  });

  return {
    senders,
    mailbox_errors: execution.mailbox_errors,
    more_waiting: senders.some((sender) => sender.waiting > 0),
  };
}
