export type MailboxCapabilities = {
  condstore: boolean;
  qresync: boolean;
  uidplus: boolean;
  move: boolean;
  gmail: boolean;
};

export type FolderInfo = {
  path: string;
  delimiter: string;
  special_use: string | null;
  subscribed: boolean;
  selectable: boolean;
};

export type FolderStatus = {
  path: string;
  uid_validity: string;
  uid_next: number;
  highest_modseq: string | null;
  exists: number;
};

export type HeaderMap = Record<string, string[]>;

export type MessageAddress = {
  name: string | null;
  address: string;
};

export type FetchedEnvelope = {
  subject: string | null;
  message_id: string | null;
  in_reply_to: string | null;
  date: Date | null;
  from: MessageAddress[];
  to: MessageAddress[];
  cc: MessageAddress[];
};

export type FetchedMessage = {
  uid: number;
  flags: string[];
  modseq: string | null;
  internal_date: Date;
  size: number;
  gm_msgid: string | null;
  gm_thrid: string | null;
  labels: string[] | null;
  envelope: FetchedEnvelope;
  headers: HeaderMap;
};

export type MessageIdentity = {
  uid: number;
  gm_msgid: string | null;
  message_id: string | null;
};

export type FlagChange = {
  uid: number;
  flags: string[];
  modseq: string | null;
};

export type FlagChangeResult = {
  changes: FlagChange[];
  vanished_uids: number[];
  qresync_used: boolean;
};

// RFC 4315 §3: a batched UID MOVE or UID COPY returns one COPYUID response code carrying the source
// set and the destination set as they arrived on the wire, pairing element N of one with element N of
// the other. imapflow parses that into a Map before we ever see it; a pair here is one entry of it.
export type UidPair = {
  source_uid: number;
  destination_uid: number;
};

// `pairs` and `unconfirmed_uids` together account for every UID the caller asked for, and never for
// any it did not. A server that relocates 399 of 400 messages reports 399 in COPYUID, and the 400th
// has no destination address — journalling it as relocated would orphan it until the next full sync
// and leave undo with nowhere to write (§7.2). It is returned rather than thrown because throwing
// would discard the 399 destination addresses that *are* known, turning a partial success into total
// loss; §11 marks only the unconfirmed UIDs failed.
export type CopyUidResult = {
  target_folder: string;
  destination_uid_validity: string;
  pairs: UidPair[];
  unconfirmed_uids: number[];
};

export type LabelResult = {
  folder: string;
  uids: number[];
  added_labels: string[];
  removed_labels: string[];
};

export type LabelChange = {
  add_labels: string[];
  remove_labels: string[];
};

// The mutating contract, opened in Phase 4 (§7.2) and widened in Phase 5 (§6). Phases 1-3 held this type
// strictly read-only and nothing under `server/mail` could change a mailbox at all. `moveMessages`,
// `setLabels` and `createFolder` are the ONLY members that may, they exist for
// `server/mail/actions/executor.ts`, `undo.ts` and `server/mail/filing/resolver.ts`, and they are
// implemented only in `server/mail/providers/imap.ts` — which is also the only file where a write lock
// may appear. `createFolder` is the narrowest of the three and takes no lock at all — see its own comment
// below for why. Every other method here, and every other file under `server/mail`, stays read-only.
//
// Each mutation resolves with the UIDs it actually confirmed, or throws. There is no partial-success
// return: the executor issues an ordered sequence per message and must be able to tell a wholly
// applied action from one that stopped halfway.
//
// `purge` is deliberately absent and must stay absent. §1.7 puts irreversible deletion behind a
// separate scheduled sweep (Phase 8) with its own dwell, digest and eligibility rules; a `purge`
// method here would put the one unrecoverable operation a single call away from the classification
// path. `copyMessages` and `expungeUids` were deleted for the same reason once a review found neither had
// a caller: the no-MOVE fallback finishes its move through a private helper inside imap.ts, so a public
// expunge was the only way to delete mail and nothing was reaching for it. This list exists to enumerate
// what can happen to a mailbox, which makes an entry no one calls worse than a missing one — Phase 8 adds
// back whatever its sweep genuinely needs.
export type MailboxProvider = {
  capabilities: MailboxCapabilities;
  listFolders: () => Promise<FolderInfo[]>;
  openFolder: (folder: string) => Promise<FolderStatus>;
  fetchHeaders: (folder: string, uid_range: string) => Promise<FetchedMessage[]>;
  fetchIdentities: (folder: string) => Promise<MessageIdentity[]>;
  fetchFlagChanges: (folder: string, since_modseq: string) => Promise<FlagChangeResult>;
  listUids: (folder: string) => Promise<number[]>;
  moveMessages: (folder: string, uids: number[], target_folder: string) => Promise<CopyUidResult>;
  setLabels: (folder: string, uids: number[], change: LabelChange) => Promise<LabelResult>;
  // Phase 5 (§6): filing creates a destination folder on first use. Deliberately the narrowest possible
  // mutation — it creates, and it cannot delete, rename, unsubscribe or move anything. A folder that
  // already exists is success, not an error, so the create-then-use path is idempotent under a race with
  // the operator's own mail client. Unlike moveMessages and setLabels this needs no selected mailbox and
  // therefore no write lock, which is why imap.ts still holds exactly one non-read-only getMailboxLock.
  createFolder: (folder: string) => Promise<void>;
  disconnect: () => Promise<void>;
};
