export const MAILBOX_FAILURE_KINDS = ["auth", "tls_pin", "network", "unknown"] as const;

export type MailboxFailureKind = (typeof MAILBOX_FAILURE_KINDS)[number];

export type MailboxFailure = {
  kind: MailboxFailureKind;
  message: string;
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
    return { kind: "tls_pin", message };
  }
  if (
    readBooleanField(cause, "authenticationFailed") ||
    readBooleanField(error, "authenticationFailed") ||
    code === "AUTHENTICATIONFAILED"
  ) {
    return { kind: "auth", message };
  }
  if (["ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND", "ECONNRESET", "EAI_AGAIN", "CONNECT_TIMEOUT"].includes(code)) {
    return { kind: "network", message };
  }
  return { kind: "unknown", message };
}

// Consecutive auth failures on separate runs before a mailbox is disabled (docs/decisions/2026-09-06-auth-failure-three-strikes.md).
export const AUTH_FAILURE_DISABLE_THRESHOLD = 3;

export type MailboxStateAfterFailure = {
  enabled: boolean;
  auth_failure_count: number;
  last_error: string;
};

// What a failed run does to its mailbox, given the failure and the counter the row carried in. Pure, so
// the three-strike rule can be argued with from fixtures instead of from a live IMAP host.
//
// A changed certificate disables at once: a pinned SPKI that no longer matches is never transient. An
// auth error only counts a strike — on 2026-09-04 xneelo answered one login with an auth error after an
// hour of refused connections, and the stored password was valid the whole time. Network and unknown
// failures leave the counter alone: they say nothing about the password either way, and only a run that
// actually logged in (runMailboxSync's success path) resets it.
export function nextMailboxStateAfterFailure(input: { failure: MailboxFailure; auth_failure_count: number }): MailboxStateAfterFailure {
  const { failure, auth_failure_count } = input;
  if (failure.kind === "tls_pin") {
    return { enabled: false, auth_failure_count, last_error: formatMailboxFailure(failure) };
  }
  if (failure.kind === "auth") {
    const strikes = auth_failure_count + 1;
    return {
      enabled: strikes < AUTH_FAILURE_DISABLE_THRESHOLD,
      auth_failure_count: strikes,
      last_error: `${formatMailboxFailure(failure)} (strike ${strikes} of ${AUTH_FAILURE_DISABLE_THRESHOLD})`,
    };
  }
  return { enabled: true, auth_failure_count, last_error: formatMailboxFailure(failure) };
}

// The one spelling of what Mailbox.lastError and SyncRun.errorMessage hold. Both are plain text columns,
// so the kind has to survive as a prefix or be lost — and it must not be lost: "the certificate rotated
// again" and "the app password was revoked" both disable a mailbox and need completely different
// responses from the operator.
export function formatMailboxFailure(failure: Pick<MailboxFailure, "kind" | "message">): string {
  return `${failure.kind}: ${failure.message}`;
}

// The inverse, kept beside the writer so the two cannot drift. Null means the text was written by
// something other than formatMailboxFailure — an older build, or a hand-edited row — which is a real
// answer rather than a guess at which kind it might have been.
export function readMailboxFailureKind(last_error: string | null): MailboxFailureKind | null {
  if (last_error === null) {
    return null;
  }
  const separator = last_error.indexOf(":");
  if (separator === -1) {
    return null;
  }
  const prefix = last_error.slice(0, separator);
  return MAILBOX_FAILURE_KINDS.find((kind) => kind === prefix) ?? null;
}
