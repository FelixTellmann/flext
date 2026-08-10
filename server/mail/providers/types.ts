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

export type MailboxProvider = {
  capabilities: MailboxCapabilities;
  listFolders: () => Promise<FolderInfo[]>;
  openFolder: (folder: string) => Promise<FolderStatus>;
  fetchHeaders: (folder: string, uid_range: string) => Promise<FetchedMessage[]>;
  fetchIdentities: (folder: string) => Promise<MessageIdentity[]>;
  fetchFlagChanges: (folder: string, since_modseq: string) => Promise<FlagChangeResult>;
  listUids: (folder: string) => Promise<number[]>;
  disconnect: () => Promise<void>;
};
