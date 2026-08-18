import { z } from "zod";

export type MailboxFlavor = "gmail" | "generic";
export type TlsPolicy = "strict" | "pinned";
export type SyncMode = "incremental" | "reconcile" | "backfill" | "repair" | "reclassify";

// SyncRun.mailboxId is notNull with no FK (server/db/schema.ts has no .references() on it), but a
// `repair` run touches Message/Sender directly and belongs to no single mailbox. This sentinel keeps the
// notNull contract satisfied without misattributing the row to an arbitrary real mailbox. Exported so
// both the writer (server/mail/sync/run.ts) and any future reader (e.g. a dashboard filtering these rows
// out) share one definition instead of retyping the literal.
export const DATABASE_WIDE_RUN_MAILBOX_ID = "__database_wide__";

// Gmail is a label store: a message with labels INBOX and Work is visible in three folders with three
// different UIDs, so only [Gmail]/All Mail is ever walked (§4.1).
export const GMAIL_CANONICAL_FOLDER = "[Gmail]/All Mail";

export const mailbox_flavor_schema = z.enum(["gmail", "generic"]);
export const tls_policy_schema = z.enum(["strict", "pinned"]);
export const sync_mode_schema = z.enum(["incremental", "reconcile", "backfill", "repair", "reclassify"]);

const string_list_schema = z.array(z.string());

export function parseStringList(raw: string | null): string[] {
  if (raw === null || raw.length === 0) {
    return [];
  }
  try {
    const parsed = string_list_schema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

export function serializeStringList(values: string[]): string {
  return JSON.stringify(values);
}

export function parseMailboxFlavor(raw: string): MailboxFlavor {
  return mailbox_flavor_schema.catch("generic").parse(raw);
}

export function parseTlsPolicy(raw: string): TlsPolicy {
  return tls_policy_schema.catch("strict").parse(raw);
}
