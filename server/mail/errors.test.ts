import { describe, expect, test } from "bun:test";
import type { MailboxFailure } from "./errors";
import {
  AUTH_FAILURE_DISABLE_THRESHOLD,
  classifyMailboxError,
  formatMailboxFailure,
  MAILBOX_FAILURE_KINDS,
  nextMailboxStateAfterFailure,
  readMailboxFailureKind,
} from "./errors";

test("an SPKI mismatch classifies as a pin problem", () => {
  const failure = classifyMailboxError(new Error("pinned SPKI mismatch for mail.example.com: server presented abc="));

  expect(failure.kind).toBe("tls_pin");
});

test("a refused login classifies as an auth failure", () => {
  const error = Object.assign(new Error("Invalid credentials"), { authenticationFailed: true });

  expect(classifyMailboxError(error)).toEqual({ kind: "auth", message: "Invalid credentials" });
});

test("a refused connection classifies as a network blip", () => {
  const error = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });

  expect(classifyMailboxError(error).kind).toBe("network");
});

test("a non-Error rejection still classifies", () => {
  expect(classifyMailboxError("boom")).toEqual({ kind: "unknown", message: "boom" });
});

describe("what a failed run does to its mailbox", () => {
  const auth: MailboxFailure = { kind: "auth", message: "Command failed" };

  test("the first and second auth failures are strikes, not a disabled mailbox", () => {
    // 2026-09-04: xneelo refused connections for an hour, then answered one login with an auth error, and
    // the mailbox stayed off for two days with a valid password.
    const first = nextMailboxStateAfterFailure({ failure: auth, auth_failure_count: 0 });
    expect(first).toEqual({ enabled: true, auth_failure_count: 1, last_error: "auth: Command failed (strike 1 of 3)" });

    const second = nextMailboxStateAfterFailure({ failure: auth, auth_failure_count: first.auth_failure_count });
    expect(second).toEqual({ enabled: true, auth_failure_count: 2, last_error: "auth: Command failed (strike 2 of 3)" });
  });

  test("the third consecutive auth failure disables the mailbox", () => {
    const third = nextMailboxStateAfterFailure({ failure: auth, auth_failure_count: AUTH_FAILURE_DISABLE_THRESHOLD - 1 });

    expect(third.enabled).toBe(false);
    expect(third.auth_failure_count).toBe(3);
    expect(third.last_error).toBe("auth: Command failed (strike 3 of 3)");
  });

  test("the strike suffix does not hide the kind from the lastError reader", () => {
    const state = nextMailboxStateAfterFailure({ failure: auth, auth_failure_count: 1 });

    expect(readMailboxFailureKind(state.last_error)).toBe("auth");
  });

  test("an SPKI mismatch disables at once, whatever the counter says", () => {
    // A certificate that stopped matching the pin is never a transient.
    const state = nextMailboxStateAfterFailure({ failure: { kind: "tls_pin", message: "pinned SPKI mismatch" }, auth_failure_count: 0 });

    expect(state.enabled).toBe(false);
    expect(state.last_error).toBe("tls_pin: pinned SPKI mismatch");
  });

  test("a network blip neither disables nor touches the strike count", () => {
    const state = nextMailboxStateAfterFailure({ failure: { kind: "network", message: "connect ECONNREFUSED" }, auth_failure_count: 2 });

    expect(state).toEqual({ enabled: true, auth_failure_count: 2, last_error: "network: connect ECONNREFUSED" });
  });
});

test("a driver error wrapped by drizzle reports the cause, not the query dump", () => {
  const driver = Object.assign(new Error("ignored in favour of sqlMessage"), {
    code: "ER_DATA_TOO_LONG",
    sqlMessage: "Data too long for column 'fromName' at row 7",
  });
  const wrapper = new Error(`Failed query: insert into \`Message\` ... params: ${"x".repeat(50_000)}`, { cause: driver });

  expect(classifyMailboxError(wrapper).message).toBe("Data too long for column 'fromName' at row 7");
});

test("an unwrapped driver message is capped so one batch cannot write 53KB of params", () => {
  const failure = classifyMailboxError(new Error("y".repeat(2_000)));

  expect(failure.message.length).toBe(501);
  expect(failure.message.endsWith("…")).toBe(true);
});

test("classification still sees a network code through the wrapper", () => {
  const driver = Object.assign(new Error("connect ETIMEDOUT"), { code: "ETIMEDOUT" });

  expect(classifyMailboxError(new Error("Failed query: ...", { cause: driver })).kind).toBe("network");
});

describe("the lastError prefix round-trips", () => {
  test("every failure kind survives being written to a text column and read back", () => {
    // Mailbox.lastError and SyncRun.errorMessage are plain text, so the kind lives as a prefix or is
    // lost — and losing it matters: a rotated certificate and a revoked app password both disable a
    // mailbox and need completely different responses.
    for (const kind of MAILBOX_FAILURE_KINDS) {
      const written = formatMailboxFailure({ kind, message: "something went wrong: with a colon in it" });
      expect(readMailboxFailureKind(written)).toBe(kind);
    }
  });

  test("the real recorded failure that disabled felix@tellmann.co.za reads as a pin problem", () => {
    const recorded = "tls_pin: pinned SPKI mismatch for mail.tellmann.co.za: server presented 8j0wCQLWS0MygJth8ZIqH6LAZlwhCRaIw46hpmJlgpg=";

    expect(readMailboxFailureKind(recorded)).toBe("tls_pin");
  });

  test("text this module did not write reads as unknown provenance, never as a guessed kind", () => {
    expect(readMailboxFailureKind(null)).toBeNull();
    expect(readMailboxFailureKind("something with no prefix at all")).toBeNull();
    expect(readMailboxFailureKind("nonsense: a plausible-looking prefix")).toBeNull();
  });
});
