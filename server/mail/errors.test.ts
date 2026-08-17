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
