import { db } from "@server/db/drizzle";
import { action, mailbox, message, sender, threadState } from "@server/db/schema";
import { FILE_KIND } from "@server/mail/actions/kinds";
import { SHADOW_STATUS } from "@server/mail/actions/promote";
import type { Decision, DecisionInput, SenderPolicyInput } from "@server/mail/classify/rules";
import { decide, SWEEP_SETTLED_SOURCE } from "@server/mail/classify/rules";
import { deriveSignals } from "@server/mail/classify/signals";
import type { PolicyFilingMapping } from "@server/mail/filing/paths";
import { logicalPathFor } from "@server/mail/filing/paths";
import type { PolicyIndex, PolicyRow } from "@server/mail/query/policies";
import { loadPolicyIndex } from "@server/mail/query/policies";
import { isInInboxSql, isSentByMeSql, resolveThreadState, threadGroupKeySql } from "@server/mail/query/signal-sql";
import type { MailboxFlavor } from "@server/mail/types";
import { parseMailboxFlavor, parseStringList } from "@server/mail/types";
import { and, asc, eq, gt, isNull, lte, notExists, sql } from "drizzle-orm";

// What a pass reports about one message, before anything is journaled. Deliberately narrower than the row
// the pass actually holds: a verification script needs to explain a decision to a human, not to re-derive
// it, and widening this into "the whole row" would make every future column a public surface.
export type DecisionObservation = {
  message_id: string;
  subject: string | null;
  from_address: string | null;
  internal_date: Date;
  replied_in_thread: boolean;
  decision: Decision;
};

export type RunShadowPassInput = {
  mailbox_id: string;
  batch_size: number;
  // An input rather than always minted here because a sweep across several mailboxes is ONE shadow run:
  // getShadowReport and getShadowSummary both scope to a single latest run id, so four mailboxes minting
  // four ids leaves the report describing whichever mailbox finished last.
  run_id: string | null;
  // Decide and report, write nothing. The spec's acceptance test for every phase here has been a full
  // pass over real data measuring what it WOULD have done, and a sweep that had to journal thousands of
  // shadow rows into production before the operator could see a single number is not that test — it is
  // the mutation the test exists to gate.
  dry_run?: boolean;
  // Called once per decided message, before journaling. Lets a script measure a pass without the pass
  // learning how to report.
  onDecision?: (observation: DecisionObservation) => void;
};

export type RunShadowPassResult = { examined: number; journaled: number; by_decision: Record<string, number> };

type ThreadFacts = { replied_in_thread: boolean; last_in_thread_is_mine: boolean };

type ShadowMessageRow = {
  id: string;
  thread_key: string | null;
  from_address: string | null;
  from_domain: string | null;
  subject: string | null;
  is_flagged: boolean;
  has_attachment: boolean;
  to_me: boolean;
  cc_me: boolean;
  dkim_aligned: boolean | null;
  internal_date: Date;
  list_id: string | null;
  list_unsubscribe: string | null;
  precedence: string | null;
  auto_submitted: string | null;
  sender_message_count: number | null;
  my_reply_count: number | null;
  thread_state: string | null;
  thread_snoozed_until: Date | null;
};

export type ShadowActionRow = {
  message_id: string;
  sender_policy_id: string | null;
  mailbox_id: string;
  kind: string;
  source: Decision["source"];
  status: typeof SHADOW_STATUS;
  run_id: string;
  decided_at: Date;
  updatedAt: Date;
  target_path: string | null;
};

async function loadThreadFacts(mailbox_id: string, flavor: MailboxFlavor, sent_folders: string[]): Promise<Map<string, ThreadFacts>> {
  const group_key = threadGroupKeySql();
  const is_mine = isSentByMeSql(flavor, sent_folders);

  const ranked = db.$with("ranked").as(
    db
      .select({
        group_key: group_key.as("group_key"),
        mine: is_mine.as("mine"),
        row_number:
          sql<number>`ROW_NUMBER() OVER (PARTITION BY ${group_key} ORDER BY ${message.internal_date} DESC, ${message.id} DESC)`.as(
            "row_number",
          ),
      })
      .from(message)
      .where(and(eq(message.mailbox_id, mailbox_id), isNull(message.disappeared_at))),
  );

  const rows = await db
    .with(ranked)
    .select({
      group_key: ranked.group_key,
      any_mine: sql<number>`MAX(${ranked.mine})`,
      last_is_mine: sql<number>`MAX(CASE WHEN ${ranked.row_number} = 1 THEN ${ranked.mine} END)`,
    })
    .from(ranked)
    .groupBy(ranked.group_key);

  const facts = new Map<string, ThreadFacts>();
  for (const row of rows) {
    facts.set(row.group_key, {
      replied_in_thread: Number(row.any_mine) > 0,
      last_in_thread_is_mine: Number(row.last_is_mine) > 0,
    });
  }
  return facts;
}

// Inbox-dwell 1.9's candidate set, and its scoping is the exact INVERSE of unclassified_only: that one
// takes mail no Action row has ever named, this one takes mail that was classified, left alone, and has
// since sat read in the inbox past the dwell. The two are complementary by design and must not be merged
// — one is "decide about new mail", the other is "reconsider old mail because time passed".
export type SettledSweepScope = { dwell_days: number; flavor: MailboxFlavor; now: Date };

type MessageBatchQueryInput = {
  mailbox_id: string;
  after_id: string | null;
  batch_size: number;
  unclassified_only: boolean;
  settled_sweep: SettledSweepScope | null;
};

// Exported unexecuted so server/mail/shadow/run.test.ts can assert the scheduled path's NOT EXISTS is
// actually emitted without opening a connection: every DATABASE_URL points at the same production MySQL,
// so a test that ran this would read live data. Calling .toSQL() on the returned builder connects to
// nothing.
export function messageBatchQuery(input: MessageBatchQueryInput) {
  const conditions = [eq(message.mailbox_id, input.mailbox_id), isNull(message.disappeared_at)];
  if (input.after_id !== null) {
    conditions.push(gt(message.id, input.after_id));
  }
  if (input.unclassified_only) {
    // Messages that have never been classified at all — no Action row of any kind, run or status. Cheap
    // because Action_messageId_kind_runId_key leads on messageId. The keyset cursor above still drives the
    // walk, so writing this batch's rows cannot make the next batch skip or repeat anything.
    conditions.push(notExists(db.select({ classified: sql`1` }).from(action).where(eq(action.message_id, message.id))));
  }

  if (input.settled_sweep !== null) {
    const { dwell_days, flavor, now } = input.settled_sweep;
    const cutoff = new Date(now.getTime() - dwell_days * 86_400_000);

    conditions.push(eq(message.is_seen, true));
    conditions.push(lte(message.internal_date, cutoff));
    conditions.push(isInInboxSql(flavor));
    // Decided once per message, never re-decided. Without this the constant SCHEDULED_RUN_ID would make
    // the second sweep collide with the first on Action_messageId_kind_runId_key, and a sweep that keeps
    // re-proposing the same archive every fifteen minutes is noise the operator would learn to ignore.
    conditions.push(
      notExists(
        db
          .select({ swept: sql`1` })
          .from(action)
          .where(and(eq(action.message_id, message.id), eq(action.source, SWEEP_SETTLED_SOURCE))),
      ),
    );
  }

  return db
    .select({
      id: message.id,
      thread_key: message.thread_key,
      from_address: message.from_address,
      from_domain: message.from_domain,
      subject: message.subject,
      is_flagged: message.is_flagged,
      has_attachment: message.has_attachment,
      to_me: message.to_me,
      cc_me: message.cc_me,
      dkim_aligned: message.dkim_aligned,
      internal_date: message.internal_date,
      list_id: message.list_id,
      list_unsubscribe: message.list_unsubscribe,
      precedence: message.precedence,
      auto_submitted: message.auto_submitted,
      sender_message_count: sender.message_count,
      my_reply_count: sender.my_reply_count,
      thread_state: threadState.state,
      thread_snoozed_until: threadState.snoozed_until,
    })
    .from(message)
    .leftJoin(sender, eq(sender.address, message.from_address))
    .leftJoin(threadState, and(eq(threadState.mailbox_id, message.mailbox_id), eq(threadState.thread_key, threadGroupKeySql())))
    .where(and(...conditions))
    .orderBy(asc(message.id))
    .limit(input.batch_size);
}

async function fetchMessageBatch(input: MessageBatchQueryInput): Promise<ShadowMessageRow[]> {
  return messageBatchQuery(input);
}

function toSenderPolicyInput(row: PolicyRow): SenderPolicyInput {
  return { id: row.id, scope: row.scope, value: row.value, action: row.action, suspended_at: row.suspended_at };
}

function selectPolicies(policy_index: PolicyIndex, from_address: string, from_domain: string): SenderPolicyInput[] {
  const policies: SenderPolicyInput[] = [];
  const address_policy = policy_index.by_address.get(from_address.toLowerCase());
  if (address_policy !== undefined) {
    policies.push(toSenderPolicyInput(address_policy));
  }
  const domain_policy = policy_index.by_domain.get(from_domain.toLowerCase());
  if (domain_policy !== undefined) {
    policies.push(toSenderPolicyInput(domain_policy));
  }
  return policies;
}

function buildDecisionInput(
  row: ShadowMessageRow,
  params: { policy_index: PolicyIndex; thread_facts: Map<string, ThreadFacts>; now: Date; settled_sweep_candidate: boolean },
): DecisionInput {
  const from_address = row.from_address ?? "";
  const from_domain = row.from_domain ?? "";

  const signals = deriveSignals({
    list_id: row.list_id,
    list_unsubscribe: row.list_unsubscribe,
    precedence: row.precedence,
    auto_submitted: row.auto_submitted,
    from_address: row.from_address,
    to_me: row.to_me,
    cc_me: row.cc_me,
    dkim_aligned: row.dkim_aligned,
    internal_date: row.internal_date,
    sender_message_count: Number(row.sender_message_count ?? 0),
    my_reply_count: Number(row.my_reply_count ?? 0),
    now: params.now,
  });

  const group_key = row.thread_key ?? row.id;
  const thread_facts = params.thread_facts.get(group_key) ?? { replied_in_thread: false, last_in_thread_is_mine: false };

  return {
    signals,
    from_address,
    from_domain,
    subject: row.subject ?? "",
    is_flagged: row.is_flagged,
    // IMAP's \Flagged flag IS the Gmail star, and writer.ts sets is_flagged from exactly that flag, so
    // is_flagged already carries §5.3's "flagged or starred" signal in full — is_starred stays false
    // because there is no second, distinct signal to read, not because starring is unimplemented.
    is_starred: false,
    has_attachment: row.has_attachment,
    replied_in_thread: thread_facts.replied_in_thread,
    never_touch_rules: params.policy_index.never_touch,
    thread_state: resolveThreadState({ state: row.thread_state, snoozed_until: row.thread_snoozed_until, now: params.now }),
    last_in_thread_is_mine: thread_facts.last_in_thread_is_mine,
    sender_suppressed: params.policy_index.suppressed.has(from_address.toLowerCase()),
    policies: selectPolicies(params.policy_index, from_address, from_domain),
    // True only on the sweep pass. Every row that pass fetches already cleared the candidate test in SQL
    // — in the inbox, seen, older than the dwell — so the flag is a property of the pass, not of the row.
    settled_sweep_candidate: params.settled_sweep_candidate,
  };
}

// The mapping must come from the policy that actually fired, not from any policy that merely matched —
// matchPolicy (rules.ts) already resolved address-over-domain precedence, and decision.source names which
// one won, so this looks the policy back up by that same scope rather than re-deriving precedence here.
function filingMappingFor(
  policy_index: PolicyIndex,
  decision: Decision,
  from_address: string,
  from_domain: string,
): PolicyFilingMapping | null {
  if (decision.source === "address_policy") {
    const row = policy_index.by_address.get(from_address.toLowerCase());
    return row === undefined ? null : { client: row.client, topic: row.topic };
  }
  if (decision.source === "domain_policy") {
    const row = policy_index.by_domain.get(from_domain.toLowerCase());
    return row === undefined ? null : { client: row.client, topic: row.topic };
  }
  return null;
}

// status takes no parameter: every row this module can build is hardcoded to "shadow", so there is no
// code path here that could produce "pending" or "applied" — Phase 4 owns writing those.
export function buildShadowActionRow(input: {
  message_id: string;
  mailbox_id: string;
  decision: Decision;
  mapping: PolicyFilingMapping | null;
  run_id: string;
  now: Date;
}): ShadowActionRow {
  return {
    message_id: input.message_id,
    sender_policy_id: input.decision.policy_id,
    mailbox_id: input.mailbox_id,
    kind: input.decision.action,
    source: input.decision.source,
    status: SHADOW_STATUS,
    run_id: input.run_id,
    decided_at: input.now,
    updatedAt: input.now,
    // The proposal, not the confirmation: §6's destination as the policy names it right now. Null on
    // every kind but `file` — archive and trash take their targets from SPECIAL-USE at execution time,
    // and a path on those rows would be a destination nothing reads.
    target_path: input.decision.action === FILE_KIND && input.mapping !== null ? logicalPathFor(input.mapping) : null,
  };
}

// `status` is deliberately absent from the SET clause, and re-adding it is a data-loss edit. The unique
// key is (messageId, kind, runId) and runShadowPass takes an arbitrary run_id precisely so a sweep across
// several mailboxes is ONE run — so a re-run with the same id meets rows that have since been approved,
// applied or undone. Writing `shadow` back over one of those would leave from_state_json, to_state_json
// and applied_at intact while the journal reported that nothing had been sent to the mailbox, and undo
// requires `applied`: the mutation would stand on the server with no way left to reverse it. A row that
// is genuinely new is unaffected — buildShadowActionRow supplies `status` in the inserted values, so the
// INSERT sets it and the column default is never what this depends on.
async function writeShadowBatch(rows: ShadowActionRow[]): Promise<void> {
  if (rows.length === 0) {
    return;
  }
  await db
    .insert(action)
    .values(rows)
    .onDuplicateKeyUpdate({
      set: {
        sender_policy_id: sql`VALUES(\`senderPolicyId\`)`,
        mailbox_id: sql`VALUES(\`mailboxId\`)`,
        source: sql`VALUES(\`source\`)`,
        // A confirmation is a human vouching for ONE destination, so it survives a re-decision only while
        // that destination is unchanged. Without this, a same-run-id re-run after a policy edit rewrites
        // targetPath while leaving filingConfirmedAt standing, and the row files into the NEW path with
        // the DKIM gate short-circuited by approval of the OLD one.
        // ORDER IS LOAD-BEARING and must stay above target_path: MySQL evaluates ON DUPLICATE KEY UPDATE
        // assignments left to right, and a column read after its own assignment yields the NEW value — so
        // below the next line this comparison would always be true and would never clear anything.
        // `<=>` rather than `=` because both sides are nullable and NULL = NULL is NULL, not true.
        filing_confirmed_at: sql`IF(VALUES(\`targetPath\`) <=> \`targetPath\`, \`filingConfirmedAt\`, NULL)`,
        target_path: sql`VALUES(\`targetPath\`)`,
        decided_at: sql`VALUES(\`decidedAt\`)`,
        updatedAt: sql`VALUES(\`updatedAt\`)`,
      },
    });
}

async function runPass(
  input: RunShadowPassInput & { unclassified_only: boolean; settled_sweep: Omit<SettledSweepScope, "flavor"> | null },
): Promise<RunShadowPassResult> {
  const run_id = input.run_id ?? crypto.randomUUID();
  const now = new Date();

  // Both loaded once, before the batch loop, not per message: ~1,749 senders' worth of policy rows and a
  // full per-thread scan are each one round trip for the whole run, not one per row of ~14,600.
  const [policy_index, mailbox_rows] = await Promise.all([
    loadPolicyIndex(),
    db
      .select({ flavor: mailbox.flavor, sent_folders: mailbox.sent_folders })
      .from(mailbox)
      .where(eq(mailbox.id, input.mailbox_id))
      .limit(1),
  ]);
  const flavor = parseMailboxFlavor(mailbox_rows[0]?.flavor ?? "generic");
  const sent_folders = parseStringList(mailbox_rows[0]?.sent_folders ?? null);
  const thread_facts = await loadThreadFacts(input.mailbox_id, flavor, sent_folders);

  const by_decision: Record<string, number> = {};
  let examined = 0;
  let journaled = 0;
  let after_id: string | null = null;

  for (;;) {
    const batch = await fetchMessageBatch({
      mailbox_id: input.mailbox_id,
      after_id,
      batch_size: input.batch_size,
      unclassified_only: input.unclassified_only,
      settled_sweep: input.settled_sweep === null ? null : { ...input.settled_sweep, flavor },
    });
    if (batch.length === 0) {
      break;
    }

    const rows: ShadowActionRow[] = [];
    for (const row of batch) {
      examined += 1;
      const decision_input = buildDecisionInput(row, {
        policy_index,
        thread_facts,
        now,
        settled_sweep_candidate: input.settled_sweep !== null,
      });
      const decision = decide(decision_input);
      by_decision[decision.action] = (by_decision[decision.action] ?? 0) + 1;
      input.onDecision?.({
        message_id: row.id,
        subject: row.subject,
        from_address: row.from_address,
        internal_date: row.internal_date,
        replied_in_thread: decision_input.replied_in_thread,
        decision,
      });
      const mapping = filingMappingFor(policy_index, decision, row.from_address ?? "", row.from_domain ?? "");
      rows.push(buildShadowActionRow({ message_id: row.id, mailbox_id: input.mailbox_id, decision, mapping, run_id, now }));
    }

    if (input.dry_run !== true) {
      await writeShadowBatch(rows);
      journaled += rows.length;
    }

    after_id = batch[batch.length - 1]?.id ?? after_id;
    if (batch.length < input.batch_size) {
      break;
    }
  }

  return { examined, journaled, by_decision };
}

// The operator's sweep, unchanged: every live message in the mailbox is re-decided. This is the pass a
// policy edit calls for, and it stays something a human asks for from /admin/shadow, because it is also
// the expensive one — one Action row per message per run id.
export async function runShadowPass(input: RunShadowPassInput): Promise<RunShadowPassResult> {
  return runPass({ ...input, unclassified_only: false, settled_sweep: null });
}

// The scheduled sync's pass: only messages that have never been classified. New mail is the only input a
// scheduled classification can have seen change, so re-deciding the rest buys nothing and costs a full
// sweep plus tens of thousands of Action rows every fifteen minutes, growing a table that already holds
// 44,102 rows without bound and invisibly.
//
// What this deliberately gives up: a policy edit does NOT retroactively re-classify old mail on the next
// sync. That is the intended behaviour, not a gap — silently re-deciding thousands of already-reviewed
// messages because a rule changed is exactly what the shadow-and-review cycle exists to prevent. The
// operator re-sweeps from /admin/shadow when they mean to.
export async function runNewMailShadowPass(input: RunShadowPassInput): Promise<RunShadowPassResult> {
  return runPass({ ...input, unclassified_only: true, settled_sweep: null });
}

// Inbox-dwell 1.9's settled sweep. Runs as its own stage after classify-and-execute, never inside it: the
// scheduled classify pass is scoped to mail that has never been classified, and dwell is by definition a
// decision that CHANGES as time passes, so the two need opposite scoping and merging them would destroy
// the classify pass's cost profile.
//
// Read mail that has sat in the inbox past the mailbox's dwell, re-decided through the same ladder as
// everything else — the sweep does not bypass decide(), it is step 6.5 inside it, so every guard, thread
// state and policy still wins (1.8). Journaled at `shadow` like every other new rule; nothing here moves
// mail until the operator promotes it.
export async function runSettledSweepPass(input: RunShadowPassInput & { dwell_days: number; now: Date }): Promise<RunShadowPassResult> {
  // Spread, never a hand-listed field set. The first version of this named its five fields explicitly and
  // silently dropped dry_run and onDecision — so the verification pass that exists to write NOTHING would
  // have journaled a shadow row for every settled message in production, which is the exact mutation it
  // is supposed to gate. Anything added to RunShadowPassInput must reach runPass by default.
  return runPass({
    ...input,
    unclassified_only: false,
    settled_sweep: { dwell_days: input.dwell_days, now: input.now },
  });
}
