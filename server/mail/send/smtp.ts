import type { ConnectionOptions } from "node:tls";
import { db } from "@server/db/drizzle";
import { mailbox } from "@server/db/schema";
import type { MailboxConnection } from "@server/mail/mailbox";
import { mailboxConnection, mailboxIdentityAddresses } from "@server/mail/mailbox";
import { buildTlsOptions } from "@server/mail/providers/tls";
import { createTransport } from "nodemailer";
import type Mail from "nodemailer/lib/mailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";

export const SENDER_ADDRESS = "felix@tellmann.co.za";

// Submission over implicit TLS. The mailbox row stores the IMAP port (993); SMTP on the same host was
// verified 2026-09-06 to present the same pinned certificate on 465.
export const SMTP_PORT = 465;

export type SendMailInput = {
  to: string;
  subject: string;
  text: string;
  html?: string;
  headers?: Record<string, string>;
};

export type SendMailResult = {
  message_id: string;
  accepted: string[];
  rejected: string[];
};

export type SenderLoader = () => Promise<MailboxConnection>;

// The slice of nodemailer's Transporter sendMail uses, so a test can hand in a fake without fabricating
// the rest of SentMessageInfo.
export type TransportLike = {
  sendMail: (
    options: Mail.Options,
  ) => Promise<{ messageId: string; accepted: Array<string | Mail.Address>; rejected: Array<string | Mail.Address> }>;
  close: () => void;
};

export type SendMailDependencies = {
  loadSender: SenderLoader;
  createTransport: (options: SMTPTransport.Options) => TransportLike;
};

// /api/mail-digest awaits the send inside the request on purpose (a 202 would make a failed weekly send
// silent), and Bun closes a request socket idle for 10 s. nodemailer's defaults are 2 min to connect,
// 30 s for the greeting and 10 min per socket, so a stalled server would time out the request first and
// the failure would never be recorded. These keep the whole handshake under that ceiling.
export const SMTP_CONNECTION_TIMEOUT_MS = 3_000;
export const SMTP_GREETING_TIMEOUT_MS = 3_000;
export const SMTP_SOCKET_TIMEOUT_MS = 5_000;

export async function loadSenderMailbox(): Promise<MailboxConnection> {
  const rows = await db.select().from(mailbox);
  const matches = rows.filter((row) => mailboxIdentityAddresses(row).includes(SENDER_ADDRESS));
  if (matches.length !== 1) {
    throw new Error(`expected exactly one mailbox with identity ${SENDER_ADDRESS}, found ${matches.length}`);
  }
  return mailboxConnection(matches[0]);
}

export function buildTransportOptions(connection: MailboxConnection): SMTPTransport.Options {
  return {
    host: connection.host,
    port: SMTP_PORT,
    secure: true,
    auth: { user: connection.username, pass: connection.password },
    connectionTimeout: SMTP_CONNECTION_TIMEOUT_MS,
    greetingTimeout: SMTP_GREETING_TIMEOUT_MS,
    socketTimeout: SMTP_SOCKET_TIMEOUT_MS,
    // nodemailer Object.assigns this block into tls.connect (smtp-connection/index.js), the same path
    // imapflow takes, so the Bun dual-stack workaround documented on connectImapClient in
    // server/mail/providers/imap.ts rides here for the same reason.
    tls: {
      ...buildTlsOptions({ host: connection.host, tls_policy: connection.tls_policy, pinned_spki: connection.pinned_spki }),
      autoSelectFamily: false,
    } as ConnectionOptions & { autoSelectFamily: boolean },
  };
}

export function buildEnvelope(input: SendMailInput): Mail.Options {
  return {
    from: SENDER_ADDRESS,
    to: input.to,
    subject: input.subject,
    text: input.text,
    html: input.html,
    headers: input.headers,
  };
}

function toAddressStrings(entries: Array<string | Mail.Address>): string[] {
  return entries.map((entry) => (typeof entry === "string" ? entry : entry.address));
}

export async function sendMail(
  input: SendMailInput,
  dependencies: SendMailDependencies = { loadSender: loadSenderMailbox, createTransport },
): Promise<SendMailResult> {
  const connection = await dependencies.loadSender();
  const transporter = dependencies.createTransport(buildTransportOptions(connection));
  try {
    const info = await transporter.sendMail(buildEnvelope(input));
    return {
      message_id: info.messageId,
      accepted: toAddressStrings(info.accepted),
      rejected: toAddressStrings(info.rejected),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`smtp ${connection.host}:${SMTP_PORT} failed to send to ${input.to}: ${message}`, { cause: error });
  } finally {
    transporter.close();
  }
}
