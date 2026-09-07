import type { orpc } from "~/integrations/orpc";

// The journal screen's pure parts: the status/error vocabulary it renders, and the diff it computes over
// two mailbox snapshots. Split out of journal.tsx so -action-journal.test.ts can exercise them without
// importing a route module (which drags the orpc client, and through it the server router, into the test).
// The import above is type-only and is erased at build, so nothing server-side rides along at runtime.

type JournalRow = Awaited<ReturnType<typeof orpc.mail.listActionJournal>>["rows"][number];

export type StateSnapshot = NonNullable<JournalRow["from_state"]>;
export type KnownStatus = NonNullable<JournalRow["known_status"]>;
export type ErrorMeaning = NonNullable<JournalRow["error"]>["meaning"];

// Mirrors ACTION_JOURNAL_STATUS_FILTERS in server/mail/query/actions.ts — an admin route can't import a
// server value without pulling the action modules (and the db handle) into the client bundle, the same
// reasoning shadow.tsx and senders.tsx already carry. The server re-validates this enum on every call,
// and the test pins the tuple against ACTION_STATUSES so a new status cannot drop out of the filter row.
export const journal_status_filters = [
  "all",
  "shadow",
  "pending",
  "applied",
  "failed",
  "deferred",
  "undone",
  "superseded",
  "dismissed",
] as const;

// Mirrors ACTION_STATUS_MEANINGS in server/mail/actions/status.ts. It cannot be imported: status.ts takes
// its status constants from executor.ts, promote.ts and undo.ts, and importing it here would pull the
// whole execution stack (kinds, state, providers, errors) into the client bundle. The keys are pinned by
// KnownStatus, which comes from the server row type — only the prose can drift, and the test asserts it
// against the real record, so an edit to one side fails the suite instead of quietly disagreeing.
export const status_meaning: Record<KnownStatus, string> = {
  shadow: "Decided but never approved. Nothing has been sent to the mailbox.",
  pending: "Approved, and the mailbox may or may not already have been changed — the pre-state is recorded and the outcome is unconfirmed.",
  applied: "The mutation landed and was confirmed. Reversible.",
  failed: "The mutation did not land. The recorded pre-state is what the message should still look like.",
  deferred: "Deliberately not executed in this phase — there is no plan for it yet, and nothing was sent to the mailbox.",
  undone: "Applied and then reversed. The message is back at its recorded pre-state.",
  superseded: "Proposed, then another action moved the message first. Nothing was sent to the mailbox for this row, and nothing will be.",
  dismissed: "Proposed, then declined on the review page. Nothing was sent to the mailbox for this row, and nothing will be.",
};

export const status_label: Record<KnownStatus, string> = {
  shadow: "Shadow",
  pending: "Pending",
  applied: "Applied",
  failed: "Failed",
  deferred: "Deferred",
  undone: "Undone",
  superseded: "Superseded",
  dismissed: "Dismissed",
};

export const status_style: Record<KnownStatus, string> = {
  shadow: "bg-gray-100 text-gray-700 dark:bg-dark-bg dark:text-dark-text",
  pending: "bg-warning/10 text-warning",
  applied: "bg-success/10 text-success",
  failed: "bg-danger/10 text-danger",
  deferred: "bg-info/10 text-info",
  undone: "bg-info/10 text-info",
  superseded: "bg-gray-100 text-gray-500 dark:bg-dark-bg dark:text-dark-text",
  dismissed: "bg-gray-100 text-gray-500 dark:bg-dark-bg dark:text-dark-text",
};

// `error` is non-null in three different states and only one of them is a failure, so the presentation is
// driven by classifyActionError's `meaning`, never by the presence of the text. Painting a deferred row or
// a stale undo failure red would tell the operator their mail is broken when it is not.
export const error_meaning_headline: Record<ErrorMeaning, string> = {
  failed: "The mutation did not land",
  deferred: "Deliberately not executed in this phase",
  undo_failed: "The action still stands — a reversal did not land",
  unknown: "Recorded note",
};

export const error_meaning_detail: Record<ErrorMeaning, string> = {
  failed: "Nothing was changed in the mailbox — the message should still look like the state on the left.",
  deferred: "Nothing was sent to the mailbox. Filing has no executable plan yet, so this row is parked, not broken.",
  undo_failed: "The action itself is still applied and the message is where it put it. Undo can be retried.",
  unknown: "This row's status is not one the journal classifies, so what the note means cannot be stated.",
};

export const error_meaning_style: Record<ErrorMeaning, string> = {
  failed: "border-danger/40 bg-danger/10 text-danger",
  deferred: "border-info/40 bg-info/10 text-info",
  undo_failed: "border-warning/40 bg-warning/10 text-warning",
  unknown: "border-gray-300 bg-gray-100 text-gray-700 dark:border-dark-border dark:bg-dark-bg dark:text-dark-text",
};

// The values on one side that the other side does not have — what the screen paints red as removed and
// green as added.
//
// Both snapshots must exist for that to mean anything. to_state_json is written only when an action is
// applied (executor.ts step 4), so a `pending` or `failed` row has no post-state at all — and comparing a
// recorded pre-state against nothing returns EVERY flag and label as changed, painting the whole row red
// as deleted directly above the journal's own note saying the message should still be exactly there. A
// missing counterpart is "nothing to compare", not "everything went away".
//
// A null `labels` array is the other absence: it means the provider has no label concept, not that the
// labels were cleared, so it compares as an empty set on whichever side carries it.
export function changedValues(left: StateSnapshot | null, right: StateSnapshot | null, facet: "flags" | "labels"): Set<string> {
  if (left === null || right === null) {
    return new Set<string>();
  }
  const other = new Set(right[facet] ?? []);
  return new Set((left[facet] ?? []).filter((value) => !other.has(value)));
}
