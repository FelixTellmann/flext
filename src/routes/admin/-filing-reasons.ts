// The four reasons a `file` action can land in the filing queue instead of being executed, as the admin
// route sees them.
//
// It is a copy. server/mail/filing/paths.ts owns the real tuple, but it is reached only through
// server/mail/query/filing.ts, which holds the db handle — importing either from a route would pull
// mysql2 into the client bundle. Splitting the copy out of filing.tsx is what lets
// -filing-reasons.test.ts import both sides and fail when they disagree: a route module drags the orpc
// client (and through it the server router) into the test, and this one does not. Same shape
// -shadow-kinds.ts is in for the destructive/organisational split.
//
// Why it is pinned rather than tolerated: a reason server/mail/filing/paths.ts can produce but this file
// does not know how to label would reach the queue as a row with no explanation of why it stalled and no
// idea what the operator can do about it — a blank row on the one screen whose job is to ask a question.

export type FilingQueueReason = "no_mapping" | "dkim_unaligned" | "ambiguous_client" | "unresolvable_folder";

export const FILING_QUEUE_REASONS: FilingQueueReason[] = ["no_mapping", "dkim_unaligned", "ambiguous_client", "unresolvable_folder"];

export type FilingReasonInfo = { label: string; operator_action: string };

export const FILING_REASON_INFO: Record<FilingQueueReason, FilingReasonInfo> = {
  no_mapping: {
    label: "Needs a client or topic",
    operator_action: "Set one on the sender policy, then resolve.",
  },
  dkim_unaligned: {
    label: "Sender not verified",
    operator_action: "Confirm the destination to file it anyway.",
  },
  // Defined and reachable but nothing currently produces it — no thread-level client detection exists yet.
  // It still needs a label: a reason the UI cannot render would be a blank row the day something starts
  // emitting it.
  ambiguous_client: {
    label: "Thread spans two clients",
    operator_action: "Pick one.",
  },
  // No binding UI and no ORPC write to FilingBinding exist — scripts/seed-filing-mapping.ts is the only
  // thing that writes the table — so telling the operator to "bind the path" names an action the product
  // cannot perform. This says what they can actually do today.
  unresolvable_folder: {
    label: "Folder could not be created",
    operator_action: "Pick a destination the server already has, or add a binding in scripts/seed-filing-mapping.ts and re-run it.",
  },
};

export function isFilingQueueReason(value: string): value is FilingQueueReason {
  return (FILING_QUEUE_REASONS as readonly string[]).includes(value);
}

export function filingReasonLabel(reason: string): string {
  return isFilingQueueReason(reason) ? FILING_REASON_INFO[reason].label : reason;
}

export function filingReasonOperatorAction(reason: string): string {
  return isFilingQueueReason(reason) ? FILING_REASON_INFO[reason].operator_action : "Unrecognised reason — resolve manually.";
}
