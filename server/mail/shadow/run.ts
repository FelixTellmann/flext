import { db } from "@server/db/drizzle";
import { action, mailbox, message, sender, threadState } from "@server/db/schema";
import type { Decision, DecisionInput, SenderPolicyInput, ThreadStateValue } from "@server/mail/classify/rules";
import { decide } from "@server/mail/classify/rules";
import { deriveSignals } from "@server/mail/classify/signals";
import type { PolicyIndex, PolicyRow } from "@server/mail/query/policies";
import { loadPolicyIndex } from "@server/mail/query/policies";
import type { MailboxFlavor } from "@server/mail/types";
import { parseMailboxFlavor, parseStringList } from "@server/mail/types";
import type { SQL } from "drizzle-orm";
import { and, asc, eq, gt, inArray, isNull, sql } from "drizzle-orm";

// The JSON-encoded token Phase 1 stores in Message.labels for a Gmail-flagged sent message (§4.1's
// X-GM-LABELS capture), not a folder — [Gmail]/Sent Mail is never synced for flavor "gmail", only the
// canonical [Gmail]/All Mail, so no Gmail row ever has a Sent folder to test against.
const GMAIL_SENT_LABEL = "\\Sent";

export type RunShadowPassInput = { mailbox_id: string; batch_size: number };

export type RunShadowPassResult = { examined: number; journaled: number; by_decision: Record<string, number> };

const SHADOW_STATUS = "shadow" as const;

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
};

type ShadowActionRow = {
  message_id: string;
  sender_policy_id: string | null;
  kind: string;
  status: "shadow";
  run_id: string;
  decided_at: Date;
  updatedAt: Date;
};

function threadGroupKey(): SQL<string> {
  return sql<string>`COALESCE(${message.thread_key}, ${message.id})`;
}

// "Sent by the mailbox owner" is tested differently per flavor: generic IMAP mirrors sent mail into a
// real folder, but Gmail syncs only [Gmail]/All Mail (§4.1), so a Gmail row's Sent-ness lives in the
// \Sent label instead. JSON_CONTAINS on the exact token (not `labels LIKE '%Sent%'`) so an operator label
// like "Clients/Sent-Invoices" cannot false-positive. Either branch falls back to `0` — an unconfigured
// generic mailbox (no sent_folders) or a labels column with no usable data both yield `0` for every row,
// so replied_in_thread and last_in_thread_is_mine come out false, the same conservative default
// `decide()` already falls back to when it has no evidence.
function isMineSql(flavor: MailboxFlavor, sent_folders: string[]): SQL<boolean> {
  if (flavor === "gmail") {
    return sql<boolean>`JSON_CONTAINS(COALESCE(${message.labels}, '[]'), JSON_QUOTE(${GMAIL_SENT_LABEL}))`;
  }
  if (sent_folders.length === 0) {
    return sql<boolean>`0`;
  }
  return sql<boolean>`${inArray(message.folder, sent_folders)}`;
}

async function loadThreadFacts(mailbox_id: string, flavor: MailboxFlavor, sent_folders: string[]): Promise<Map<string, ThreadFacts>> {
  const group_key = threadGroupKey();
  const is_mine = isMineSql(flavor, sent_folders);

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
    })
    .from(message)
    .leftJoin(sender, eq(sender.address, message.from_address))
    .leftJoin(threadState, and(eq(threadState.mailbox_id, message.mailbox_id), eq(threadState.thread_key, message.thread_key)))
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
    thread_state: (row.thread_state ?? "open") as ThreadStateValue,
    last_in_thread_is_mine: thread_facts.last_in_thread_is_mine,
    sender_suppressed: params.policy_index.suppressed.has(from_address.toLowerCase()),
    policies: selectPolicies(params.policy_index, from_address, from_domain),
  };
}

// status takes no parameter: every row this module can build is hardcoded to "shadow", so there is no
// code path here that could produce "pending" or "applied" — Phase 4 owns writing those.
function buildShadowActionRow(input: { message_id: string; decision: Decision; run_id: string; now: Date }): ShadowActionRow {
  return {
    message_id: input.message_id,
    sender_policy_id: input.decision.policy_id,
    kind: input.decision.action,
    status: SHADOW_STATUS,
    run_id: input.run_id,
    decided_at: input.now,
    updatedAt: input.now,
  };
}

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
        status: SHADOW_STATUS,
        decided_at: sql`VALUES(\`decidedAt\`)`,
        updatedAt: sql`VALUES(\`updatedAt\`)`,
      },
    });
}

export async function runShadowPass(input: RunShadowPassInput): Promise<RunShadowPassResult> {
  const run_id = crypto.randomUUID();
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
      rows.push(buildShadowActionRow({ message_id: row.id, decision, run_id, now }));
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
