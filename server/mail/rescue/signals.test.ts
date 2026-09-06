import { describe, expect, test } from "bun:test";
import type { RescueInput } from "@server/mail/rescue/signals";
import { judgeRescue, seenAtApply } from "@server/mail/rescue/signals";

const APPLIED_AT = new Date("2026-08-01T12:00:00.000Z");

// seen_at_apply defaults to false — "the message was unseen when the rule moved it" — because that is
// the precondition every `opened` case here is about. A test that wants the other state passes it.
function baseInput(overrides: Partial<RescueInput> = {}): RescueInput {
  return {
    applied_at: APPLIED_AT,
    opened_at: null,
    last_reply_at: null,
    seen_at_apply: false,
    ...overrides,
  };
}

describe("judgeRescue", () => {
  test("opened after applied_at is a rescue via opened", () => {
    const opened_at = new Date(APPLIED_AT.getTime() + 1000);
    const verdict = judgeRescue(baseInput({ opened_at }));
    expect(verdict).toEqual({ rescued: true, signal: "opened", at: opened_at });
  });

  test("replied after applied_at is a rescue via replied", () => {
    const last_reply_at = new Date(APPLIED_AT.getTime() + 1000);
    const verdict = judgeRescue(baseInput({ last_reply_at }));
    expect(verdict).toEqual({ rescued: true, signal: "replied", at: last_reply_at });
  });

  // The load-bearing case: openedAt is stamped when the sync OBSERVED the \Seen transition, not when the
  // operator opened the message, so equality with applied_at means two independently-written fsp:3
  // timestamps collided — an artifact, not a signal. Flipping isAfter's `>` to `>=` makes this fail.
  test("opened at exactly applied_at is NOT a rescue — equality is an artifact, not a signal", () => {
    const verdict = judgeRescue(baseInput({ opened_at: new Date(APPLIED_AT.getTime()) }));
    expect(verdict).toEqual({ rescued: false });
  });

  test("both opened_at and last_reply_at null is not a rescue", () => {
    const verdict = judgeRescue(baseInput());
    expect(verdict).toEqual({ rescued: false });
  });

  test("opened before applied_at but replied after is a rescue via replied", () => {
    const opened_at = new Date(APPLIED_AT.getTime() - 1000);
    const last_reply_at = new Date(APPLIED_AT.getTime() + 1000);
    const verdict = judgeRescue(baseInput({ opened_at, last_reply_at }));
    expect(verdict).toEqual({ rescued: true, signal: "replied", at: last_reply_at });
  });

  // Pins the precedence rather than leaving it to branch order. Both signals qualify here, so the verdict
  // is a rescue either way — what is under test is WHICH signal gets reported, because that is the
  // sentence the operator reads on the suspension. Swap the branches in judgeRescue and this fails.
  test("a reply outranks an open when both land after applied_at", () => {
    const opened_at = new Date(APPLIED_AT.getTime() + 1000);
    const last_reply_at = new Date(APPLIED_AT.getTime() + 2000);
    const verdict = judgeRescue(baseInput({ opened_at, last_reply_at }));
    expect(verdict).toEqual({ rescued: true, signal: "replied", at: last_reply_at });
  });

  // The same, with the reply EARLIER than the open, so the result cannot be explained by "latest wins".
  test("a reply outranks an open even when the open came later", () => {
    const opened_at = new Date(APPLIED_AT.getTime() + 5000);
    const last_reply_at = new Date(APPLIED_AT.getTime() + 1000);
    const verdict = judgeRescue(baseInput({ opened_at, last_reply_at }));
    expect(verdict).toEqual({ rescued: true, signal: "replied", at: last_reply_at });
  });

  test("applied_at in the future relative to both signals is not a rescue", () => {
    const opened_at = new Date(APPLIED_AT.getTime() - 2000);
    const last_reply_at = new Date(APPLIED_AT.getTime() - 1000);
    const verdict = judgeRescue(baseInput({ opened_at, last_reply_at }));
    expect(verdict).toEqual({ rescued: false });
  });
});

describe("seen at apply", () => {
  // The 2026-08-22 cascade in one test: a message read long before the rule touched it, whose openedAt
  // was stamped by the sync that ran after the apply. 1,562 of these suspended 34 policies.
  test("a message already read at apply time is never rescued by an open", () => {
    const opened_at = new Date(APPLIED_AT.getTime() + 60_000);
    expect(judgeRescue(baseInput({ opened_at, seen_at_apply: true }))).toEqual({ rescued: false });
  });

  // Unknown is not "unseen". An unreadable state must not be promoted into the evidence the open test
  // needs, or the guard is exactly as absent as it was before.
  test("an unknown apply-time state is never rescued by an open", () => {
    const opened_at = new Date(APPLIED_AT.getTime() + 60_000);
    expect(judgeRescue(baseInput({ opened_at, seen_at_apply: null }))).toEqual({ rescued: false });
  });

  // A reply is evidence on its own terms and does not depend on what the flags were.
  test("a reply still rescues a message that was already read at apply time", () => {
    const last_reply_at = new Date(APPLIED_AT.getTime() + 60_000);
    expect(judgeRescue(baseInput({ last_reply_at, seen_at_apply: true }))).toEqual({
      rescued: true,
      signal: "replied",
      at: last_reply_at,
    });
  });
});

describe("timestamps that arrive as strings", () => {
  // What mysql2 actually hands back for a raw sql<> aggregate. This threw
  // "candidate.getTime is not a function" and aborted a whole mailbox's rescue pass in production.
  test("a string reply timestamp is judged, not thrown on", () => {
    const verdict = judgeRescue(baseInput({ last_reply_at: "2026-08-01T12:01:00.000Z" }));
    expect(verdict).toEqual({ rescued: true, signal: "replied", at: new Date("2026-08-01T12:01:00.000Z") });
  });

  test("an unparseable timestamp is no signal rather than a crash", () => {
    expect(judgeRescue(baseInput({ last_reply_at: "not a date" }))).toEqual({ rescued: false });
  });
});

describe("seenAtApply", () => {
  test("reads \\Seen out of the recorded flags", () => {
    expect(seenAtApply(JSON.stringify({ folder: "INBOX", flags: ["\\Seen"], labels: null }))).toBe(true);
    expect(seenAtApply(JSON.stringify({ folder: "INBOX", flags: ["\\Flagged"], labels: null }))).toBe(false);
    expect(seenAtApply(JSON.stringify({ folder: "INBOX", flags: [], labels: null }))).toBe(false);
  });

  // Every one of these is "no readable state", which the caller must treat as unknown rather than unseen.
  test("unreadable state is null, never a guess", () => {
    expect(seenAtApply(null)).toBeNull();
    expect(seenAtApply("{ not json")).toBeNull();
    expect(seenAtApply(JSON.stringify({ folder: "INBOX" }))).toBeNull();
    expect(seenAtApply(JSON.stringify({ flags: "\\Seen" }))).toBeNull();
  });
});
