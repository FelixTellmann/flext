import type { MailboxConnection } from "@server/mail/mailbox";
import { HEADER_FIELDS, parseHeaderBlock } from "@server/mail/providers/headers";
import { buildTlsOptions } from "@server/mail/providers/tls";
import type {
  FetchedEnvelope,
  FetchedMessage,
  FlagChange,
  FlagChangeResult,
  FolderInfo,
  FolderStatus,
  MailboxCapabilities,
  MailboxProvider,
  MessageAddress,
  MessageIdentity,
} from "@server/mail/providers/types";
import type { ExpungeEvent, FetchMessageObject, FetchQueryObject, MessageAddressObject } from "imapflow";
import { ImapFlow } from "imapflow";

function readCapabilities(client: ImapFlow): MailboxCapabilities {
  return {
    condstore: client.capabilities.has("CONDSTORE"),
    qresync: client.enabled.has("QRESYNC"),
    uidplus: client.capabilities.has("UIDPLUS"),
    move: client.capabilities.has("MOVE"),
    gmail: client.capabilities.has("X-GM-EXT-1"),
  };
}

function toAddresses(entries: MessageAddressObject[] | undefined): MessageAddress[] {
  return (entries ?? [])
    .filter((entry): entry is MessageAddressObject & { address: string } => typeof entry.address === "string")
    .map((entry) => ({ name: entry.name ?? null, address: entry.address.toLowerCase() }));
}

function toEnvelope(raw: FetchMessageObject): FetchedEnvelope {
  const envelope = raw.envelope;
  return {
    subject: envelope?.subject ?? null,
    message_id: envelope?.messageId ?? null,
    in_reply_to: envelope?.inReplyTo ?? null,
    date: envelope?.date ?? null,
    from: toAddresses(envelope?.from),
    to: toAddresses(envelope?.to),
    cc: toAddresses(envelope?.cc),
  };
}

function toInternalDate(raw: FetchMessageObject): Date {
  if (raw.internalDate instanceof Date) {
    return raw.internalDate;
  }
  if (typeof raw.internalDate === "string") {
    return new Date(raw.internalDate);
  }
  return new Date();
}

export async function createImapProvider(connection: MailboxConnection): Promise<MailboxProvider> {
  const client = new ImapFlow({
    host: connection.host,
    port: connection.port,
    secure: true,
    servername: connection.host,
    auth: { user: connection.username, pass: connection.password },
    tls: buildTlsOptions({ host: connection.host, tls_policy: connection.tls_policy, pinned_spki: connection.pinned_spki }),
    qresync: true,
    disableAutoIdle: true,
    logger: false,
  });

  await client.connect();

  const capabilities = readCapabilities(client);
  const gmail = capabilities.gmail && connection.flavor === "gmail";

  const message_query: FetchQueryObject = {
    uid: true,
    flags: true,
    envelope: true,
    internalDate: true,
    size: true,
    threadId: gmail,
    labels: gmail,
    // `source` stays off and `headers` compiles to BODY.PEEK[HEADER.FIELDS (...)] — see HEADER_FETCH_SPEC.
    // A bare BODY[] fetch would set \Seen on every message it read (§4.2).
    source: false,
    headers: [...HEADER_FIELDS],
  };

  function toFetchedMessage(raw: FetchMessageObject): FetchedMessage {
    return {
      uid: raw.uid,
      flags: [...(raw.flags ?? [])],
      modseq: raw.modseq?.toString() ?? null,
      internal_date: toInternalDate(raw),
      size: raw.size ?? 0,
      gm_msgid: gmail ? (raw.emailId ?? null) : null,
      gm_thrid: gmail ? (raw.threadId ?? null) : null,
      labels: raw.labels ? [...raw.labels] : null,
      envelope: toEnvelope(raw),
      headers: parseHeaderBlock(raw.headers),
    };
  }

  return {
    capabilities,

    listFolders: async () => {
      const entries = await client.list();
      return entries.map<FolderInfo>((entry) => ({
        path: entry.path,
        delimiter: entry.delimiter,
        special_use: entry.specialUse ?? null,
        subscribed: entry.subscribed,
        selectable: !entry.flags.has("\\Noselect"),
      }));
    },

    openFolder: async (folder: string): Promise<FolderStatus> => {
      const lock = await client.getMailboxLock(folder, { readOnly: true });
      try {
        const opened = client.mailbox;
        if (opened === false) {
          throw new Error(`could not open folder ${folder}`);
        }
        return {
          path: opened.path,
          uid_validity: opened.uidValidity.toString(),
          uid_next: opened.uidNext,
          highest_modseq: opened.highestModseq?.toString() ?? null,
          exists: opened.exists,
        };
      } finally {
        lock.release();
      }
    },

    fetchHeaders: async (folder: string, uid_range: string): Promise<FetchedMessage[]> => {
      const messages: FetchedMessage[] = [];
      const lock = await client.getMailboxLock(folder, { readOnly: true });
      try {
        for await (const raw of client.fetch(uid_range, message_query, { uid: true })) {
          messages.push(toFetchedMessage(raw));
        }
      } finally {
        lock.release();
      }
      return messages;
    },

    fetchIdentities: async (folder: string): Promise<MessageIdentity[]> => {
      const identities: MessageIdentity[] = [];
      const lock = await client.getMailboxLock(folder, { readOnly: true });
      try {
        for await (const raw of client.fetch("1:*", { uid: true, envelope: true }, { uid: true })) {
          identities.push({
            uid: raw.uid,
            gm_msgid: gmail ? (raw.emailId ?? null) : null,
            message_id: raw.envelope?.messageId ?? null,
          });
        }
      } finally {
        lock.release();
      }
      return identities;
    },

    fetchFlagChanges: async (folder: string, since_modseq: string): Promise<FlagChangeResult> => {
      const changes: FlagChange[] = [];
      const vanished_uids: number[] = [];

      const collectVanished = (event: ExpungeEvent) => {
        if (event.path !== folder || event.vanished !== true || typeof event.uid !== "number") {
          return;
        }
        vanished_uids.push(event.uid);
      };

      client.on("expunge", collectVanished);
      const lock = await client.getMailboxLock(folder, { readOnly: true });
      try {
        // UID FETCH 1:* (UID FLAGS MODSEQ) (CHANGEDSINCE <modseq> VANISHED): the modifier is a second
        // parenthesized list, the fetch must be a UID fetch to key on something stable, and imapflow only
        // appends VANISHED when QRESYNC is enabled — which is what makes expunges visible at all (§4.2, §4.3).
        for await (const raw of client.fetch("1:*", { uid: true, flags: true }, { uid: true, changedSince: BigInt(since_modseq) })) {
          changes.push({ uid: raw.uid, flags: [...(raw.flags ?? [])], modseq: raw.modseq?.toString() ?? null });
        }
      } finally {
        lock.release();
        client.removeListener("expunge", collectVanished);
      }

      return { changes, vanished_uids, qresync_used: capabilities.qresync };
    },

    listUids: async (folder: string): Promise<number[]> => {
      const lock = await client.getMailboxLock(folder, { readOnly: true });
      try {
        const result = await client.search({ all: true }, { uid: true });
        if (result === false) {
          throw new Error(`UID SEARCH ALL failed for folder ${folder}`);
        }
        return result;
      } finally {
        lock.release();
      }
    },

    disconnect: async () => {
      try {
        await client.logout();
      } catch {
        client.close();
      }
    },
  };
}
