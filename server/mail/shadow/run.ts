import { db } from "@server/db/drizzle";
import { action, mailbox, message, sender, threadState } from "@server/db/schema";
import { FILE_KIND } from "@server/mail/actions/kinds";
import { SHADOW_STATUS } from "@server/mail/actions/promote";
import type { Decision, DecisionInput, SenderPolicyInput } from "@server/mail/classify/rules";
import { decide } from "@server/mail/classify/rules";
import { deriveSignals } from "@server/mail/classify/signals";
import type { PolicyFilingMapping } from "@server/mail/filing/paths";
import { logicalPathFor } from "@server/mail/filing/paths";
import type { PolicyIndex, PolicyRow } from "@server/mail/query/policies";
import { loadPolicyIndex } from "@server/mail/query/policies";
import { isSentByMeSql, resolveThreadState, threadGroupKeySql } from "@server/mail/query/signal-sql";
import type { MailboxFlavor } from "@server/mail/types";
import { parseMailboxFlavor, parseStringList } from "@server/mail/types";
import { and, asc, eq, gt, isNull, sql } from "drizzle-orm";

// run_id is an input rather than always minted here because a sweep across several mailboxes is ONE
// shadow run: getShadowReport and getShadowSummary both scope to a single latest run id, so four
// mailboxes minting four ids leaves the report describing whichever mailbox finished last.
export type RunShadowPassInput = { mailbox_id: string; batch_size: number; run_id: string | null };

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

async function fetchMessageBatch(input: { mailbox_id: string; after_id: string | null; batch_size: number }): Promise<ShadowMessageRow[]> {
  const conditions = [eq(message.mailbox_id, input.mailbox_id), isNull(message.disappeared_at)];
  if (input.after_id !== null) {
    conditions.push(gt(message.id, input.after_id));
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
  params: { policy_index: PolicyIndex; thread_facts: Map<string, ThreadFacts>; now: Date },
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
        target_path: sql`VALUES(\`targetPath\`)`,
        decided_at: sql`VALUES(\`decidedAt\`)`,
        updatedAt: sql`VALUES(\`updatedAt\`)`,
      },
    });
}

export async function runShadowPass(input: RunShadowPassInput): Promise<RunShadowPassResult> {
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
    const batch = await fetchMessageBatch({ mailbox_id: input.mailbox_id, after_id, batch_size: input.batch_size });
    if (batch.length === 0) {
      break;
    }

    const rows: ShadowActionRow[] = [];
    for (const row of batch) {
      examined += 1;
      const decision = decide(buildDecisionInput(row, { policy_index, thread_facts, now }));
      by_decision[decision.action] = (by_decision[decision.action] ?? 0) + 1;
      const mapping = filingMappingFor(policy_index, decision, row.from_address ?? "", row.from_domain ?? "");
      rows.push(buildShadowActionRow({ message_id: row.id, mailbox_id: input.mailbox_id, decision, mapping, run_id, now }));
    }

    await writeShadowBatch(rows);
    journaled += rows.length;

    after_id = batch[batch.length - 1]?.id ?? after_id;
    if (batch.length < input.batch_size) {
      break;
    }
  }

  return { examined, journaled, by_decision };
}
