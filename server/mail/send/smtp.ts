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
  dependencies: { loadSender: SenderLoader } = { loadSender: loadSenderMailbox },
): Promise<SendMailResult> {
  const connection = await dependencies.loadSender();
  const transporter = createTransport(buildTransportOptions(connection));
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
