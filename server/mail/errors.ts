export type MailboxFailureKind = "auth" | "tls_pin" | "network" | "unknown";

export type MailboxFailure = {
  kind: MailboxFailureKind;
  message: string;
  disable_mailbox: boolean;
};

function readStringField(value: unknown, field: string): string | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const candidate = (value as Record<string, unknown>)[field];
  return typeof candidate === "string" ? candidate : null;
}

function readBooleanField(value: unknown, field: string): boolean {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  return (value as Record<string, unknown>)[field] === true;
}

// Drizzle wraps driver failures in a DrizzleQueryError whose message is the SQL plus every bound
// parameter — 53KB for one batch insert — while the actual reason (ER_DATA_TOO_LONG and friends) sits on
// .cause. Classifying the wrapper reports "unknown" and records noise, so unwrap before doing either.
function rootCause(error: unknown): unknown {
  let current = error;
  for (let depth = 0; depth < 5; depth += 1) {
    if (typeof current !== "object" || current === null) {
      return current;
    }
    const next = (current as { cause?: unknown }).cause;
    if (next === undefined || next === null) {
      return current;
    }
    current = next;
  }
  return current;
}

const MAX_MESSAGE_LENGTH = 500;

function describe(error: unknown): string {
  const sql_message = readStringField(error, "sqlMessage");
  const text = sql_message ?? (error instanceof Error ? error.message : String(error));
  return text.length > MAX_MESSAGE_LENGTH ? `${text.slice(0, MAX_MESSAGE_LENGTH)}…` : text;
}

export function classifyMailboxError(error: unknown): MailboxFailure {
  const cause = rootCause(error);
  const message = describe(cause);
  const code = readStringField(cause, "code") ?? readStringField(error, "code") ?? "";

  if (message.includes("pinned SPKI mismatch")) {
    return { kind: "tls_pin", message, disable_mailbox: true };
  }
  if (
    readBooleanField(cause, "authenticationFailed") ||
    readBooleanField(error, "authenticationFailed") ||
    code === "AUTHENTICATIONFAILED"
  ) {
    return { kind: "auth", message, disable_mailbox: true };
  }
  if (["ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND", "ECONNRESET", "EAI_AGAIN", "CONNECT_TIMEOUT"].includes(code)) {
    return { kind: "network", message, disable_mailbox: false };
  }
  return { kind: "unknown", message, disable_mailbox: false };
}
