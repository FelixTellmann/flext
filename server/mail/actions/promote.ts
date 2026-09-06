import type { ActionJournal, ActionPromotionLookup } from "@server/mail/actions/executor";

// Task 8: promotion turns a reviewed shadow decision into something the executor may act on. It writes
// exactly one thing — `status: "pending"` — and nothing else: no from_state_json, to_state_json, or
// applied_at. Those belong to executor.ts's own four steps (§7.1); a promoted row is picked up by
// loadPendingActions on the executor's next run and captured there, not here.
//
// §8 reserves promotion of a policy's execution mode for Phase 6, after a reviewed shadow record — that is
// a column on senderPolicy, guarded at its own write boundary in query/policies.ts. This module touches
// none of that: it only ever moves an Action row's `status` from "shadow" to "pending".

export const SHADOW_STATUS = "shadow" as const;

// Why a promotion did nothing, so Task 9 can tell the operator which of these it is instead of rendering
// an empty result the same way for all three.
export type NotPromotableReason = "missing" | "other_mailbox" | "not_shadow";

export type PromoteActionResult = { outcome: "promoted" } | { outcome: "not_promotable"; reason: NotPromotableReason; detail: string };

export type PromoteActionInput = {
  action_id: string;
  mailbox_id: string;
  journal: ActionJournal;
};

export type PromotePolicyActionsInput = {
  sender_policy_id: string;
  mailbox_id: string;
  batch_size: number;
  journal: ActionJournal;
};

export type PromotePolicyActionsResult = {
  examined: number;
  promoted: number;
  // The ids whose guarded UPDATE actually matched — never merely the ids that were read. The scheduled
  // sync feeds this straight to the executor, and two overlapping runs read the same shadow rows, so
  // handing back the read set would let both runs execute the same actions against a live mailbox.
  promoted_action_ids: string[];
};

// A lookup by id alone, classified here rather than filtered away in SQL, so "no such action", "that
// action belongs to another mailbox", and "not a shadow row" stay distinguishable. The last case is
// Ruling 1's guard: an action already `applied`, `undone`, `deferred`, or already `pending` fails this
// check exactly like one that never existed — the detail string is what tells the operator which.
function classifyLookup(lookup: ActionPromotionLookup | null, mailbox_id: string): PromoteActionResult | { row: ActionPromotionLookup } {
  if (lookup === null) {
    return { outcome: "not_promotable", reason: "missing", detail: "no action with that id exists." };
  }
  if (lookup.mailbox_id !== mailbox_id) {
    return {
      outcome: "not_promotable",
      reason: "other_mailbox",
      detail: `that action belongs to mailbox ${lookup.mailbox_id ?? "(none recorded)"}, and approval must reach the mailbox it will execute against.`,
    };
  }
  if (lookup.status !== SHADOW_STATUS) {
    return {
      outcome: "not_promotable",
      reason: "not_shadow",
      detail: `that action has status "${lookup.status}", so it is not a reviewed shadow decision. Only a shadow row may be promoted, and only to "pending" — never straight to "applied".`,
    };
  }
  return { row: lookup };
}

// One decision, explicitly identified by id. There is no way to reach this without naming the action:
// Ruling 3 (never "approve everything") starts here, and the mailbox check keeps a click in one mailbox's
// review screen from reaching an action that belongs to another.
export async function promoteAction(input: PromoteActionInput): Promise<PromoteActionResult> {
  if (input.action_id.length === 0) {
    throw new Error("promoteAction needs an action id.");
  }
  if (input.mailbox_id.length === 0) {
    throw new Error("promoteAction needs a mailbox id: approval must reach the mailbox the action will execute against.");
  }

  const classified = classifyLookup(await input.journal.loadActionForPromotion({ action_id: input.action_id }), input.mailbox_id);
  if (!("row" in classified)) {
    return classified;
  }

  await input.journal.promoteShadowActions([{ action_id: classified.row.action_id }]);
  return { outcome: "promoted" };
}

// All decisions for one policy, in one mailbox — the other explicit scope Ruling 3 allows. Both ids are
// required for the same reason loadUndoableActionsByPolicy requires them: an unscoped read would hand back
// every shadow decision in the mailbox, or across every mailbox, and promote everything it found.
export async function promotePolicyActions(input: PromotePolicyActionsInput): Promise<PromotePolicyActionsResult> {
  if (input.sender_policy_id.length === 0) {
    throw new Error("promotePolicyActions needs a policy id: an unscoped promote would approve every shadow decision in this mailbox.");
  }
  if (input.mailbox_id.length === 0) {
    throw new Error("promotePolicyActions needs a mailbox id: approval must reach the mailbox these actions will execute against.");
  }

  const rows = await input.journal.loadShadowActionsByPolicy({
    mailbox_id: input.mailbox_id,
    sender_policy_id: input.sender_policy_id,
    batch_size: input.batch_size,
  });
  if (rows.length === 0) {
    return { examined: 0, promoted: 0, promoted_action_ids: [] };
  }

  // `promoted` counts what the write moved, not what the read found: a row another caller advanced
  // between the two fails the `WHERE status = 'shadow'` guard and is correctly absent from both numbers.
  const promoted_action_ids = await input.journal.promoteShadowActions(rows.map((row) => ({ action_id: row.action_id })));
  return { examined: rows.length, promoted: promoted_action_ids.length, promoted_action_ids };
}

export type ResolveFilingActionInput = {
  action_id: string;
  mailbox_id: string;
  target_path: string;
  journal: ActionJournal;
};

export type ResolveFilingActionResult = { outcome: "resolved" } | { outcome: "refused"; detail: string };

// Task 9 fix round 1: journal.ts's resolveFilingActions UPDATE carries no mailbox predicate, on purpose —
// loadPendingActions re-scopes EXECUTION by the row's real mailbox column, so a mis-scoped row can never
// be executed against the wrong mailbox no matter what happens here. But nothing stopped RESOLUTION itself
// from being granted by naming any enabled mailbox, including one that has nothing to do with the row,
// which would silently move a row belonging to a DISABLED mailbox to pending. loadActionForPromotion is
// the same unfiltered lookup promoteAction already uses for the identical question ("is this action
// mine"), reused here rather than re-derived. A single refusal, not classifyLookup's three-way
// NotPromotableReason: nothing renders a distinction between "no such action" and "wrong mailbox" yet, and
// a second copy of that classification would be the kind of duplication this phase has been trimming.
export async function resolveFilingAction(input: ResolveFilingActionInput): Promise<ResolveFilingActionResult> {
  if (input.action_id.length === 0) {
    throw new Error("resolveFilingAction needs an action id.");
  }
  if (input.mailbox_id.length === 0) {
    throw new Error("resolveFilingAction needs a mailbox id: resolution must reach the mailbox the row belongs to.");
  }

  const lookup = await input.journal.loadActionForPromotion({ action_id: input.action_id });
  if (lookup === null || lookup.mailbox_id !== input.mailbox_id) {
    return { outcome: "refused", detail: `no action ${input.action_id} exists in mailbox ${input.mailbox_id}.` };
  }

  await input.journal.resolveFilingActions([{ action_id: input.action_id, target_path: input.target_path }]);
  return { outcome: "resolved" };
}
