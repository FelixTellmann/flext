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

export function classifyMailboxError(error: unknown): MailboxFailure {
  const message = error instanceof Error ? error.message : String(error);
  const code = readStringField(error, "code") ?? "";

  if (message.includes("pinned SPKI mismatch")) {
    return { kind: "tls_pin", message, disable_mailbox: true };
  }
  if (readBooleanField(error, "authenticationFailed") || code === "AUTHENTICATIONFAILED") {
    return { kind: "auth", message, disable_mailbox: true };
  }
  if (["ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND", "ECONNRESET", "EAI_AGAIN", "CONNECT_TIMEOUT"].includes(code)) {
    return { kind: "network", message, disable_mailbox: false };
  }
  return { kind: "unknown", message, disable_mailbox: false };
}
