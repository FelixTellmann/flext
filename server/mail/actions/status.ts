import { APPLIED_STATUS, DEFERRED_STATUS, FAILED_STATUS, PENDING_STATUS, SUPERSEDED_STATUS } from "@server/mail/actions/executor";
import { SHADOW_STATUS } from "@server/mail/actions/promote";
import { UNDONE_STATUS } from "@server/mail/actions/undo";
import { DISMISSED_STATUS } from "@server/mail/query/review";

// Every status an Action row can hold, imported from the module that owns each write rather than
// restated. A ninth spelling here would let §9's journal filter miss a whole class of rows while every
// test stayed green — the drift shape Phase 3 paid for five times.
export const ACTION_STATUSES = [
  SHADOW_STATUS,
  PENDING_STATUS,
  APPLIED_STATUS,
  FAILED_STATUS,
  DEFERRED_STATUS,
  UNDONE_STATUS,
  SUPERSEDED_STATUS,
  DISMISSED_STATUS,
] as const;

export type ActionStatus = (typeof ACTION_STATUSES)[number];

// Shipped text rather than a comment, because §9's journal has to say this to the operator. `pending` is
// the one that reads wrongly at a glance: it means the outcome is UNKNOWN, not that nothing happened. The
// executor journals from_state and status `pending` BEFORE it mutates (§7.1), and the status write that
// follows can itself fail — so a pending row may be sitting on a mutation that already landed, and only a
// reconciliation against the server can say which.
export const ACTION_STATUS_MEANINGS: Record<ActionStatus, string> = {
  shadow: "Decided but never approved. Nothing has been sent to the mailbox.",
  pending: "Approved, and the mailbox may or may not already have been changed — the pre-state is recorded and the outcome is unconfirmed.",
  applied: "The mutation landed and was confirmed. Reversible.",
  failed: "The mutation did not land. The recorded pre-state is what the message should still look like.",
  deferred: "Deliberately not executed in this phase — there is no plan for it yet, and nothing was sent to the mailbox.",
  undone: "Applied and then reversed. The message is back at its recorded pre-state.",
  superseded: "Proposed, then another action moved the message first. Nothing was sent to the mailbox for this row, and nothing will be.",
  dismissed: "Proposed, then declined on the review page. Nothing was sent to the mailbox for this row, and nothing will be.",
};

// `status` is a varchar, so a row can carry a value outside the set. It is reported raw rather than
// dropped — §9 is the trust surface, and a row the journal cannot classify must still be visible.
export function toActionStatus(raw: string): ActionStatus | null {
  return ACTION_STATUSES.find((status) => status === raw) ?? null;
}

export type ActionErrorMeaning = "failed" | "deferred" | "undo_failed" | "unknown";

export type ActionErrorNote = { text: string; meaning: ActionErrorMeaning };

// `error` is the Action row's only free-text column, and THREE different writers use it. Reading a
// non-null `error` as "this action broke" is wrong for two of them:
//
//   - `failed`  — markFailed: the mutation itself did not land. A real failure.
//   - `deferred` — markDeferred: nothing went wrong and nothing was sent to the mailbox. §6's filing gate
//     held the row back and `error` carries the reason it was held (no_mapping, dkim_unaligned,
//     ambiguous_client, unresolvable_folder). A deliberate outcome, and a resolvable one: /admin/filing
//     confirms a destination and moves the row back to `pending`.
//   - `applied` — recordUndoFailure: the action stands and the message is exactly where it put it; a
//     REVERSAL did not land. `status` is deliberately left applied so the retry stays reachable.
//
// The meaning is decided here, once, so no surface has to re-derive it from `status` and get it wrong.
export function classifyActionError(input: { status: string; error: string | null }): ActionErrorNote | null {
  if (input.error === null || input.error.length === 0) {
    return null;
  }
  if (input.status === FAILED_STATUS) {
    return { text: input.error, meaning: "failed" };
  }
  if (input.status === DEFERRED_STATUS) {
    return { text: input.error, meaning: "deferred" };
  }
  if (input.status === APPLIED_STATUS) {
    return { text: input.error, meaning: "undo_failed" };
  }
  return { text: input.error, meaning: "unknown" };
}
