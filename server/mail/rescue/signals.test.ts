import { describe, expect, test } from "bun:test";
import type { RescueInput } from "@server/mail/rescue/signals";
import { judgeRescue } from "@server/mail/rescue/signals";

const APPLIED_AT = new Date("2026-08-01T12:00:00.000Z");

function baseInput(overrides: Partial<RescueInput> = {}): RescueInput {
  return {
    applied_at: APPLIED_AT,
    opened_at: null,
    last_reply_at: null,
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

  test("applied_at in the future relative to both signals is not a rescue", () => {
    const opened_at = new Date(APPLIED_AT.getTime() - 2000);
    const last_reply_at = new Date(APPLIED_AT.getTime() - 1000);
    const verdict = judgeRescue(baseInput({ opened_at, last_reply_at }));
    expect(verdict).toEqual({ rescued: false });
  });
});
