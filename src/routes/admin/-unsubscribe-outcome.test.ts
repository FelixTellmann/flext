import { describe, expect, test } from "bun:test";
import type { UnsubscribeSenderOutcome } from "./-unsubscribe-outcome";
import { attemptLabel, isTickable, senderLine, senderTone } from "./-unsubscribe-outcome";

// The wording the operator reads after a press, pinned because both pages now render it through one
// module: a response code that vanished or a retried count that went unmentioned would otherwise be a
// silent regression on whichever page was not looked at.

const sent_at = new Date("2026-09-07T08:00:00.000Z");

function outcome(overrides: Partial<UnsubscribeSenderOutcome> = {}): UnsubscribeSenderOutcome {
  return {
    from_address: "news@example.com",
    attempt: { method: "http", status: "sent", response_code: 200, error: null, attempted_at: sent_at },
    policy: "created",
    archived: 4,
    failed: 0,
    waiting: 0,
    retried: 0,
    refused: 0,
    errors: [],
    ...overrides,
  };
}

describe("attemptLabel", () => {
  test("a one-click attempt names its response code", () => {
    expect(attemptLabel({ method: "http", status: "sent", response_code: 200, error: null })).toBe("one-click sent 200");
    expect(attemptLabel({ method: "http", status: "failed", response_code: 503, error: "upstream" })).toBe("one-click failed 503");
  });

  test("a one-click attempt with no response falls back to the error, then to 'no response'", () => {
    expect(attemptLabel({ method: "http", status: "failed", response_code: null, error: "timed out" })).toBe(
      "one-click failed · timed out",
    );
    expect(attemptLabel({ method: "http", status: "failed", response_code: null, error: null })).toBe("one-click failed · no response");
  });

  test("an email attempt reads as email", () => {
    expect(attemptLabel({ method: "mailto", status: "sent", response_code: null, error: null })).toBe("email sent");
    expect(attemptLabel({ method: "mailto", status: "failed", response_code: null, error: "smtp refused" })).toBe(
      "email failed · smtp refused",
    );
  });

  test("skipped is just skipped", () => {
    expect(attemptLabel({ method: "http", status: "skipped", response_code: null, error: "nothing to press" })).toBe("skipped");
  });
});

describe("senderLine", () => {
  test("the plain success line", () => {
    expect(senderLine(outcome())).toBe("news@example.com: unsubscribe one-click sent 200; rule created at auto; 4 archived");
  });

  test("names every non-zero count, retries included, and appends the errors", () => {
    const line = senderLine(outcome({ policy: "left", failed: 1, retried: 2, refused: 3, waiting: 5, errors: ["boom", "bang"] }));
    expect(line).toBe(
      "news@example.com: unsubscribe one-click sent 200; existing rule left as it was; 4 archived, 1 failed, 2 retried from an earlier press, 3 kept by a guard, 5 waiting for the next tick — boom; bang",
    );
  });

  test("a press that recorded no attempt says so", () => {
    expect(senderLine(outcome({ attempt: null, policy: "promoted" }))).toBe(
      "news@example.com: unsubscribe not recorded; rule promoted to auto; 4 archived",
    );
  });
});

describe("senderTone", () => {
  test("anything that failed is danger", () => {
    expect(senderTone(outcome({ failed: 1 }))).toBe("danger");
    expect(senderTone(outcome({ errors: ["boom"] }))).toBe("danger");
    expect(
      senderTone(outcome({ attempt: { method: "http", status: "failed", response_code: 500, error: null, attempted_at: sent_at } })),
    ).toBe("danger");
  });

  test("a skipped attempt, an untouched rule or a guard refusal is warning", () => {
    expect(
      senderTone(outcome({ attempt: { method: "http", status: "skipped", response_code: null, error: null, attempted_at: sent_at } })),
    ).toBe("warning");
    expect(senderTone(outcome({ policy: "left" }))).toBe("warning");
    expect(senderTone(outcome({ refused: 1 }))).toBe("warning");
  });

  test("otherwise success", () => {
    expect(senderTone(outcome())).toBe("success");
  });
});

describe("isTickable", () => {
  test("one-click and mailto-only candidates can be ticked; a plain link cannot", () => {
    expect(isTickable({ one_click: true, target: { http: "https://example.com/u", mailto: null } })).toBe(true);
    expect(isTickable({ one_click: false, target: { http: null, mailto: "unsub@example.com" } })).toBe(true);
    expect(isTickable({ one_click: false, target: { http: "https://example.com/u", mailto: null } })).toBe(false);
  });
});
