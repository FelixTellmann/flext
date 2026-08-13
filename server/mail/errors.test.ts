import { expect, test } from "bun:test";
import { classifyMailboxError } from "./errors";

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
