import { describe, expect, test } from "bun:test";
import { classifyMailboxError, formatMailboxFailure, MAILBOX_FAILURE_KINDS, readMailboxFailureKind } from "./errors";

test("an SPKI mismatch is a hard stop that disables the mailbox", () => {
  const failure = classifyMailboxError(new Error("pinned SPKI mismatch for mail.example.com: server presented abc="));

  expect(failure.kind).toBe("tls_pin");
  expect(failure.disable_mailbox).toBe(true);
});

test("an expired app password disables the mailbox instead of retrying", () => {
  const error = Object.assign(new Error("Invalid credentials"), { authenticationFailed: true });

  expect(classifyMailboxError(error)).toEqual({ kind: "auth", message: "Invalid credentials", disable_mailbox: true });
});

test("a network blip keeps the mailbox enabled", () => {
  const error = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
  const failure = classifyMailboxError(error);

  expect(failure.kind).toBe("network");
  expect(failure.disable_mailbox).toBe(false);
});

test("a non-Error rejection still classifies", () => {
  expect(classifyMailboxError("boom")).toEqual({ kind: "unknown", message: "boom", disable_mailbox: false });
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
