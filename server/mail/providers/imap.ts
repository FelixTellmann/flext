import type { ConnectionOptions } from "node:tls";
import type { MailboxConnection } from "@server/mail/mailbox";
import { HEADER_FIELDS, parseHeaderBlock } from "@server/mail/providers/headers";
import type { MessagePart } from "@server/mail/providers/structure";
import { buildTlsOptions } from "@server/mail/providers/tls";
import type {
  CopyUidResult,
  FetchedEnvelope,
  FetchedMessage,
  FlagChange,
  FlagChangeResult,
  FlagWrite,
  FlagWriteResult,
  FolderInfo,
  FolderStatus,
  LabelChange,
  LabelResult,
  MailboxCapabilities,
  MailboxProvider,
  MessageAddress,
  MessageIdentity,
  UidPair,
} from "@server/mail/providers/types";
import type { MailboxFlavor } from "@server/mail/types";
import type {
  CopyResponseObject,
  ExpungeEvent,
  FetchMessageObject,
  FetchQueryObject,
  MessageAddressObject,
  MessageStructureObject,
} from "imapflow";
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

// imapflow's MessageStructureObject narrowed to the four fields server/mail/providers/structure.ts asks
// about. Everything dropped — part numbers, encodings, sizes, embedded envelopes — is either
// content-adjacent or of no use to "what kind of message is this", and carrying it would invite a caller
// to reach for it later.
//
// A filename can arrive on either Content-Disposition or the legacy Content-Type `name` parameter, and
// senders that omit the disposition entirely tend to be the ones using `name`.
function toMessagePart(node: MessageStructureObject | undefined): MessagePart | null {
  if (node === undefined) {
    return null;
  }
  return {
    type: node.type ?? "",
    disposition: node.disposition ?? null,
    filename: node.dispositionParameters?.filename ?? node.parameters?.name ?? null,
    child_parts: (node.childNodes ?? []).map((child) => toMessagePart(child)).filter((child): child is MessagePart => child !== null),
  };
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

// ALREADYEXISTS (RFC 5530) is the tagged response code; servers that predate it answer with a NO whose
// text says so. Matching the code first and the text second keeps the string test from being the only
// thing standing between a real failure and a silently swallowed one.
function isAlreadyExistsError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const response_code = "responseCode" in error ? String(error.responseCode) : "";
  if (response_code.toUpperCase() === "ALREADYEXISTS") {
    return true;
  }
  const text = "responseText" in error ? String(error.responseText) : "";
  return /already exists/i.test(text);
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

function toCopyUidResult(
  response: CopyResponseObject | false | undefined,
  command: string,
  target_folder: string,
  requested_uids: number[],
): CopyUidResult {
  if (response === undefined || response === false) {
    throw new Error(`${command} into ${target_folder} did not complete; no message was relocated and nothing may be journalled for it.`);
  }

  const uid_map = response.uidMap;
  const uid_validity = response.uidValidity;
  if (uid_map === undefined || uid_validity === undefined) {
    throw new Error(
      `${command} into ${target_folder} returned no usable COPYUID (RFC 4315). imapflow drops the mapping silently when the source and destination sets disagree, so an absent map means either the server sent no COPYUID or it sent an inconsistent one — in both cases nothing is knowable and every UID in the batch is unaddressable.`,
    );
  }

  // Walking the requested set rather than the map is what makes the result honest in both directions:
  // a UID the server never reported lands in `unconfirmed_uids` instead of silently vanishing, and a
  // destination the caller never asked for cannot be journalled.
  const pairs: UidPair[] = [];
  const unconfirmed_uids: number[] = [];
  for (const source_uid of requested_uids) {
    const destination_uid = uid_map.get(source_uid);
    if (destination_uid === undefined) {
      unconfirmed_uids.push(source_uid);
      continue;
    }
    pairs.push({ source_uid, destination_uid });
  }

  return {
    target_folder: response.destination,
    destination_uid_validity: uid_validity.toString(),
    pairs,
    unconfirmed_uids,
  };
}

export function buildImapProvider(client: ImapFlow, capabilities: MailboxCapabilities, flavor: MailboxFlavor): MailboxProvider {
  const gmail = capabilities.gmail && flavor === "gmail";

  const message_query: FetchQueryObject = {
    uid: true,
    flags: true,
    envelope: true,
    // §1.1 of the calendar-detection spec: the server DESCRIBES the MIME tree and sends none of it, on
    // this same round trip. No body is transferred and none is stored.
    bodyStructure: true,
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
      structure: toMessagePart(raw.bodyStructure),
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
  // reached only from `moveMessages`, `setLabels` and `setFlags`, the interface's three message-mutating
  // members. `createFolder` addresses no messages and takes no lock at all.
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
    return toCopyUidResult(await client.messageCopy(uids, target_folder, { uid: true }), "UID COPY", target_folder, uids);
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
          return toCopyUidResult(await client.messageMove(uids, target_folder, { uid: true }), "UID MOVE", target_folder, uids);
        }

        const copied = await copyWithinLock(uids, target_folder);

        // Only what COPYUID confirmed may be expunged. A UID the server did not report has no copy at
        // the destination as far as anyone can prove, and expunging it here would delete the only
        // remaining instance of that message.
        const confirmed_uids = copied.pairs.map((pair) => pair.source_uid);
        if (confirmed_uids.length > 0) {
          await expungeWithinLock(confirmed_uids, folder);
        }
        return copied;
      });
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

    setFlags: async (folder: string, uids: number[], change: FlagWrite): Promise<FlagWriteResult> => {
      requireUidSet(uids, "setFlags");

      const { add_flags, remove_flags } = change;
      if (add_flags.length === 0 && remove_flags.length === 0) {
        throw new Error(
          "setFlags was given nothing to add and nothing to remove; an action that changes no flag must be dropped by the caller, not issued as an empty STORE.",
        );
      }

      return withWriteLock(folder, async () => {
        // messageFlagsAdd / messageFlagsRemove issue STORE +FLAGS and -FLAGS. messageFlagsSet, which
        // issues a bare STORE FLAGS, must never be reached from here: a bare set clears every flag it is
        // not given, and that includes \Flagged — the operator's hold signal and an absolute guard in
        // classify/guards.ts. Losing it would silently unprotect exactly the mail he protected by hand.
        //
        // Additions first, matching setLabels above and for the same reason: a failure between the two
        // STOREs then leaves the message carrying a flag it should not, never having lost one.
        if (add_flags.length > 0) {
          const applied = await client.messageFlagsAdd(uids, add_flags, { uid: true });
          requireApplied(applied, `STORE +FLAGS (${add_flags.join(" ")})`, folder);
        }
        if (remove_flags.length > 0) {
          const applied = await client.messageFlagsRemove(uids, remove_flags, { uid: true });
          requireApplied(applied, `STORE -FLAGS (${remove_flags.join(" ")})`, folder);
        }
        return { folder, uids, added_flags: add_flags, removed_flags: remove_flags };
      });
    },

    createFolder: async (folder: string): Promise<void> => {
      // imapflow resolves with { created: false } when the mailbox already exists on servers that report
      // ALREADYEXISTS, and throws on those that return a plain NO. Both mean the folder is there, which is
      // the postcondition this method promises, so neither is an error. Anything else propagates.
      try {
        await client.mailboxCreate(folder);
      } catch (error) {
        if (!isAlreadyExistsError(error)) {
          throw error;
        }
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

// The connected client on its own, for operator scripts that need an IMAP command the provider
// deliberately does not offer (a folder RENAME, for tmp/flatten-tellmann-folders.ts). MailboxProvider
// enumerates what the product may do to a mailbox and a one-off script is not the product; this keeps
// the TLS pin and the dual-stack workaround in one place without widening that enumeration.
export async function connectImapClient(connection: MailboxConnection): Promise<ImapFlow> {
  const client = new ImapFlow({
    host: connection.host,
    port: connection.port,
    secure: true,
    servername: connection.host,
    auth: { user: connection.username, pass: connection.password },
    // `autoSelectFamily` is a net socket option and node's TLS typings do not declare it, but tls.connect
    // forwards socket options to the underlying connect — verified here by passing `family: 6` and
    // watching the socket come back IPv6. The widening says exactly that and nothing more.
    tls: {
      ...buildTlsOptions({ host: connection.host, tls_policy: connection.tls_policy, pinned_spki: connection.pinned_spki }),
      // Bun 1.3.6 kills the PROCESS during a dual-stack connect on a slow link, with a TypeError that no
      // try/catch around this call can see because it is thrown from a timer callback:
      //
      //   Cannot destructure property 'subject' from null or undefined value
      //     at checkServerIdentity (node:tls) ... at internalConnectMultipleTimeout (node:net)
      //
      // imap.gmail.com publishes both A and AAAA records, so Node races an IPv4 and an IPv6 socket and
      // drops the loser after 250ms. On a slow link that timer fires mid-handshake, and Bun then runs the
      // TLS completion path over the socket it just closed — where getPeerCertificate() returns nothing
      // and node's own checkServerIdentity destructures null. Not racing is the only fix available from
      // here, and it costs nothing: both families resolve, so the connection is simply deterministic.
      //
      // imapflow spreads this object straight into tls.connect (imap-flow.js: Object.assign with
      // options.tls), which is why a socket-level option belongs in the TLS block.
      autoSelectFamily: false,
    } as ConnectionOptions & { autoSelectFamily: boolean },
    qresync: true,
    disableAutoIdle: true,
    logger: false,
  });

  await client.connect();
  return client;
}

export async function createImapProvider(connection: MailboxConnection): Promise<MailboxProvider> {
  const client = await connectImapClient(connection);
  return buildImapProvider(client, readCapabilities(client), connection.flavor);
}
