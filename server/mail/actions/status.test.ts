import { describe, expect, test } from "bun:test";
import { APPLIED_STATUS, DEFERRED_STATUS, FAILED_STATUS, PENDING_STATUS } from "@server/mail/actions/executor";
import { SHADOW_STATUS } from "@server/mail/actions/promote";
import { ACTION_STATUS_MEANINGS, ACTION_STATUSES, classifyActionError, toActionStatus } from "@server/mail/actions/status";
import { UNDONE_STATUS } from "@server/mail/actions/undo";

describe("ACTION_STATUSES", () => {
  test("covers exactly the six statuses in play, spelled by their owning modules", () => {
    expect([...ACTION_STATUSES].sort()).toEqual(
      [SHADOW_STATUS, PENDING_STATUS, APPLIED_STATUS, FAILED_STATUS, DEFERRED_STATUS, UNDONE_STATUS].sort(),
    );
    expect(new Set(ACTION_STATUSES).size).toBe(6);
  });

  test.each([...ACTION_STATUSES])("toActionStatus round-trips %s", (status) => {
    expect(toActionStatus(status)).toBe(status);
  });

  test("toActionStatus rejects a value outside the set instead of widening it", () => {
    expect(toActionStatus("purged")).toBeNull();
    expect(toActionStatus("")).toBeNull();
  });

  test("every status has operator-facing text, and pending never claims nothing happened", () => {
    expect(Object.keys(ACTION_STATUS_MEANINGS).sort()).toEqual([...ACTION_STATUSES].sort());
    expect(ACTION_STATUS_MEANINGS[PENDING_STATUS]).toContain("may or may not");
  });
});

describe("classifyActionError", () => {
  test("reports nothing when there is no error text", () => {
    expect(classifyActionError({ status: FAILED_STATUS, error: null })).toBeNull();
    expect(classifyActionError({ status: FAILED_STATUS, error: "" })).toBeNull();
  });

  test("a failed row is the only real failure of the three writers", () => {
    expect(classifyActionError({ status: FAILED_STATUS, error: "network: connection reset" })).toEqual({
      text: "network: connection reset",
      meaning: "failed",
    });
  });

  test("a deferred row is a deliberate outcome, never a failure", () => {
    const note = classifyActionError({ status: DEFERRED_STATUS, error: "file has no target folder in this phase" });
    expect(note?.meaning).toBe("deferred");
    expect(note?.meaning).not.toBe("failed");
  });

  test("an applied row carrying an error is a failed UNDO, and the action still stands", () => {
    const note = classifyActionError({ status: APPLIED_STATUS, error: "the server confirmed no destination for UID 12" });
    expect(note?.meaning).toBe("undo_failed");
    expect(note?.meaning).not.toBe("failed");
  });

  test.each([SHADOW_STATUS, PENDING_STATUS, UNDONE_STATUS, "something-else"])(
    "%s carrying error text is surfaced as unclassified rather than dropped",
    (status) => {
      expect(classifyActionError({ status, error: "leftover" })).toEqual({ text: "leftover", meaning: "unknown" });
    },
  );
});
