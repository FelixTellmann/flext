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
import { sendMail } from "@server/mail/send/smtp";
import type { SenderArchiveJournalResult } from "@server/mail/shadow/run";
import { createDatabaseSenderArchivePort, journalSenderArchives } from "@server/mail/shadow/run";
import { parseMailboxFlavor } from "@server/mail/types";
import type { UnsubscribeAttemptRecord } from "@server/mail/unsubscribe/attempts";
import { recordUnsubscribeAttempt } from "@server/mail/unsubscribe/attempts";
import type { MailtoSource, SendLike } from "@server/mail/unsubscribe/mailto";
import { loadMailtoSources, pickMailtoTarget, unsubscribeMailtoSender } from "@server/mail/unsubscribe/mailto";
import type { OneClickOutcome } from "@server/mail/unsubscribe/one-click";
import { performOneClick } from "@server/mail/unsubscribe/one-click";
import type { OneClickSource, SenderArchiveSummary } from "@server/mail/unsubscribe/outcome";
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
  // One dead connection, or a mailbox switched off: named here per mailbox, because the sender rows only
  // say how many messages did not land, not why.
  mailbox_errors: { label: string; error: string }[];
  // Rows past the per-mailbox cap wait as shadow rows under the policy at auto; the next tick promotes and
  // executes them. Rows in a disabled mailbox wait the same way, but no tick reaches them until it is
  // re-enabled — mailbox_errors says so.
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

// Every message with the header is read, not the newest few: the page's one_click is MAX over all of the
// sender's mail, and the button must find the same target the page promised.
async function loadOneClickSources(from_address: string): Promise<OneClickSource[]> {
  return db
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
        isNotNull(message.list_unsubscribe),
        isNull(message.disappeared_at),
      ),
    )
    .orderBy(desc(message.internal_date));
}

// The seams the tests replace so a run reaches neither the database, the network nor SMTP.
export type UnsubscribeRequestDependencies = {
  loadOneClickSources: (from_address: string) => Promise<OneClickSource[]>;
  loadMailtoSources: (from_address: string) => Promise<MailtoSource[]>;
  performOneClick: (input: { url: string }) => Promise<OneClickOutcome>;
  send: SendLike;
  record: typeof recordUnsubscribeAttempt;
};

const live_request_dependencies: UnsubscribeRequestDependencies = {
  loadOneClickSources,
  loadMailtoSources,
  performOneClick,
  send: sendMail,
  record: recordUnsubscribeAttempt,
};

// Step (a): one request per sender, http before mailto. The newest message offering the one-click route
// is POSTed; failing that, the newest mailto target is emailed from felix@tellmann.co.za; failing both,
// the attempt is recorded as skipped so the chip says why nothing went out.
export async function attemptUnsubscribe(
  from_address: string,
  now: Date,
  dependencies: UnsubscribeRequestDependencies = live_request_dependencies,
): Promise<UnsubscribeAttemptRecord> {
  const one_click = pickOneClickTarget(await dependencies.loadOneClickSources(from_address));
  if (one_click !== null) {
    const outcome = await dependencies.performOneClick({ url: one_click.url });
    return dependencies.record({
      sender_address: from_address,
      mailbox_id: one_click.mailbox_id,
      method: "http",
      status: outcome.status,
      response_code: outcome.response_code,
      error: outcome.error,
      attempted_at: now,
    });
  }

  const mailto_sources = await dependencies.loadMailtoSources(from_address);
  if (pickMailtoTarget(mailto_sources) !== null) {
    return unsubscribeMailtoSender(
      { from_address, now },
      { send: dependencies.send, loadSources: async () => mailto_sources, record: dependencies.record },
    );
  }

  return dependencies.record({
    sender_address: from_address,
    mailbox_id: null,
    method: "http",
    status: "skipped",
    response_code: null,
    error: "no message from this sender carries List-Unsubscribe-Post with an http target, and none carries a mailto target",
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

// Step (c)'s second half: the rows this press claimed, per mailbox, through the same executor the Apply
// button uses — narrowed to exactly those ids, so an approved-but-unapplied backlog is not swept along.
// The journal claims nothing in a disabled mailbox, so its rows never reach here; they are reported.
async function executePending(input: {
  by_mailbox: SenderArchiveJournalResult["by_mailbox"];
  pending_cap: number;
}): Promise<{ statuses: Map<string, string>; mailbox_errors: UnsubscribeBulkResult["mailbox_errors"] }> {
  const mailbox_errors: UnsubscribeBulkResult["mailbox_errors"] = [];
  const all_ids: string[] = [];

  for (const entry of input.by_mailbox) {
    if (!entry.enabled) {
      mailbox_errors.push({ label: entry.label, error: "mailbox disabled, nothing will run until it is re-enabled" });
      continue;
    }
    if (entry.pending.length === 0) {
      continue;
    }
    all_ids.push(...entry.pending.map((row) => row.action_id));
    const [row] = await db.select().from(mailbox).where(eq(mailbox.id, entry.mailbox_id)).limit(1);
    if (row === undefined) {
      mailbox_errors.push({ label: entry.label, error: "mailbox no longer exists; its rows stay pending for Apply" });
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

export async function unsubscribeBulk(
  input: UnsubscribeBulkInput,
  dependencies: UnsubscribeRequestDependencies = live_request_dependencies,
): Promise<UnsubscribeBulkResult> {
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
      attempts.set(from_address, await attemptUnsubscribe(from_address, now, dependencies));
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

  const journal = await journalSenderArchives({
    senders: to_archive,
    pending_cap: input.pending_cap,
    now,
    port: createDatabaseSenderArchivePort(),
  });
  const execution = await executePending({ by_mailbox: journal.by_mailbox, pending_cap: input.pending_cap });

  const senders = addresses.map((from_address) => {
    const key = from_address.toLowerCase();
    const counts = journal.by_sender.get(key) ?? { pending: 0, waiting: 0, retried: 0, refused: 0 };
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
