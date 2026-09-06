import { db } from "@server/db/drizzle";
import { message } from "@server/db/schema";
import type { SendMailInput, SendMailResult } from "@server/mail/send/smtp";
import { sendMail } from "@server/mail/send/smtp";
import type { UnsubscribeAttemptRecord } from "@server/mail/unsubscribe/attempts";
import { recordUnsubscribeAttempt } from "@server/mail/unsubscribe/attempts";
import { parseListUnsubscribe } from "@server/mail/unsubscribe/parse";
import { and, desc, isNotNull, isNull, sql } from "drizzle-orm";

// The mailto half of List-Unsubscribe: one message to the address the header names, always from
// felix@tellmann.co.za (docs/decisions/2026-09-06-sending-account-and-digest.md). The http half lives in
// one-click.ts; bulk.ts picks between them per sender.

export type MailtoRequest = {
  to: string;
  subject: string;
  body: string;
};

export type MailtoOutcome = {
  status: "sent" | "failed";
  error: string | null;
};

export type SendLike = (input: SendMailInput) => Promise<SendMailResult>;

// What a list manager expects when the header gives no subject or body; some parse the subject, some the
// body, so both carry the word.
export const DEFAULT_UNSUBSCRIBE_TEXT = "unsubscribe";

// RFC 6068 §2: percent-decoding only, never form decoding, so a literal "+" in a subject stays a "+".
function decodeComponent(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

// RFC 6068: `mailto:` addr-spec list, then an optional `?` query of header fields. A `to` field in the
// query appends recipients; `subject` and `body` are the only other fields sent, because an arbitrary
// header from a sender-controlled URL is not something this server should put on its own mail.
export function parseMailto(raw: string): MailtoRequest | null {
  const match = /^mailto:([^?]*)(?:\?(.*))?$/is.exec(raw.trim());
  if (match === null) {
    return null;
  }

  const recipients = match[1]
    .split(",")
    .map((part) => decodeComponent(part.trim()))
    .filter((part) => part.length > 0);
  let subject: string | null = null;
  let body: string | null = null;

  for (const pair of (match[2] ?? "").split("&")) {
    if (pair.length === 0) {
      continue;
    }
    const separator = pair.indexOf("=");
    const name = decodeComponent(separator === -1 ? pair : pair.slice(0, separator)).toLowerCase();
    const value = separator === -1 ? "" : decodeComponent(pair.slice(separator + 1));
    if (name === "to" && value.length > 0) {
      recipients.push(
        ...value
          .split(",")
          .map((part) => part.trim())
          .filter((part) => part.length > 0),
      );
    }
    if (name === "subject") {
      subject = value;
    }
    if (name === "body") {
      body = value;
    }
  }

  if (recipients.length === 0 || recipients.some((recipient) => !recipient.includes("@"))) {
    return null;
  }

  return {
    to: recipients.join(", "),
    subject: subject === null || subject.trim().length === 0 ? DEFAULT_UNSUBSCRIBE_TEXT : subject,
    body: body === null || body.trim().length === 0 ? DEFAULT_UNSUBSCRIBE_TEXT : body,
  };
}

export async function performMailtoUnsubscribe(input: { mailto: string; send?: SendLike }): Promise<MailtoOutcome> {
  const request = parseMailto(input.mailto);
  if (request === null) {
    return { status: "failed", error: `not a usable mailto URL: ${input.mailto}` };
  }

  const send = input.send ?? sendMail;
  try {
    const result = await send({ to: request.to, subject: request.subject, text: request.body });
    if (result.rejected.length > 0) {
      return { status: "failed", error: `smtp rejected ${result.rejected.join(", ")}` };
    }
    return { status: "sent", error: null };
  } catch (error) {
    return { status: "failed", error: error instanceof Error ? error.message : String(error) };
  }
}

export type MailtoSource = { mailbox_id: string; list_unsubscribe: string | null };

export type MailtoTarget = { mailbox_id: string; mailto: string };

// The newest message from the sender whose header carries a mailto; the http target is ignored here
// because the caller already decided the sender has no one-click route.
export function pickMailtoTarget(rows: MailtoSource[]): MailtoTarget | null {
  for (const row of rows) {
    const target = parseListUnsubscribe(row.list_unsubscribe);
    if (target.mailto !== null) {
      return { mailbox_id: row.mailbox_id, mailto: target.mailto };
    }
  }
  return null;
}

export async function loadMailtoSources(from_address: string): Promise<MailtoSource[]> {
  return db
    .select({ mailbox_id: message.mailbox_id, list_unsubscribe: message.list_unsubscribe })
    .from(message)
    .where(
      and(
        sql`LOWER(${message.from_address}) = LOWER(${from_address})`,
        isNotNull(message.list_unsubscribe),
        isNull(message.disappeared_at),
      ),
    )
    .orderBy(desc(message.internal_date))
    .limit(10);
}

export type MailtoDependencies = {
  send: SendLike;
  loadSources: (from_address: string) => Promise<MailtoSource[]>;
  record: typeof recordUnsubscribeAttempt;
};

const live_dependencies: MailtoDependencies = { send: sendMail, loadSources: loadMailtoSources, record: recordUnsubscribeAttempt };

// The mailto half of bulk.ts's attemptUnsubscribe: one attempt, recorded whatever happened, so the
// chip on /admin/unsubscribe shows it. Skipped, and recorded as such, when no message offers a mailto.
export async function unsubscribeMailtoSender(
  input: { from_address: string; now: Date },
  dependencies: MailtoDependencies = live_dependencies,
): Promise<UnsubscribeAttemptRecord> {
  const target = pickMailtoTarget(await dependencies.loadSources(input.from_address));
  if (target === null) {
    return dependencies.record({
      sender_address: input.from_address,
      mailbox_id: null,
      method: "mailto",
      status: "skipped",
      response_code: null,
      error: "no message from this sender carries a mailto List-Unsubscribe target",
      attempted_at: input.now,
    });
  }

  const outcome = await performMailtoUnsubscribe({ mailto: target.mailto, send: dependencies.send });
  return dependencies.record({
    sender_address: input.from_address,
    mailbox_id: target.mailbox_id,
    method: "mailto",
    status: outcome.status,
    response_code: null,
    error: outcome.error,
    attempted_at: input.now,
  });
}
