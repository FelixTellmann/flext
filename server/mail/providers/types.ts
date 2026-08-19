import type { UidPair } from "@server/mail/actions/copyuid";

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

export type CopyUidResult = {
  target_folder: string;
  destination_uid_validity: string;
  pairs: UidPair[];
};

export type LabelResult = {
  folder: string;
  uids: number[];
  added_labels: string[];
  removed_labels: string[];
};

export type ExpungeResult = {
  folder: string;
  expunged_uids: number[];
};

export type LabelChange = {
  add_labels: string[];
  remove_labels: string[];
};

// The mutating contract, opened in Phase 4 (§7.2). Phases 1-3 held this type strictly read-only and
// nothing under `server/mail` could change a mailbox at all. `moveMessages`, `copyMessages`,
// `setLabels` and `expungeUids` are the ONLY members that may, they exist for
// `server/mail/actions/executor.ts` and `undo.ts`, and they are implemented only in
// `server/mail/providers/imap.ts` — which is also the only file where a write lock may appear. Every
// other method here, and every other file under `server/mail`, stays read-only.
//
// Each mutation resolves with the UIDs it actually confirmed, or throws. There is no partial-success
// return: the executor issues an ordered sequence per message and must be able to tell a wholly
// applied action from one that stopped halfway.
//
// `purge` is deliberately absent and must stay absent. §1.7 puts irreversible deletion behind a
// separate scheduled sweep (Phase 8) with its own dwell, digest and eligibility rules; a `purge`
// method here would put the one unrecoverable operation a single call away from the classification
// path. `expungeUids` exists only so the no-MOVE fallback can finish a move it has already copied.
export type MailboxProvider = {
  capabilities: MailboxCapabilities;
  listFolders: () => Promise<FolderInfo[]>;
  openFolder: (folder: string) => Promise<FolderStatus>;
  fetchHeaders: (folder: string, uid_range: string) => Promise<FetchedMessage[]>;
  fetchIdentities: (folder: string) => Promise<MessageIdentity[]>;
  fetchFlagChanges: (folder: string, since_modseq: string) => Promise<FlagChangeResult>;
  listUids: (folder: string) => Promise<number[]>;
  moveMessages: (folder: string, uids: number[], target_folder: string) => Promise<CopyUidResult>;
  copyMessages: (folder: string, uids: number[], target_folder: string) => Promise<CopyUidResult>;
  setLabels: (folder: string, uids: number[], change: LabelChange) => Promise<LabelResult>;
  expungeUids: (folder: string, uids: number[]) => Promise<ExpungeResult>;
  disconnect: () => Promise<void>;
};
