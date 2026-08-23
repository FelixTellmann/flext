// §8's rescue test, amended: it applies to any APPLIED action, not only an automatic one. An action's
// autonomy level records how it was approved; it says nothing about whether it was right, and this
// module is a claim about rightness. The operator's first real use of this system is a manually
// approved bulk apply — the operation that most needs watching.
export const RESCUE_SIGNALS = ["opened", "replied"] as const;
export type RescueSignal = (typeof RESCUE_SIGNALS)[number];

const SEEN_FLAG = "\\Seen";

// `starred` is deliberately absent. Message.isFlagged records that a message IS starred, never WHEN it
// became starred, so "you starred it after the rule hid it" is not expressible without a flaggedAt
// column mirroring openedAt. The consequence is stated rather than hidden: an operator who rescues a
// message by starring it, and never opens or answers it, produces no detection.

// Whether the message already carried \Seen at the instant the rule moved it, read from the action's
// recorded from_state_json. Null is "the action recorded no readable state", which is NOT the same as
// "it was unseen": the open test below requires \Seen to be provably ABSENT, so an unreadable state
// produces no open verdict rather than a guessed one. Every applied row in production carries a
// readable state (measured 2026-08-23: 0 of 1,562 without one), so failing closed here costs nothing
// observed, and the reply signal does not depend on this at all.
export function seenAtApply(from_state_json: string | null): boolean | null {
  if (from_state_json === null) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(from_state_json);
    if (typeof parsed !== "object" || parsed === null || !("flags" in parsed)) {
      return null;
    }
    const flags: unknown = (parsed as { flags: unknown }).flags;
    if (!Array.isArray(flags)) {
      return null;
    }
    return flags.some((flag) => flag === SEEN_FLAG);
  } catch {
    return null;
  }
}

export type RescueInput = {
  applied_at: Date;
  // The live row's openedAt — the first \Seen transition the sync observed. Since 2026-08-23 the sync
  // stamps it only on a real unseen→seen transition (server/mail/sync/incremental.ts), never on its
  // first sight of mail that was already read.
  opened_at: Date | string | null;
  // The newest sent-by-me message in the same thread, or null. Reply detection reuses the existing
  // thread grouping and sent-by-me SQL rather than restating either.
  //
  // `string` is in this type because it is what actually arrives. The value comes from a raw
  // `sql<Date | null>MAX(...)` aggregate, and that type parameter is an ASSERTION, not a conversion:
  // drizzle converts values for real column selects and passes raw sql<> expressions through untouched,
  // so mysql2 hands back a string. Declaring Date here is what let `.getTime is not a function` reach
  // production and abort whole rescue passes. The query converts too — this type is the second lock.
  last_reply_at: Date | string | null;
  // Whether the message was already read when the rule moved it. See seenAtApply above.
  seen_at_apply: boolean | null;
};

export type RescueVerdict = { rescued: false } | { rescued: true; signal: RescueSignal; at: Date };

// Normalises rather than trusting the declared type, and returns null for anything that is not a usable
// moment. A rescue pass that throws is a safety net that is silently absent for the rest of that
// mailbox, which is strictly worse than one signal going unread.
function momentOf(candidate: Date | string | null): Date | null {
  if (candidate === null) {
    return null;
  }
  const at = candidate instanceof Date ? candidate : new Date(candidate);
  return Number.isNaN(at.getTime()) ? null : at;
}

// Strictly later, never equal — and the reason is what openedAt actually measures. The incremental sync
// stamps it with the time it OBSERVED the \Seen transition, not the moment the operator opened the
// message, so it is already coarse and always lands after the real open. Equality with appliedAt would
// therefore mean a sync ran in the same millisecond as the apply: an artifact of two fsp:3 timestamps
// written by different code paths, not evidence that anybody read anything.
// (The executor's own read cannot cause this: captureFolderStates fetches with BODY.PEEK, which by
// definition does not set \Seen.)
// Returns the moment itself rather than a boolean, so the caller reports the normalised Date and never
// the raw string it may have been handed.
function momentAfter(candidate: Date | string | null, applied_at: Date): Date | null {
  const at = momentOf(candidate);
  if (at === null || at.getTime() <= applied_at.getTime()) {
    return null;
  }
  return at;
}

// Order is deliberate: a reply outranks an open when both qualify. Either way the verdict is the same —
// this was a rescue — but the SIGNAL is what ends up in the suspension reason the operator reads before
// deciding whether to clear it, and the two are not equally persuasive. An open can be accidental, or a
// glance while triaging; answering a message is unambiguous evidence that the rule hid something the
// operator wanted. Report the stronger of the two.
export function judgeRescue(input: RescueInput): RescueVerdict {
  const replied_at = momentAfter(input.last_reply_at, input.applied_at);
  if (replied_at !== null) {
    return { rescued: true, signal: "replied", at: replied_at };
  }

  // A message that was ALREADY read when the rule moved it cannot be rescued by being opened: there is
  // no open to detect, because the operator had read it before the rule ever ran. Without this the
  // detector reports a rescue for every already-read message a bulk apply touches, and the apply causes
  // that itself — mutating a message bumps its MODSEQ, so the next CONDSTORE sweep re-reports it with
  // the \Seen it has carried for years, and an openedAt stamped then is necessarily after appliedAt.
  // Measured on the 2026-08-22 cascade: 1,562 of 1,562 false rescues were \Seen at apply time, and 0
  // were not. The cost is stated in the spec — a deliberate re-open of already-read mail is no longer
  // detected, which is weak evidence anyway, and the reply signal covers the unambiguous case.
  if (input.seen_at_apply !== false) {
    return { rescued: false };
  }

  const opened_at = momentAfter(input.opened_at, input.applied_at);
  if (opened_at !== null) {
    return { rescued: true, signal: "opened", at: opened_at };
  }

  return { rescued: false };
}
