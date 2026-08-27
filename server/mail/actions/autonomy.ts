import { db } from "@server/db/drizzle";
import { action, mailbox, senderPolicy } from "@server/db/schema";
import type { ActionJournal } from "@server/mail/actions/executor";
import { promotePolicyActions } from "@server/mail/actions/promote";
import { demotePolicyToShadow, loadPolicyById, promotePolicyToAuto } from "@server/mail/query/policies";
import { and, eq, gte, isNotNull, isNull, sql } from "drizzle-orm";

// One policy eligible for autonomous promotion: autonomy `auto`, currently unsuspended. Nothing else about
// the policy matters here — promotion only needs the id to scope promotePolicyActions's read.
export type AutoPolicyRow = { sender_policy_id: string };

// Behind a port for the same reason ActionJournal and RescuePort are: a test that reached the real
// implementation would query production's live sender policies.
export type AutonomyPort = {
  loadAutoPolicies: () => Promise<AutoPolicyRow[]>;
};

export type PromoteAutoPoliciesInput = {
  mailbox_id: string;
  batch_size: number;
  port: AutonomyPort;
  journal: ActionJournal;
};

// The Task 7 step: for one mailbox, every shadow row whose sender policy sits at autonomy `auto` moves to
// `pending`. Returns exactly the ids THIS CALL flipped, and nothing else — that id list is the executor's
// entire input on the scheduled path (see run.ts's safety-contract comment on promoteAutoActions), and is
// what keeps a row an operator approved by hand from ever being picked up by a timer.
//
// The ids come out of promotePolicyActions, which derives them from each guarded UPDATE's affectedRows —
// NOT from a read taken beforehand. The sync holds no lock and runs every fifteen minutes, so two
// overlapping runs read the same shadow rows; if both returned what they read, both would hand the
// executor the same ids and the mailbox would take the move twice. Only one run's UPDATE matches each
// row, so only one run claims it. A per-id UPDATE rather than a per-mailbox lock: the batch is at most
// `batch_size` rows, which makes the cost of claiming precisely bearable, and precision beats a lock
// here — a lock would also have to be released correctly after a crash, whereas an unclaimed row simply
// stays `shadow` and is promoted by the next run.
//
// The suspension check lives in `port.loadAutoPolicies` (a SQL `WHERE suspendedAt IS NULL`, see
// createDatabaseAutonomyPort below) rather than here. Rescue detection runs earlier in the same sync and
// may have just suspended a policy; that suspension must take effect in this run, not the next one, and a
// check performed in this function is a check a second caller of it could skip.
//
// `batch_size` is the TOTAL budget for the call, spent down across policies — not a per-policy limit.
// The caller passes the executor's batch size, and the executor applies at most that many rows in one
// run, so promoting more than the budget would strand the surplus: promotion only ever reads `shadow`
// rows, so a row left `pending` and unexecuted is never re-promoted, never appears in a future id list,
// and is by then indistinguishable from one the operator approved by hand — which the scheduled sync is
// forbidden to touch. Spending one shared budget keeps promotion and execution the same size.
export async function promoteAutoPolicies(input: PromoteAutoPoliciesInput): Promise<string[]> {
  const eligible_policies = await input.port.loadAutoPolicies();
  const promoted_action_ids: string[] = [];

  for (const policy of eligible_policies) {
    const remaining = input.batch_size - promoted_action_ids.length;
    if (remaining <= 0) {
      break;
    }

    const result = await promotePolicyActions({
      sender_policy_id: policy.sender_policy_id,
      mailbox_id: input.mailbox_id,
      batch_size: remaining,
      journal: input.journal,
    });

    promoted_action_ids.push(...result.promoted_action_ids);
  }

  return promoted_action_ids;
}

// The suspension guard is right here, in the WHERE clause: `isNull(senderPolicy.suspended_at)` alongside
// `autonomy = 'auto'`. Nothing upstream of this query can substitute for it — a caller-side check is one a
// second caller can skip, which is exactly Requirement 3's failure mode.
export function createDatabaseAutonomyPort(): AutonomyPort {
  return {
    loadAutoPolicies: async () => {
      return db
        .select({ sender_policy_id: senderPolicy.id })
        .from(senderPolicy)
        .where(and(eq(senderPolicy.autonomy, "auto"), isNull(senderPolicy.suspended_at)));
    },
  };
}

// ─── Task 8: promotion to `auto`, and its gates ──────────────────────────────
//
// This is the ONE way a policy's autonomy ever becomes "auto". upsertPolicy rejects that value at its
// Zod boundary, deliberately, and stays that way (§4.3 of the Phase 6 design): a caller who can rename a
// policy must not thereby grant it unattended write access to a mailbox. Promotion gets its own
// procedure, its own gate below, and its own write (query/policies.ts's promotePolicyToAuto) — never a
// field on a general-purpose edit.

// The row this gate needs to decide anything, read once via query/policies.ts's loadPolicyById.
// `action` is carried as the raw stored string, not narrowed to PolicyAction: the column has no database
// check, so a row written outside this app's own guarded writers is exactly what the `purge` branch below
// defends against, and narrowing it here would cast that defence away before it runs.
export type PolicyForGate = { id: string; action: string; autonomy_promoted_at: Date | null };

// Why a gate refused, so Task 9 can render "needs a trash retention setting on this mailbox" instead of a
// bare "not eligible". `missing` covers an id that names no policy at all.
export type PromotionGate = "missing" | "purge_not_allowed" | "shadow_review" | "shadow_cycle" | "trash_retention";

export type PromotePolicyAutonomyResult =
  | { outcome: "promoted"; autonomy_promoted_at: Date }
  | { outcome: "refused"; gate: PromotionGate; detail: string };

export type DemotePolicyAutonomyResult = { outcome: "demoted" };

// Behind a port for the same reason AutonomyPort is: a test that reached the real implementation would
// read and write production's live sender policies. The two writes (promoteToAuto, demoteToShadow) are
// query/policies.ts's promotePolicyToAuto and demotePolicyToShadow — this port exists to make the GATE
// testable over fakes, not to own a second copy of the senderPolicy write.
export type PromotionPort = {
  loadPolicy: (sender_policy_id: string) => Promise<PolicyForGate | null>;
  countDecisionsSince: (input: { sender_policy_id: string; since: Date }) => Promise<number>;
  countRescuesSince: (input: { sender_policy_id: string; since: Date }) => Promise<number>;
  // Labels of every mailbox whose trashRetentionDays is NULL — "closed everywhere" (§8.1) means every
  // mailbox is checked, not only the ones a caller happens to name, because SenderPolicy has no mailbox
  // scope (§8.2) and an auto_trash policy can execute against mail arriving in any of them.
  mailboxesMissingTrashRetention: () => Promise<string[]>;
  promoteToAuto: (input: { sender_policy_id: string; promoted_at: Date }) => Promise<void>;
  demoteToShadow: (sender_policy_id: string) => Promise<void>;
};

// §8.1: "a full shadow cycle" is 30 days AND at least 20 decisions since promotion, with zero rescues,
// both measured from autonomyPromotedAt and reset by any rescue. A count alone falls to running the
// shadow pass in a loop; a wall-clock window alone passes a policy that decided nothing.
const SHADOW_CYCLE_DAYS = 30;
const SHADOW_CYCLE_MIN_DECISIONS = 20;
const DAY_IN_MS = 24 * 60 * 60 * 1000;

// §8.1, stated twice for a reason: "trashRetentionDays is NULL on all four mailboxes today, so the
// auto_trash gate is closed everywhere ... unreachable today and that is fine". No policy has ever been
// promoted, so autonomy_promoted_at is null for every auto_trash policy that could ever exist right now —
// this function reads that literally rather than inventing a bootstrap for it. The gate is specified so
// the first auto_trash policy meets one that already exists, not one written to fit it.
async function evaluateAutoTrashGate(policy: PolicyForGate, port: PromotionPort): Promise<PromotePolicyAutonomyResult> {
  // Deliberately unscoped — do not narrow this to a caller-named mailbox. §8.2: a rescue suspends a policy
  // everywhere because SenderPolicy has no mailbox scope, so the promotion gate is correspondingly global
  // and errs strict: retention must be known on every mailbox before this policy may trash unattended on
  // any of them.
  const missing_retention = await port.mailboxesMissingTrashRetention();
  if (missing_retention.length > 0) {
    return {
      outcome: "refused",
      gate: "trash_retention",
      detail: `needs a trash retention setting on ${missing_retention.join(", ")} before auto_trash may run unattended — NULL means unknown, never unlimited, so a trash that silently empties makes "reversible for the retention window" false.`,
    };
  }

  const since = policy.autonomy_promoted_at;
  const now = new Date();
  const elapsed_days = since === null ? 0 : (now.getTime() - since.getTime()) / DAY_IN_MS;
  const decisions = since === null ? 0 : await port.countDecisionsSince({ sender_policy_id: policy.id, since });
  const rescues = since === null ? 0 : await port.countRescuesSince({ sender_policy_id: policy.id, since });

  if (since === null || rescues > 0 || elapsed_days < SHADOW_CYCLE_DAYS || decisions < SHADOW_CYCLE_MIN_DECISIONS) {
    const progress =
      since === null
        ? "never promoted, so no shadow cycle has started"
        : `${Math.floor(elapsed_days)} of ${SHADOW_CYCLE_DAYS} day(s), ${decisions} of ${SHADOW_CYCLE_MIN_DECISIONS} decision(s), ${rescues} rescue(s) since promotion`;
    return {
      outcome: "refused",
      gate: "shadow_cycle",
      detail: `needs a full shadow cycle: ${SHADOW_CYCLE_DAYS} days and ${SHADOW_CYCLE_MIN_DECISIONS} decisions since promotion, with zero rescues (currently ${progress}).`,
    };
  }

  await port.promoteToAuto({ sender_policy_id: policy.id, promoted_at: now });
  return { outcome: "promoted", autonomy_promoted_at: now };
}

export type PromotePolicyAutonomyInput = {
  sender_policy_id: string;
  // The explicit, recorded act §4.2's archive/file gate requires: the operator has read this policy's
  // shadow record (getShadowReport) and is asserting so. Defaulted to false at the ORPC boundary rather
  // than made optional, so silence reads as "not reviewed" and refuses, never as an accidental promotion.
  reviewed_shadow_record: boolean;
  port: PromotionPort;
};

// The single entry point for promoting a policy to autonomy "auto". Dispatches on the policy's OWN
// action, because §4.2's gate is per-action: archive and file need only a recorded review, auto_trash
// needs a full shadow cycle plus a known retention setting everywhere, and purge is refused outright
// because it is not a per-policy autonomy at all (§1.7's sweep is a separate Phase 8 job).
export async function promotePolicyAutonomy(input: PromotePolicyAutonomyInput): Promise<PromotePolicyAutonomyResult> {
  const policy = await input.port.loadPolicy(input.sender_policy_id);
  if (policy === null) {
    return { outcome: "refused", gate: "missing", detail: `no policy ${input.sender_policy_id} exists.` };
  }

  if (policy.action === "purge") {
    return {
      outcome: "refused",
      gate: "purge_not_allowed",
      detail:
        "purge is never a per-policy autonomy — refused outright. The irreversible sweep is a separate scheduled job (Phase 8) with its own dwell and eligibility rules.",
    };
  }

  if (policy.action === "auto_trash") {
    return evaluateAutoTrashGate(policy, input.port);
  }

  // archive, file, keep_inbox, and anything else stored in the column: the explicit-review gate.
  if (!input.reviewed_shadow_record) {
    return {
      outcome: "refused",
      gate: "shadow_review",
      detail:
        "needs the operator to review this policy's shadow record first (getShadowReport), then promote again with reviewed_shadow_record: true.",
    };
  }

  const promoted_at = new Date();
  await input.port.promoteToAuto({ sender_policy_id: policy.id, promoted_at });
  return { outcome: "promoted", autonomy_promoted_at: promoted_at };
}

export type PromotePolicyAutonomyBatchResult = {
  promoted: number;
  refused: number;
  results: ({ sender_policy_id: string } & PromotePolicyAutonomyResult)[];
};

// Several policies in one operator action, and NOT a bypass of anything. It calls promotePolicyAutonomy
// per policy with the same reviewed_shadow_record the operator asserted, so auto_trash still meets its own
// gate and purge is still refused outright.
//
// It does NOT stop at the first refusal, and that is the point: a batch is a review sheet the operator
// ticked, so one policy that cannot be promoted must not silently discard the twenty that can. The result
// is per-policy for the same reason — a count alone cannot tell the operator WHICH rule refused or why,
// and "18 of 20 promoted" with no names is a worse answer than the list.
export async function promotePolicyAutonomyBatch(input: {
  sender_policy_ids: string[];
  reviewed_shadow_record: boolean;
  port: PromotionPort;
}): Promise<PromotePolicyAutonomyBatchResult> {
  const results: PromotePolicyAutonomyBatchResult["results"] = [];

  // Sequential, not Promise.all: each promotion is a write, and the gates for auto_trash read counts off
  // the same table. Concurrency here buys nothing a person waiting on a click would notice and makes the
  // failure modes harder to reason about.
  for (const sender_policy_id of input.sender_policy_ids) {
    const result = await promotePolicyAutonomy({
      sender_policy_id,
      reviewed_shadow_record: input.reviewed_shadow_record,
      port: input.port,
    });
    results.push({ sender_policy_id, ...result });
  }

  return {
    promoted: results.filter((result) => result.outcome === "promoted").length,
    refused: results.filter((result) => result.outcome === "refused").length,
    results,
  };
}

// Unconditional (§8 Task 8, Step 3): no gate, and it cannot fail — the underlying UPDATE has no
// precondition beyond identity. Making it easy to stop is what makes it safe to start: an operator who
// cannot cheaply undo a promotion will not make one, and one who cannot stop a misbehaving rule has no
// recourse between "leave it running" and "delete the policy".
export async function demotePolicyAutonomy(input: { sender_policy_id: string; port: PromotionPort }): Promise<DemotePolicyAutonomyResult> {
  await input.port.demoteToShadow(input.sender_policy_id);
  return { outcome: "demoted" };
}

export function createDatabasePromotionPort(): PromotionPort {
  return {
    loadPolicy: async (sender_policy_id) => {
      const row = await loadPolicyById(sender_policy_id);
      return row === null ? null : { id: row.id, action: row.action, autonomy_promoted_at: row.autonomy_promoted_at };
    },
    countDecisionsSince: async ({ sender_policy_id, since }) => {
      const [row] = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(action)
        .where(and(eq(action.sender_policy_id, sender_policy_id), isNotNull(action.decided_at), gte(action.decided_at, since)));
      return Number(row?.count ?? 0);
    },
    countRescuesSince: async ({ sender_policy_id, since }) => {
      const [row] = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(action)
        .where(and(eq(action.sender_policy_id, sender_policy_id), isNotNull(action.rescued_at), gte(action.rescued_at, since)));
      return Number(row?.count ?? 0);
    },
    mailboxesMissingTrashRetention: async () => {
      // Missing means NOBODY HAS LOOKED, not "no retention". §1.7 accepts two answers — a retention value,
      // or a confirmed null meaning Trash accumulates forever — and a bare null cannot distinguish the
      // second from the first. Reading null alone as unknown would leave the gate shut on a question the
      // operator has already answered, which is how a safety check turns into a thing people route around.
      const rows = await db
        .select({ label: mailbox.label })
        .from(mailbox)
        .where(and(isNull(mailbox.trash_retention_days), isNull(mailbox.trash_retention_confirmed_at)));
      return rows.map((row) => row.label);
    },
    promoteToAuto: (input) => promotePolicyToAuto(input),
    demoteToShadow: (sender_policy_id) => demotePolicyToShadow(sender_policy_id),
  };
}
