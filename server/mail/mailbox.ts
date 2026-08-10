import type { mailbox } from "@server/db/schema";
import { decryptCredential } from "@server/mail/crypto/credentials";
import type { MailboxFlavor, TlsPolicy } from "@server/mail/types";
import { parseMailboxFlavor, parseStringList, parseTlsPolicy } from "@server/mail/types";

export type MailboxRow = typeof mailbox.$inferSelect;

export type MailboxConnection = {
  host: string;
  port: number;
  username: string;
  password: string;
  flavor: MailboxFlavor;
  tls_policy: TlsPolicy;
  pinned_spki: string[];
};

export function mailboxConnection(row: MailboxRow): MailboxConnection {
  return {
    host: row.host,
    port: row.port,
    username: row.username,
    password: decryptCredential({
      ciphertext: row.credential_ciphertext,
      iv: row.credential_iv,
      auth_tag: row.credential_auth_tag,
      key_version: row.credential_key_version,
    }),
    flavor: parseMailboxFlavor(row.flavor),
    tls_policy: parseTlsPolicy(row.tls_policy),
    pinned_spki: parseStringList(row.pinned_spki),
  };
}

export function mailboxIdentityAddresses(row: MailboxRow): string[] {
  return parseStringList(row.identity_addresses);
}
