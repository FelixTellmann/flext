import { db } from "@server/db/drizzle";
import { action, attentionSession, mailbox, message, sender, threadState } from "@server/db/schema";
import type { ActionJournal } from "@server/mail/actions/executor";
import { FAILED_STATUS } from "@server/mail/actions/executor";
import { createDatabaseJournal } from "@server/mail/actions/journal";
import { FILE_KIND } from "@server/mail/actions/kinds";
import { SHADOW_STATUS } from "@server/mail/actions/promote";
import type { Decision, DecisionInput, SenderPolicyInput } from "@server/mail/classify/rules";
import { decide, matchesNeedsActionSignals, SWEEP_DECLINED_SOURCE, SWEEP_SETTLED_SOURCE } from "@server/mail/classify/rules";
import { deriveSignals } from "@server/mail/classify/signals";
import type { PolicyFilingMapping } from "@server/mail/filing/paths";
import { logicalPathFor } from "@server/mail/filing/paths";
import type { PolicyIndex, PolicyRow } from "@server/mail/query/policies";
import { loadPolicyIndex } from "@server/mail/query/policies";
import { isInInboxSql, isSentByMeSql, resolveThreadState, threadGroupKeySql } from "@server/mail/query/signal-sql";
import type { MailboxFlavor } from "@server/mail/types";
import { parseMailboxFlavor, parseStringList } from "@server/mail/types";
import { and, asc, eq, gt, inArray, isNull, lte, notExists, sql } from "drizzle-orm";

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
  is_calendar: boolean | null;
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
// Inbox-dwell 1.9's unread half. Held beside the settled scope rather than merged with it because the two
// candidate sets are disjoint by definition — one is read mail, the other unread — and a single scope
// carrying both would invite a query that asks for neither.
export type DeclinedSweepScope = {
  ordinary_threshold: number;
  needs_action_threshold: number;
  flavor: MailboxFlavor;
  now: Date;
};

export type SettledSweepScope = {
  dwell_days: number;
  // 1.10's floor. A thread the operator replied in needs longer silence than ordinary settled mail before
  // the exemption may act on it — see Mailbox.dwellRepliedDays for the evidence that set the default.
  replied_dwell_days: number;
  flavor: MailboxFlavor;
  now: Date;
};

type MessageBatchQueryInput = {
  mailbox_id: string;
  after_id: string | null;
  batch_size: number;
  unclassified_only: boolean;
  settled_sweep: SettledSweepScope | null;
  declined_sweep: DeclinedSweepScope | null;
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

  if (input.declined_sweep !== null) {
    const { flavor } = input.declined_sweep;

    // Unread, in the inbox, and not already decided by this sweep. Deliberately NO age term: 1.1's whole
    // argument is that elapsed time is the wrong clock, and the exposure count applied per message in
    // buildDecisionInput is the real gate. An age floor here would quietly reintroduce the wall clock the
    // design rejected.
    conditions.push(eq(message.is_seen, false));
    conditions.push(isInInboxSql(flavor));
    conditions.push(
      notExists(
        db
          .select({ swept: sql`1` })
          .from(action)
          .where(and(eq(action.message_id, message.id), eq(action.source, SWEEP_DECLINED_SOURCE))),
      ),
    );
  }

  if (input.settled_sweep !== null) {
    const { dwell_days, replied_dwell_days, flavor, now } = input.settled_sweep;
    // The SHORTER of the two, deliberately. Which dwell applies depends on replied_in_thread, which is a
    // per-thread fact loadThreadFacts computes in JavaScript and no column holds — so SQL cannot make that
    // distinction. It casts the coarse net at the lower bound and buildDecisionInput applies the real
    // threshold per message. Using the longer one here would silently hide every ordinary settled message
    // between the two values.
    const cutoff = new Date(now.getTime() - Math.min(dwell_days, replied_dwell_days) * 86_400_000);

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

  return shadowMessageSelect()
    .where(and(...conditions))
    .orderBy(asc(message.id))
    .limit(input.batch_size);
}

// The one spelling of "a message as decide() needs to see it": every column buildDecisionInput reads plus
// the sender aggregates and thread state it joins. Shared by the pass's batch walk and the unsubscribe
// button's per-sender read so the two cannot hand decide() different shapes.
function shadowMessageSelect() {
  return db
    .select({
      id: message.id,
      mailbox_id: message.mailbox_id,
      thread_key: message.thread_key,
      from_address: message.from_address,
      from_domain: message.from_domain,
      subject: message.subject,
      is_flagged: message.is_flagged,
      has_attachment: message.has_attachment,
      to_me: message.to_me,
      cc_me: message.cc_me,
      dkim_aligned: message.dkim_aligned,
      is_calendar: message.is_calendar,
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
    .leftJoin(threadState, and(eq(threadState.mailbox_id, message.mailbox_id), eq(threadState.thread_key, threadGroupKeySql())));
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
  params: {
    policy_index: PolicyIndex;
    thread_facts: Map<string, ThreadFacts>;
    now: Date;
    settled_sweep: Omit<SettledSweepScope, "flavor"> | null;
    declined_sweep: Omit<DeclinedSweepScope, "flavor"> | null;
    exposures: number | null;
  },
): DecisionInput {
  const from_address = row.from_address ?? "";
  const from_domain = row.from_domain ?? "";
  const thread_state = resolveThreadState({ state: row.thread_state, snoozed_until: row.thread_snoozed_until, now: params.now });
  const sender_suppressed = params.policy_index.suppressed.has(from_address.toLowerCase());

  const signals = deriveSignals({
    list_id: row.list_id,
    list_unsubscribe: row.list_unsubscribe,
    precedence: row.precedence,
    auto_submitted: row.auto_submitted,
    from_address: row.from_address,
    to_me: row.to_me,
    cc_me: row.cc_me,
    dkim_aligned: row.dkim_aligned,
    is_calendar: row.is_calendar,
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
    thread_state,
    last_in_thread_is_mine: thread_facts.last_in_thread_is_mine,
    sender_suppressed,
    policies: selectPolicies(params.policy_index, from_address, from_domain),
    // The SQL above cast a coarse net at the shorter dwell; the real threshold is applied here, because
    // which one applies depends on replied_in_thread and only this layer knows it.
    settled_sweep_candidate:
      params.settled_sweep !== null &&
      signals.age_days >= (thread_facts.replied_in_thread ? params.settled_sweep.replied_dwell_days : params.settled_sweep.dwell_days),
    // Null unless this pass IS the unread sweep. A count of 0 would mean "candidate, no sessions yet",
    // which is a different claim and one the ladder acts on differently.
    declined_exposures: params.declined_sweep === null ? null : (params.exposures ?? 0),
    // 1.9's double threshold for mail somebody is waiting on. Decided here because it depends on the
    // Needs Action signal set, which is a fact about this message and this thread rather than about the
    // pass — and decide() must not re-derive it, or the two spellings can disagree.
    declined_threshold:
      params.declined_sweep === null
        ? 0
        : matchesNeedsActionSignals({
              signals,
              last_in_thread_is_mine: thread_facts.last_in_thread_is_mine,
              thread_state,
              sender_suppressed,
            })
          ? params.declined_sweep.needs_action_threshold
          : params.declined_sweep.ordinary_threshold,
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

// status takes no parameter: every row written here is born "shadow". The unsubscribe button's rows
// leave shadow only through the journal's guarded promoteShadowActions, and nothing here can produce
// "applied".
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

// The one decision source a sweep pass may journal; null means the pass is a classify pass and journals
// every decision it makes.
export function journalableSourceFor(input: { settled_sweep: unknown | null; declined_sweep: unknown | null }): string | null {
  if (input.settled_sweep !== null) {
    return SWEEP_SETTLED_SOURCE;
  }
  if (input.declined_sweep !== null) {
    return SWEEP_DECLINED_SOURCE;
  }
  return null;
}

async function runPass(
  input: RunShadowPassInput & {
    unclassified_only: boolean;
    settled_sweep: Omit<SettledSweepScope, "flavor"> | null;
    declined_sweep: Omit<DeclinedSweepScope, "flavor"> | null;
  },
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

  // Loaded once for the whole pass, not per message. A mailbox holds tens of thousands of rows and the
  // session log holds a handful per day, so this is one small read against a per-row subquery — and the
  // count is a filter over an in-memory array rather than a query per candidate.
  const sessions_since =
    input.declined_sweep === null
      ? []
      : (await db.select({ started_at: attentionSession.started_at }).from(attentionSession)).map((row) => row.started_at);

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
      declined_sweep: input.declined_sweep === null ? null : { ...input.declined_sweep, flavor },
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
        settled_sweep: input.settled_sweep,
        declined_sweep: input.declined_sweep,
        // 1.2: derived, never stored. Sessions that BEGAN after the message arrived are the ones during
        // which it was in the list and was passed over.
        exposures: input.declined_sweep === null ? null : sessions_since.filter((started_at) => started_at > row.internal_date).length,
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
      // A sweep journals ONLY what it authored. Every other source — a policy, a derived rule, the
      // fallback — already produced a row when this message was first classified, and the sweep reaching
      // the same conclusion is not new information. Writing it anyway would put a second proposal on the
      // Shadow screen for every settled message: measured against real mail on 2026-08-26, 1,561 of 3,529
      // candidates, including 483 `file` rows on listify that were already sitting there waiting to be
      // reviewed. A sweep that re-proposes the classify pass's conclusions buries the evidence under
      // exactly the rows the operator is trying to read.
      //
      // Both sweeps, not just the settled one: the first version guarded only settled, and the declined
      // sweep's first scheduled run on 2026-09-06 wrote 1,090 duplicate rows in one tick.
      //
      // by_decision above still counts them, because what the candidates resolve to is the useful report
      // even when only a subset is worth journaling.
      const journalable_source = journalableSourceFor({ settled_sweep: input.settled_sweep, declined_sweep: input.declined_sweep });
      if (journalable_source !== null && decision.source !== journalable_source) {
        continue;
      }

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
  return runPass({ ...input, unclassified_only: false, settled_sweep: null, declined_sweep: null });
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
  return runPass({ ...input, unclassified_only: true, settled_sweep: null, declined_sweep: null });
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
export async function runSettledSweepPass(
  input: RunShadowPassInput & { dwell_days: number; replied_dwell_days: number; now: Date },
): Promise<RunShadowPassResult> {
  // Spread, never a hand-listed field set. The first version of this named its five fields explicitly and
  // silently dropped dry_run and onDecision — so the verification pass that exists to write NOTHING would
  // have journaled a shadow row for every settled message in production, which is the exact mutation it
  // is supposed to gate. Anything added to RunShadowPassInput must reach runPass by default.
  return runPass({
    ...input,
    unclassified_only: false,
    settled_sweep: { dwell_days: input.dwell_days, replied_dwell_days: input.replied_dwell_days, now: input.now },
    declined_sweep: null,
  });
}

// Inbox-dwell 1.9's unread half, and the last piece of the operator's original ask: zero unread within
// roughly three days, without opening folders.
//
// It counts triage sessions survived, not days elapsed (1.1). An absence therefore pauses it as a
// property of the mechanism rather than as a special case bolted on: no sessions occur, so the counter
// does not advance, so nothing ages out. That is the whole reason this design was chosen over a wall
// clock, and it is why there is no age term anywhere in its candidate query.
//
// Journals at `shadow` like every other new rule. Nothing moves until the operator promotes it.
export async function runDeclinedSweepPass(
  input: RunShadowPassInput & { ordinary_threshold: number; needs_action_threshold: number; now: Date },
): Promise<RunShadowPassResult> {
  return runPass({
    ...input,
    unclassified_only: false,
    settled_sweep: null,
    declined_sweep: {
      ordinary_threshold: input.ordinary_threshold,
      needs_action_threshold: input.needs_action_threshold,
      now: input.now,
    },
  });
}

// ─── The unsubscribe button's archive-now ────────────────────────────────────
//
// docs/decisions/2026-09-06-unsubscribe-button-and-digest-links.md: pressing the button on a checked list
// is the operator's approval, so the sender's inbox mail is journaled and executed at once rather than
// proposed for a shadow cycle. The decision still goes through decide(): the guards, thread state,
// suppression and a suspended rule all refuse exactly as they would on the scheduled pass, and a refusal
// here is reported rather than overridden.
//
// Every row is written `shadow` and then CLAIMED through the journal's guarded promoteShadowActions, whose
// return value is the only list of rows this press owns. Two presses on the same sender read the same
// rows; only one of them moves each, and the executor is handed exactly what the claim moved.

// One constant rather than an id per click, so a second press on the same sender meets its own earlier
// rows on Action_messageId_kind_runId_key and writeShadowBatch's SET leaves their status alone — an
// archive already applied is never re-issued, and a row still waiting is not duplicated.
export const UNSUBSCRIBE_BULK_RUN_ID = "unsubscribe-bulk";

// The two writes the claim needs, and nothing else of the journal: a press that could reach markApplied
// through this port would be a press that could bypass the executor.
export type SenderArchivePort = Pick<ActionJournal, "promoteShadowActions"> & {
  // Flips this run's `failed` rows on these messages back to `shadow` with the error cleared, and returns
  // the ids it actually flipped — a re-press is the operator's retry of an archive that did not land.
  reopenFailedActions: (input: { run_id: string; message_ids: string[] }) => Promise<string[]>;
};

export type SenderArchiveJournalInput = {
  // The policy must already exist at `auto` when this runs: the index is loaded fresh here, and a sender
  // whose policy is missing or says anything but archive refuses every message.
  senders: { from_address: string; sender_policy_id: string }[];
  // Rows per ENABLED mailbox this press claims for the caller to execute now. Every row past the cap, and
  // every row in a disabled mailbox, stays `shadow` with the policy id set — which is exactly what the
  // tick's promoteAutoPolicies reads for a policy at auto, so the surplus is neither stranded nor executed
  // by a timer the operator did not press.
  pending_cap: number;
  now: Date;
  port: SenderArchivePort;
};

export type PendingSenderAction = { action_id: string; from_address: string };

export type SenderArchiveCounts = { pending: number; waiting: number; retried: number; refused: number };

export type SenderArchiveJournalResult = {
  by_mailbox: { mailbox_id: string; label: string; enabled: boolean; pending: PendingSenderAction[] }[];
  // Keyed by the lower-cased address.
  by_sender: Map<string, SenderArchiveCounts>;
};

function countsFor(by_sender: Map<string, SenderArchiveCounts>, key: string): SenderArchiveCounts {
  const existing = by_sender.get(key);
  if (existing !== undefined) {
    return existing;
  }
  const created = { pending: 0, waiting: 0, retried: 0, refused: 0 };
  by_sender.set(key, created);
  return created;
}

// One mailbox's rows under UNSUBSCRIBE_BULK_RUN_ID as the database holds them after the write, oldest
// message first, each tagged with the lower-cased sender it belongs to.
export type SenderArchiveCandidate = { action_id: string; message_id: string; status: string; sender_key: string };

export type SenderArchiveClaim = { pending: PendingSenderAction[]; by_sender: Map<string, SenderArchiveCounts> };

// The claim, pure over the port so two concurrent presses can be run against one fake. Reopens this
// run's failed rows first, then asks the journal for the first `pending_cap` rows still at shadow and
// reports EXACTLY the ids the guarded UPDATE matched: a row another press claimed a moment earlier fails
// the guard and is absent from `pending`. An `applied` row from an earlier press is neither pending nor
// waiting — that archive already landed. A `pending` row from a press still running, or one that died
// before the executor reached it, is left to whoever holds it: the operator's Apply sweeps the dead ones.
export async function claimSenderArchives(input: {
  rows: SenderArchiveCandidate[];
  pending_cap: number;
  port: SenderArchivePort;
}): Promise<SenderArchiveClaim> {
  const by_sender = new Map<string, SenderArchiveCounts>();
  const sender_by_action = new Map(input.rows.map((row) => [row.action_id, row.sender_key]));

  const failed = input.rows.filter((row) => row.status === FAILED_STATUS);
  const reopened = new Set(
    failed.length === 0
      ? []
      : await input.port.reopenFailedActions({ run_id: UNSUBSCRIBE_BULK_RUN_ID, message_ids: failed.map((row) => row.message_id) }),
  );
  for (const action_id of reopened) {
    countsFor(by_sender, sender_by_action.get(action_id) ?? "").retried += 1;
  }

  const claimable = input.rows.filter((row) => row.status === SHADOW_STATUS || reopened.has(row.action_id));
  const attempted = claimable.slice(0, Math.max(0, input.pending_cap));
  const claimed = new Set(
    attempted.length === 0 ? [] : await input.port.promoteShadowActions(attempted.map((row) => ({ action_id: row.action_id }))),
  );

  const pending: PendingSenderAction[] = [];
  for (const row of claimable) {
    const counts = countsFor(by_sender, row.sender_key);
    if (claimed.has(row.action_id)) {
      counts.pending += 1;
      pending.push({ action_id: row.action_id, from_address: row.sender_key });
      continue;
    }
    counts.waiting += 1;
  }
  return { pending, by_sender };
}

async function reopenFailedActions(input: { run_id: string; message_ids: string[] }): Promise<string[]> {
  if (input.message_ids.length === 0) {
    return [];
  }
  const failed = await db
    .select({ action_id: action.id })
    .from(action)
    .where(and(eq(action.run_id, input.run_id), eq(action.status, FAILED_STATUS), inArray(action.message_id, input.message_ids)));

  // Per row and guarded, like promoteShadowActions: only affectedRows says which rows THIS press reopened
  // when two presses meet the same failure.
  const reopened: string[] = [];
  for (const row of failed) {
    const [header] = await db
      .update(action)
      .set({ status: SHADOW_STATUS, error: null, updatedAt: new Date() })
      .where(and(eq(action.id, row.action_id), eq(action.status, FAILED_STATUS)));
    if (header.affectedRows === 1) {
      reopened.push(row.action_id);
    }
  }
  return reopened;
}

export function createDatabaseSenderArchivePort(): SenderArchivePort {
  return { promoteShadowActions: createDatabaseJournal().promoteShadowActions, reopenFailedActions };
}

export async function journalSenderArchives(input: SenderArchiveJournalInput): Promise<SenderArchiveJournalResult> {
  const by_sender = new Map<string, SenderArchiveCounts>();
  const by_mailbox: SenderArchiveJournalResult["by_mailbox"] = [];
  const policy_by_address = new Map(input.senders.map((entry) => [entry.from_address.toLowerCase(), entry.sender_policy_id]));
  for (const key of policy_by_address.keys()) {
    countsFor(by_sender, key);
  }
  if (policy_by_address.size === 0) {
    return { by_mailbox, by_sender };
  }

  const policy_index = await loadPolicyIndex();
  const mailbox_rows = await db.select().from(mailbox).orderBy(asc(mailbox.label));

  for (const mailbox_row of mailbox_rows) {
    const flavor = parseMailboxFlavor(mailbox_row.flavor);
    const messages = await shadowMessageSelect()
      .where(
        and(
          eq(message.mailbox_id, mailbox_row.id),
          isNull(message.disappeared_at),
          isInInboxSql(flavor),
          inArray(sql`LOWER(${message.from_address})`, [...policy_by_address.keys()]),
        ),
      )
      .orderBy(asc(message.internal_date));
    if (messages.length === 0) {
      continue;
    }

    // Once per mailbox for the whole batch, never per sender: it is a window scan over every message
    // the mailbox holds.
    const thread_facts = await loadThreadFacts(mailbox_row.id, flavor, parseStringList(mailbox_row.sent_folders));
    const rows: ShadowActionRow[] = [];
    const sender_by_message = new Map<string, string>();

    for (const row of messages) {
      const key = (row.from_address ?? "").toLowerCase();
      const sender_policy_id = policy_by_address.get(key);
      if (sender_policy_id === undefined) {
        continue;
      }
      const decision = decide(
        buildDecisionInput(row, { policy_index, thread_facts, now: input.now, settled_sweep: null, declined_sweep: null, exposures: null }),
      );
      if (decision.action !== "archive" || decision.policy_id !== sender_policy_id) {
        countsFor(by_sender, key).refused += 1;
        continue;
      }
      rows.push(
        buildShadowActionRow({
          message_id: row.id,
          mailbox_id: mailbox_row.id,
          decision,
          mapping: null,
          run_id: UNSUBSCRIBE_BULK_RUN_ID,
          now: input.now,
        }),
      );
      sender_by_message.set(row.id, key);
    }
    if (rows.length === 0) {
      continue;
    }

    await writeShadowBatch(rows);

    // Read back rather than trusting what was written: Action.id defaults server-side, and the constant
    // run id means a second press meets its own earlier rows, whose status the write left alone.
    const written = await db
      .select({ action_id: action.id, message_id: action.message_id, status: action.status })
      .from(action)
      .innerJoin(message, eq(message.id, action.message_id))
      .where(
        and(
          eq(action.run_id, UNSUBSCRIBE_BULK_RUN_ID),
          eq(action.kind, "archive"),
          inArray(
            action.message_id,
            rows.map((row) => row.message_id),
          ),
        ),
      )
      .orderBy(asc(message.internal_date), asc(action.id));

    const claim = await claimSenderArchives({
      rows: written.flatMap((entry) => {
        const sender_key = sender_by_message.get(entry.message_id);
        return sender_key === undefined
          ? []
          : [{ action_id: entry.action_id, message_id: entry.message_id, status: entry.status, sender_key }];
      }),
      pending_cap: mailbox_row.enabled ? input.pending_cap : 0,
      port: input.port,
    });
    for (const [key, counts] of claim.by_sender) {
      const totals = countsFor(by_sender, key);
      totals.pending += counts.pending;
      totals.waiting += counts.waiting;
      totals.retried += counts.retried;
    }
    by_mailbox.push({ mailbox_id: mailbox_row.id, label: mailbox_row.label, enabled: mailbox_row.enabled, pending: claim.pending });
  }

  return { by_mailbox, by_sender };
}
