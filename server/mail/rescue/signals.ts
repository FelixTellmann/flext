// §8's rescue test, amended: it applies to any APPLIED action, not only an automatic one. An action's
// autonomy level records how it was approved; it says nothing about whether it was right, and this
// module is a claim about rightness. The operator's first real use of this system is a manually
// approved bulk apply — the operation that most needs watching.
export const RESCUE_SIGNALS = ["opened", "replied"] as const;
export type RescueSignal = (typeof RESCUE_SIGNALS)[number];

// `starred` is deliberately absent. Message.isFlagged records that a message IS starred, never WHEN it
// became starred, so "you starred it after the rule hid it" is not expressible without a flaggedAt
// column mirroring openedAt. The consequence is stated rather than hidden: an operator who rescues a
// message by starring it, and never opens or answers it, produces no detection.

export type RescueInput = {
  applied_at: Date;
  // The live row's openedAt — the FIRST \Seen transition the sync observed, which never moves once set.
  opened_at: Date | null;
  // The newest sent-by-me message in the same thread, or null. Reply detection reuses the existing
  // thread grouping and sent-by-me SQL rather than restating either.
  last_reply_at: Date | null;
};

export type RescueVerdict = { rescued: false } | { rescued: true; signal: RescueSignal; at: Date };

// Strictly later, never equal — and the reason is what openedAt actually measures. The incremental sync
// stamps it with the time it OBSERVED the \Seen transition, not the moment the operator opened the
// message, so it is already coarse and always lands after the real open. Equality with appliedAt would
// therefore mean a sync ran in the same millisecond as the apply: an artifact of two fsp:3 timestamps
// written by different code paths, not evidence that anybody read anything.
// (The executor's own read cannot cause this: captureFolderStates fetches with BODY.PEEK, which by
// definition does not set \Seen.)
function isAfter(candidate: Date | null, applied_at: Date): candidate is Date {
  return candidate !== null && candidate.getTime() > applied_at.getTime();
}

// Order is deliberate: a reply outranks an open when both qualify. Either way the verdict is the same —
// this was a rescue — but the SIGNAL is what ends up in the suspension reason the operator reads before
// deciding whether to clear it, and the two are not equally persuasive. An open can be accidental, or a
// glance while triaging; answering a message is unambiguous evidence that the rule hid something the
// operator wanted. Report the stronger of the two.
export function judgeRescue(input: RescueInput): RescueVerdict {
  if (isAfter(input.last_reply_at, input.applied_at)) {
    return { rescued: true, signal: "replied", at: input.last_reply_at };
  }
  if (isAfter(input.opened_at, input.applied_at)) {
    return { rescued: true, signal: "opened", at: input.opened_at };
  }
  return { rescued: false };
}
