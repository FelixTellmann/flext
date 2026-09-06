import { db } from "@server/db/drizzle";
import { action, attentionSession, mailbox, message, sender, threadState } from "@server/db/schema";
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
