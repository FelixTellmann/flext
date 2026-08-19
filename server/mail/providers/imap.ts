import { zipCopyUid } from "@server/mail/actions/copyuid";
import type { MailboxConnection } from "@server/mail/mailbox";
import { HEADER_FIELDS, parseHeaderBlock } from "@server/mail/providers/headers";
import { buildTlsOptions } from "@server/mail/providers/tls";
import type {
  CopyUidResult,
  ExpungeResult,
  FetchedEnvelope,
  FetchedMessage,
  FlagChange,
  FlagChangeResult,
  FolderInfo,
  FolderStatus,
  LabelChange,
  LabelResult,
  MailboxCapabilities,
  MailboxProvider,
  MessageAddress,
  MessageIdentity,
} from "@server/mail/providers/types";
import type { MailboxFlavor } from "@server/mail/types";
import type { CopyResponseObject, ExpungeEvent, FetchMessageObject, FetchQueryObject, MessageAddressObject } from "imapflow";
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

function requireUidSet(uids: number[], operation: string): void {
  if (uids.length === 0) {
    throw new Error(
      `${operation} was given an empty UID set. An IMAP command without a sequence set is either a protocol error or, for an expunge, an instruction to act on the whole folder — so an empty batch is refused rather than issued.`,
    );
  }
  for (const uid of uids) {
    if (Number.isSafeInteger(uid) && uid >= 1) {
      continue;
    }
    throw new Error(`${operation} was given ${uid} as a UID; a UID set may only contain positive integers (RFC 3501 uid-set).`);
  }
}

// imapflow's command modules resolve with `undefined` when the mailbox is not SELECTED (and store.js
// also when X-GM-LABELS is asked of a server without X-GM-EXT-1), which its typings do not express.
// Anything other than a literal `true` therefore means the command did not reach the server.
function requireApplied(applied: boolean | undefined, command: string, folder: string): void {
  if (applied === true) {
    return;
  }
  throw new Error(`${command} in ${folder} did not complete; the mailbox is unchanged for that step and the sequence must stop here.`);
}

function toCopyUidResult(response: CopyResponseObject | false | undefined, command: string, target_folder: string): CopyUidResult {
  if (response === undefined || response === false) {
    throw new Error(`${command} into ${target_folder} did not complete; no message was relocated and nothing may be journalled for it.`);
  }

  const uid_map = response.uidMap;
  const uid_validity = response.uidValidity;
  if (uid_map === undefined || uid_validity === undefined) {
    throw new Error(
      `${command} into ${target_folder} returned no usable COPYUID (RFC 4315). imapflow drops the mapping silently when the source and destination sets disagree, so an absent map means either the server sent no COPYUID or it sent an inconsistent one — in both cases the destination UIDs are unknowable and undo would have no address to write to.`,
    );
  }

  return {
    target_folder: response.destination,
    destination_uid_validity: uid_validity.toString(),
    pairs: zipCopyUid([...uid_map.keys()], [...uid_map.values()]),
  };
}

export function buildImapProvider(client: ImapFlow, capabilities: MailboxCapabilities, flavor: MailboxFlavor): MailboxProvider {
  const gmail = capabilities.gmail && flavor === "gmail";

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

  function requireUidplus(operation: string): void {
    if (capabilities.uidplus) {
      return;
    }
    throw new Error(
      `${operation} needs UIDPLUS (RFC 4315), which this server does not advertise. Without UID EXPUNGE the only way to remove a message is a bare EXPUNGE, which destroys every \\Deleted-flagged message in the folder — including ones a human flagged by hand in their mail client minutes earlier. §1.7 makes destroying messages we never selected the failure mode to prevent, so this hard-fails instead of degrading.`,
    );
  }

  // The one write lock in `server/mail`. Every read path keeps `{ readOnly: true }`; this helper is
  // reached only from `moveMessages`, `copyMessages`, `setLabels` and `expungeUids`.
  async function withWriteLock<T>(folder: string, run: () => Promise<T>): Promise<T> {
    const lock = await client.getMailboxLock(folder, { readOnly: false });
    try {
      if (client.mailbox === false) {
        throw new Error(`could not open folder ${folder} for writing`);
      }
      return await run();
    } finally {
      lock.release();
    }
  }

  async function copyWithinLock(uids: number[], target_folder: string): Promise<CopyUidResult> {
    return toCopyUidResult(await client.messageCopy(uids, target_folder, { uid: true }), "UID COPY", target_folder);
  }

  // imapflow's expunge command is STORE +FLAGS (\Deleted) followed by `UID EXPUNGE <set>` — but only
  // while UIDPLUS is advertised; otherwise it silently issues a bare `EXPUNGE`
  // (node_modules/imapflow/lib/commands/expunge.js). `requireUidplus` at every call site is the only
  // thing standing between this line and that bare expunge.
  async function expungeWithinLock(uids: number[], folder: string): Promise<number[]> {
    requireApplied(await client.messageDelete(uids, { uid: true }), `UID EXPUNGE ${uids.join(",")}`, folder);
    return uids;
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

    moveMessages: async (folder: string, uids: number[], target_folder: string): Promise<CopyUidResult> => {
      requireUidSet(uids, "moveMessages");
      // A move needs UIDPLUS twice over: COPYUID is what §7.2 records as the destination address, and
      // the no-MOVE fallback below finishes with an expunge.
      requireUidplus("moveMessages");

      return withWriteLock(folder, async () => {
        // Branching on MOVE here rather than leaving it to imapflow is deliberate: its `messageMove`
        // silently emulates a move with COPY + messageDelete when the server lacks MOVE, and that
        // messageDelete is the call that degrades to a bare EXPUNGE. The emulation stays ours.
        if (capabilities.move) {
          return toCopyUidResult(await client.messageMove(uids, target_folder, { uid: true }), "UID MOVE", target_folder);
        }

        const copied = await copyWithinLock(uids, target_folder);
        await expungeWithinLock(uids, folder);
        return copied;
      });
    },

    copyMessages: async (folder: string, uids: number[], target_folder: string): Promise<CopyUidResult> => {
      requireUidSet(uids, "copyMessages");
      requireUidplus("copyMessages");
      return withWriteLock(folder, () => copyWithinLock(uids, target_folder));
    },

    setLabels: async (folder: string, uids: number[], change: LabelChange): Promise<LabelResult> => {
      requireUidSet(uids, "setLabels");
      if (!gmail) {
        throw new Error(
          "setLabels needs a Gmail label store — X-GM-EXT-1 advertised by the server and a gmail-flavoured mailbox. On a folder server a label write has no meaning and imapflow would drop the STORE without telling anyone.",
        );
      }

      const { add_labels, remove_labels } = change;
      if (add_labels.length === 0 && remove_labels.length === 0) {
        throw new Error(
          "setLabels was given nothing to add and nothing to remove; an action that changes no label must be dropped by the caller, not issued as an empty STORE.",
        );
      }

      return withWriteLock(folder, async () => {
        // Additions go first so a failure between the two STOREs leaves the message carrying a label it
        // should not, never having lost one — the recoverable direction.
        if (add_labels.length > 0) {
          const applied = await client.messageFlagsAdd(uids, add_labels, { uid: true, useLabels: true });
          requireApplied(applied, `STORE +X-GM-LABELS (${add_labels.join(" ")})`, folder);
        }
        if (remove_labels.length > 0) {
          const applied = await client.messageFlagsRemove(uids, remove_labels, { uid: true, useLabels: true });
          requireApplied(applied, `STORE -X-GM-LABELS (${remove_labels.join(" ")})`, folder);
        }
        return { folder, uids, added_labels: add_labels, removed_labels: remove_labels };
      });
    },

    expungeUids: async (folder: string, uids: number[]): Promise<ExpungeResult> => {
      requireUidSet(uids, "expungeUids");
      requireUidplus("expungeUids");
      return withWriteLock(folder, async () => ({ folder, expunged_uids: await expungeWithinLock(uids, folder) }));
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

  return buildImapProvider(client, readCapabilities(client), connection.flavor);
}
