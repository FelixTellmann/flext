import { describe, expect, test } from "bun:test";
import { resolveThreadState } from "@server/mail/query/signal-sql";

const now = new Date("2026-08-19T12:00:00Z");
const past = new Date("2026-08-18T12:00:00Z");
const future = new Date("2026-08-20T12:00:00Z");

describe("resolveThreadState", () => {
  test("an absent ThreadState row is open", () => {
    expect(resolveThreadState({ state: null, snoozed_until: null, now })).toBe("open");
  });

  test("a snooze whose deadline has passed is open again", () => {
    expect(resolveThreadState({ state: "snoozed", snoozed_until: past, now })).toBe("open");
  });

  test("a snooze that expires exactly now is open again, matching isThreadOpenSql's snoozed_until > now", () => {
    expect(resolveThreadState({ state: "snoozed", snoozed_until: now, now })).toBe("open");
  });

  test("a snooze with a future deadline stays snoozed", () => {
    expect(resolveThreadState({ state: "snoozed", snoozed_until: future, now })).toBe("snoozed");
  });

  test("a snooze with no deadline never expires", () => {
    expect(resolveThreadState({ state: "snoozed", snoozed_until: null, now })).toBe("snoozed");
  });

  test("done and dismissed are unaffected by any deadline left behind", () => {
    expect(resolveThreadState({ state: "done", snoozed_until: null, now })).toBe("done");
    expect(resolveThreadState({ state: "done", snoozed_until: past, now })).toBe("done");
    expect(resolveThreadState({ state: "dismissed", snoozed_until: null, now })).toBe("dismissed");
    expect(resolveThreadState({ state: "dismissed", snoozed_until: past, now })).toBe("dismissed");
  });

  test("open stays open", () => {
    expect(resolveThreadState({ state: "open", snoozed_until: null, now })).toBe("open");
  });

  test("a state the column should never hold reads as open rather than passing through", () => {
    expect(resolveThreadState({ state: "archived", snoozed_until: null, now })).toBe("open");
  });
});
