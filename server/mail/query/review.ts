import { db } from "@server/db/drizzle";
import { action, mailbox, message, senderPolicy } from "@server/db/schema";
import type { ActionJournal } from "@server/mail/actions/executor";
import { EXECUTABLE_ACTION_KINDS, QUARANTINE_LOGICAL_PATH } from "@server/mail/actions/kinds";
import { SHADOW_STATUS } from "@server/mail/actions/promote";
import type { SQL } from "drizzle-orm";
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";

// The review page's status: a proposal the operator declined. Written only by dismissProposalGroup below,
// guarded on `shadow` like every other status transition, so a dismissed row is never promoted (every
// promotion loader reads status = shadow), never counted as waiting, and still shows in the journal with
// its reason. The scheduled pass's UPSERT never touches `status`, so the next tick does not resurrect it;
// a fresh operator Run-pass on /admin/shadow writes a new row under its own run id, which is the same
// second chance every other settled row gets.
export const DISMISSED_STATUS = "dismissed" as const;

const SAMPLE_LIMIT = 3;

// One group is one rule's proposals in one mailbox, split further by what they would do: (mailbox, rule,
// kind, destination). Never wider than one mailbox, because approval writes rows the executor later runs
// against that mailbox — the same Ruling 3 scope approveDecision names. A rule is a policy where the row
// carries one, otherwise the scheduled source that wrote it (first contact, the sweeps, the derived
// default), which carries no policy id and so could never be reached through the policy scope.
export type ProposalRule = { by: "policy"; policy_id: string } | { by: "source"; source: string };

export type ProposalGroupKey = {
  mailbox_id: string;
  rule: ProposalRule;
  action_kind: string;
  target_path: string | null;
};

export type ProposalGroup = {
  key: ProposalGroupKey;
  mailbox_label: string;
  rule_label: string;
  rule_note: string;
  action_label: string;
  // auto_trash and purge: the one-click approve on the review page refuses these, because bulk approval
  // of a deletion demands the typed phrase /admin/shadow's ceremony asks for.
  destructive: boolean;
  count: number;
  sample_subjects: string[];
};

export type ProposalGroupsReport = {
  groups: ProposalGroup[];
  total_groups: number;
  total_proposals: number;
};

const source_rule_label: Record<string, string> = {
  first_contact: "First contact, machine-shaped",
  first_contact_human: "First contact, human-shaped",
  sweep_settled: "Read and left in the inbox",
  sweep_declined: "Unread and never opened",
  derived: "No rule, derived default",
  fallback: "No rule matched",
};

const DESTRUCTIVE_KINDS: readonly string[] = ["auto_trash", "purge"];

function describeActionKind(kind: string, target_path: string | null): string {
  if (kind === "archive") {
    return "archive";
  }
  if (kind === "file") {
    return target_path === null ? "file (no destination yet)" : `file into ${target_path}`;
  }
  if (kind === "quarantine") {
    return `move to ${QUARANTINE_LOGICAL_PATH}`;
  }
  if (kind === "auto_trash") {
    return "bin";
  }
  return kind;
}

function ruleWhere(rule: ProposalRule): SQL {
  if (rule.by === "policy") {
    return eq(action.sender_policy_id, rule.policy_id) as SQL;
  }
  return and(isNull(action.sender_policy_id), eq(action.source, rule.source)) as SQL;
}

function groupWhere(key: ProposalGroupKey): SQL {
  return and(
    eq(action.status, SHADOW_STATUS),
    eq(action.mailbox_id, key.mailbox_id),
    ruleWhere(key.rule),
    eq(action.kind, key.action_kind),
    key.target_path === null ? isNull(action.target_path) : eq(action.target_path, key.target_path),
  ) as SQL;
}

async function countGroup(key: ProposalGroupKey): Promise<number> {
  const [row] = await db.select({ count: sql<number>`COUNT(*)` }).from(action).where(groupWhere(key));
  return Number(row?.count ?? 0);
}

// Every executable proposal still waiting, grouped, largest group first. Only executable kinds: a
// keep_inbox or needs_action row is a decision to leave the message alone, and planFor throws on it, so
// approving one is not a thing this page can offer. Rows with no mailbox of their own (Phase 3) are out
// for the same reason they are unapprovable on /admin/shadow: no scope can name them.
export async function listProposalGroups(input: { limit: number }): Promise<ProposalGroupsReport> {
  const rows = await db
    .select({
      mailbox_id: action.mailbox_id,
      mailbox_label: mailbox.label,
      sender_policy_id: action.sender_policy_id,
      source: action.source,
      kind: action.kind,
      target_path: action.target_path,
      policy_scope: senderPolicy.scope,
      policy_value: senderPolicy.value,
      count: sql<number>`COUNT(*)`.as("group_count"),
    })
    .from(action)
    .innerJoin(mailbox, eq(mailbox.id, action.mailbox_id))
    .leftJoin(senderPolicy, eq(senderPolicy.id, action.sender_policy_id))
    .where(and(eq(action.status, SHADOW_STATUS), isNotNull(action.mailbox_id), inArray(action.kind, [...EXECUTABLE_ACTION_KINDS])))
    .groupBy(
      action.mailbox_id,
      mailbox.label,
      action.sender_policy_id,
      action.source,
      action.kind,
      action.target_path,
      senderPolicy.scope,
      senderPolicy.value,
    )
    .orderBy(desc(sql`group_count`));

  const total_proposals = rows.reduce((sum, row) => sum + Number(row.count), 0);
  const top = rows.slice(0, input.limit);

  const groups = await Promise.all(
    top.map(async (row): Promise<ProposalGroup> => {
      const rule: ProposalRule =
        row.sender_policy_id === null ? { by: "source", source: row.source } : { by: "policy", policy_id: row.sender_policy_id };
      const key: ProposalGroupKey = {
        // Narrowed by the isNotNull predicate above; the join would have dropped the row otherwise.
        mailbox_id: row.mailbox_id ?? "",
        rule,
        action_kind: row.kind,
        target_path: row.target_path,
      };
      const subjects = await db
        .select({ subject: message.subject })
        .from(action)
        .innerJoin(message, eq(message.id, action.message_id))
        .where(and(groupWhere(key), isNotNull(message.subject)))
        .orderBy(desc(action.decided_at))
        .limit(SAMPLE_LIMIT);

      return {
        key,
        mailbox_label: row.mailbox_label,
        rule_label: rule.by === "policy" ? (row.policy_value ?? rule.policy_id) : (source_rule_label[rule.source] ?? rule.source),
        rule_note: rule.by === "policy" ? (row.policy_scope === "domain" ? "whole domain" : "this address") : "scheduled, no rule",
        action_label: describeActionKind(row.kind, row.target_path),
        destructive: DESTRUCTIVE_KINDS.includes(row.kind),
        count: Number(row.count),
        sample_subjects: subjects.map((entry) => entry.subject ?? "").filter((subject) => subject.length > 0),
      };
    }),
  );

  return { groups, total_groups: rows.length, total_proposals };
}

export type ProposalGroupWriteResult = { examined: number; changed: number; remaining: number };

async function loadGroupActionIds(key: ProposalGroupKey, batch_size: number): Promise<string[]> {
  const rows = await db
    .select({ action_id: action.id })
    .from(action)
    .where(groupWhere(key))
    .orderBy(asc(action.decided_at), asc(action.id))
    .limit(batch_size);
  return rows.map((row) => row.action_id);
}

// Approval is the journal's own guarded promote (shadow → pending, nothing else written), handed the ids
// this group holds right now. `changed` counts what the guarded UPDATE flipped, never what was read: a
// row another caller advanced between the two is correctly absent from it.
export async function approveProposalGroup(input: {
  key: ProposalGroupKey;
  batch_size: number;
  journal: Pick<ActionJournal, "promoteShadowActions">;
}): Promise<ProposalGroupWriteResult> {
  const action_ids = await loadGroupActionIds(input.key, input.batch_size);
  if (action_ids.length === 0) {
    return { examined: 0, changed: 0, remaining: 0 };
  }
  const promoted = await input.journal.promoteShadowActions(action_ids.map((action_id) => ({ action_id })));
  return { examined: action_ids.length, changed: promoted.length, remaining: await countGroup(input.key) };
}

// The mirror of supersedeSiblingsUpdate in actions/journal.ts: status and updatedAt, nothing else, guarded
// on `shadow` in the WHERE so a row approved from another tab in between is left as that tab left it.
export async function dismissProposalGroup(input: { key: ProposalGroupKey; batch_size: number }): Promise<ProposalGroupWriteResult> {
  const action_ids = await loadGroupActionIds(input.key, input.batch_size);
  if (action_ids.length === 0) {
    return { examined: 0, changed: 0, remaining: 0 };
  }
  const [header] = await db
    .update(action)
    .set({ status: DISMISSED_STATUS, updatedAt: new Date() })
    .where(and(inArray(action.id, action_ids), eq(action.status, SHADOW_STATUS)));
  return { examined: action_ids.length, changed: header.affectedRows, remaining: await countGroup(input.key) };
}
