import { sql } from "drizzle-orm";
import { boolean, datetime, float, index, int, mysqlTable, primaryKey, text, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

// ─── Account ─────────────────────────────────────────────────────────────────
// Prisma @map directives rename DB columns: e.g. refresh_token → "refreshToken" in DB
export const account = mysqlTable(
  "Account",
  {
    id: varchar("id", { length: 191 }).primaryKey().default(sql`(UUID())`),
    userId: varchar("userId", { length: 191 }).notNull(),
    type: varchar("type", { length: 191 }).notNull(),
    provider: varchar("provider", { length: 191 }).notNull(),
    providerAccountId: varchar("providerAccountId", { length: 191 }).notNull(),
    refresh_token: text("refreshToken"),
    refresh_token_expires_in: int("refreshTokenExpiresIn"),
    access_token: text("accessToken"),
    expires_at: int("expiresAt"),
    token_type: varchar("tokenType", { length: 191 }),
    scope: varchar("scope", { length: 191 }),
    id_token: text("idToken"),
    session_state: varchar("sessionState", { length: 191 }),
    oauth_token_secret: varchar("oauthTokenSecret", { length: 191 }),
    oauth_token: varchar("oauthToken", { length: 191 }),
  },
  (table) => ({
    providerProviderAccountIdUnique: uniqueIndex("Account_provider_providerAccountId_key").on(table.provider, table.providerAccountId),
  }),
);

// ─── Session ─────────────────────────────────────────────────────────────────
export const session = mysqlTable(
  "Session",
  {
    id: varchar("id", { length: 191 }).primaryKey().default(sql`(UUID())`),
    sessionToken: varchar("sessionToken", { length: 191 }).notNull(),
    userId: varchar("userId", { length: 191 }).notNull(),
    expires: datetime("expires", { fsp: 3 }).notNull(),
  },
  (table) => ({
    sessionTokenUnique: uniqueIndex("Session_sessionToken_key").on(table.sessionToken),
  }),
);

// ─── User ────────────────────────────────────────────────────────────────────
export const user = mysqlTable(
  "User",
  {
    id: varchar("id", { length: 191 }).primaryKey().default(sql`(UUID())`),
    name: varchar("name", { length: 191 }),
    email: varchar("email", { length: 191 }),
    emailVerified: datetime("emailVerified", { fsp: 3 }),
    password: varchar("password", { length: 191 }),
    image: varchar("image", { length: 191 }),
    registeredAt: datetime("registeredAt", { fsp: 3 }).default(sql`CURRENT_TIMESTAMP(3)`),
    acceptMarketing: boolean("acceptMarketing").default(true),
  },
  (table) => ({
    emailUnique: uniqueIndex("User_email_key").on(table.email),
  }),
);

// ─── VerificationToken ───────────────────────────────────────────────────────
export const verificationToken = mysqlTable(
  "VerificationToken",
  {
    identifier: varchar("identifier", { length: 191 }).notNull(),
    token: varchar("token", { length: 191 }).notNull(),
    expires: datetime("expires", { fsp: 3 }).notNull(),
  },
  (table) => ({
    tokenUnique: uniqueIndex("VerificationToken_token_key").on(table.token),
    identifierTokenUnique: uniqueIndex("VerificationToken_identifier_token_key").on(table.identifier, table.token),
  }),
);

// ─── Books ───────────────────────────────────────────────────────────────────
export const books = mysqlTable("Books", {
  id: varchar("id", { length: 191 }).primaryKey().default(sql`(UUID())`),
  createdAt: datetime("createdAt", { fsp: 3 }).default(sql`CURRENT_TIMESTAMP(3)`).notNull(),
  updatedAt: datetime("updatedAt", { fsp: 3 }).notNull(),
  read: boolean("read").default(false).notNull(),
  published: boolean("published").default(false).notNull(),
  name: varchar("name", { length: 191 }).notNull(),
  asin: varchar("asin", { length: 191 }),
  isbn10: varchar("isbn10", { length: 191 }),
  author: varchar("author", { length: 191 }),
  author_url: varchar("author_url", { length: 191 }),
  image: varchar("image", { length: 191 }),
  url: varchar("url", { length: 191 }),
  rating: float("rating").default(0).notNull(),
  votes: int("votes").default(0).notNull(),
});

// ─── Mailbox ─────────────────────────────────────────────────────────────────
export const mailbox = mysqlTable(
  "Mailbox",
  {
    id: varchar("id", { length: 191 }).primaryKey().default(sql`(UUID())`),
    createdAt: datetime("createdAt", { fsp: 3 }).default(sql`CURRENT_TIMESTAMP(3)`).notNull(),
    updatedAt: datetime("updatedAt", { fsp: 3 }).notNull(),
    label: varchar("label", { length: 191 }).notNull(),
    host: varchar("host", { length: 191 }).notNull(),
    port: int("port").default(993).notNull(),
    username: varchar("username", { length: 191 }).notNull(),
    flavor: varchar("flavor", { length: 191 }).default("generic").notNull(),
    account_index: int("accountIndex"),
    credential_ciphertext: text("credentialCiphertext").notNull(),
    credential_iv: varchar("credentialIv", { length: 191 }).notNull(),
    credential_auth_tag: varchar("credentialAuthTag", { length: 191 }).notNull(),
    credential_key_version: int("credentialKeyVersion").default(1).notNull(),
    tls_policy: varchar("tlsPolicy", { length: 191 }).default("strict").notNull(),
    pinned_spki: text("pinnedSpki"),
    identity_addresses: text("identityAddresses"),
    hierarchy_delimiter: varchar("hierarchyDelimiter", { length: 191 }),
    canonical_folder: varchar("canonicalFolder", { length: 191 }),
    sent_folders: text("sentFolders"),
    trash_retention_days: int("trashRetentionDays"),
    enabled: boolean("enabled").default(true).notNull(),
    backfilled_at: datetime("backfilledAt", { fsp: 3 }),
    last_error: text("lastError"),
    last_error_at: datetime("lastErrorAt", { fsp: 3 }),
  },
  (table) => ({
    hostUsernameUnique: uniqueIndex("Mailbox_host_username_key").on(table.host, table.username),
  }),
);

// ─── MailboxCursor ───────────────────────────────────────────────────────────
export const mailboxCursor = mysqlTable(
  "MailboxCursor",
  {
    id: varchar("id", { length: 191 }).primaryKey().default(sql`(UUID())`),
    createdAt: datetime("createdAt", { fsp: 3 }).default(sql`CURRENT_TIMESTAMP(3)`).notNull(),
    updatedAt: datetime("updatedAt", { fsp: 3 }).notNull(),
    mailbox_id: varchar("mailboxId", { length: 191 }).notNull(),
    folder: varchar("folder", { length: 191 }).notNull(),
    kind: varchar("kind", { length: 191 }).default("messages").notNull(),
    uid_validity: varchar("uidValidity", { length: 191 }).notNull(),
    last_seen_uid: int("lastSeenUid").default(0).notNull(),
    highest_modseq: varchar("highestModseq", { length: 191 }),
    last_sync_at: datetime("lastSyncAt", { fsp: 3 }),
    last_reconcile_at: datetime("lastReconcileAt", { fsp: 3 }),
  },
  (table) => ({
    mailboxFolderKindUnique: uniqueIndex("MailboxCursor_mailboxId_folder_kind_key").on(table.mailbox_id, table.folder, table.kind),
  }),
);

// ─── Message ─────────────────────────────────────────────────────────────────
export const message = mysqlTable(
  "Message",
  {
    id: varchar("id", { length: 191 }).primaryKey().default(sql`(UUID())`),
    createdAt: datetime("createdAt", { fsp: 3 }).default(sql`CURRENT_TIMESTAMP(3)`).notNull(),
    updatedAt: datetime("updatedAt", { fsp: 3 }).notNull(),
    mailbox_id: varchar("mailboxId", { length: 191 }).notNull(),
    folder: varchar("folder", { length: 191 }).notNull(),
    uid: int("uid").notNull(),
    uid_validity: varchar("uidValidity", { length: 191 }).notNull(),
    gm_msgid: varchar("gmMsgid", { length: 191 }),
    gm_thrid: varchar("gmThrid", { length: 191 }),
    message_id: varchar("messageId", { length: 512 }),
    thread_key: varchar("threadKey", { length: 512 }),
    sender_id: varchar("senderId", { length: 191 }),
    from_address: varchar("fromAddress", { length: 320 }),
    from_domain: varchar("fromDomain", { length: 253 }),
    from_name: varchar("fromName", { length: 320 }),
    to_me: boolean("toMe").default(false).notNull(),
    cc_me: boolean("ccMe").default(false).notNull(),
    subject: text("subject"),
    sent_at: datetime("sentAt", { fsp: 3 }),
    internal_date: datetime("internalDate", { fsp: 3 }).notNull(),
    size: int("size"),
    has_attachment: boolean("hasAttachment").default(false).notNull(),
    list_id: varchar("listId", { length: 320 }),
    list_unsubscribe: text("listUnsubscribe"),
    precedence: varchar("precedence", { length: 191 }),
    auto_submitted: varchar("autoSubmitted", { length: 191 }),
    dkim_aligned: boolean("dkimAligned"),
    is_seen: boolean("isSeen").default(false).notNull(),
    is_flagged: boolean("isFlagged").default(false).notNull(),
    labels: text("labels"),
    opened_at: datetime("openedAt", { fsp: 3 }),
    disappeared_at: datetime("disappearedAt", { fsp: 3 }),
  },
  (table) => ({
    // The UIDVALIDITY generation is part of the key so a re-key (§11) can write the new (uid, uidValidity)
    // pair without colliding with the row it is replacing.
    mailboxFolderUidUnique: uniqueIndex("Message_mailboxId_folder_uidValidity_uid_key").on(
      table.mailbox_id,
      table.folder,
      table.uid_validity,
      table.uid,
    ),
    mailboxGmMsgidUnique: uniqueIndex("Message_mailboxId_gmMsgid_key").on(table.mailbox_id, table.gm_msgid),
    mailboxMessageIdIndex: index("Message_mailboxId_messageId_idx").on(table.mailbox_id, table.message_id),
    senderIndex: index("Message_senderId_idx").on(table.sender_id),
    fromAddressIndex: index("Message_fromAddress_idx").on(table.from_address),
    internalDateIndex: index("Message_internalDate_idx").on(table.internal_date),
  }),
);

// ─── Sender ──────────────────────────────────────────────────────────────────
export const sender = mysqlTable(
  "Sender",
  {
    id: varchar("id", { length: 191 }).primaryKey().default(sql`(UUID())`),
    createdAt: datetime("createdAt", { fsp: 3 }).default(sql`CURRENT_TIMESTAMP(3)`).notNull(),
    updatedAt: datetime("updatedAt", { fsp: 3 }).notNull(),
    address: varchar("address", { length: 320 }).notNull(),
    domain: varchar("domain", { length: 253 }).notNull(),
    display_name: varchar("displayName", { length: 320 }),
    message_count: int("messageCount").default(0).notNull(),
    my_reply_count: int("myReplyCount").default(0).notNull(),
    first_seen_at: datetime("firstSeenAt", { fsp: 3 }),
    last_seen_at: datetime("lastSeenAt", { fsp: 3 }),
  },
  (table) => ({
    addressUnique: uniqueIndex("Sender_address_key").on(table.address),
    domainIndex: index("Sender_domain_idx").on(table.domain),
  }),
);

// ─── MailboxObservedAddress ──────────────────────────────────────────────────
export const mailboxObservedAddress = mysqlTable(
  "MailboxObservedAddress",
  {
    id: varchar("id", { length: 191 }).primaryKey().default(sql`(UUID())`),
    createdAt: datetime("createdAt", { fsp: 3 }).default(sql`CURRENT_TIMESTAMP(3)`).notNull(),
    updatedAt: datetime("updatedAt", { fsp: 3 }).notNull(),
    mailbox_id: varchar("mailboxId", { length: 191 }).notNull(),
    address: varchar("address", { length: 320 }).notNull(),
    source_header: varchar("sourceHeader", { length: 191 }).notNull(),
    occurrences: int("occurrences").default(0).notNull(),
    first_seen_at: datetime("firstSeenAt", { fsp: 3 }),
    last_seen_at: datetime("lastSeenAt", { fsp: 3 }),
  },
  (table) => ({
    mailboxAddressSourceUnique: uniqueIndex("MailboxObservedAddress_mailboxId_address_sourceHeader_key").on(
      table.mailbox_id,
      table.address,
      table.source_header,
    ),
  }),
);

// ─── SyncRun ─────────────────────────────────────────────────────────────────
export const syncRun = mysqlTable(
  "SyncRun",
  {
    id: varchar("id", { length: 191 }).primaryKey().default(sql`(UUID())`),
    createdAt: datetime("createdAt", { fsp: 3 }).default(sql`CURRENT_TIMESTAMP(3)`).notNull(),
    updatedAt: datetime("updatedAt", { fsp: 3 }).notNull(),
    mailbox_id: varchar("mailboxId", { length: 191 }).notNull(),
    kind: varchar("kind", { length: 191 }).notNull(),
    status: varchar("status", { length: 191 }).default("running").notNull(),
    started_at: datetime("startedAt", { fsp: 3 }).notNull(),
    finished_at: datetime("finishedAt", { fsp: 3 }),
    folders_synced: int("foldersSynced").default(0).notNull(),
    messages_new: int("messagesNew").default(0).notNull(),
    messages_updated: int("messagesUpdated").default(0).notNull(),
    messages_vanished: int("messagesVanished").default(0).notNull(),
    error_message: text("errorMessage"),
  },
  (table) => ({
    mailboxStartedIndex: index("SyncRun_mailboxId_startedAt_idx").on(table.mailbox_id, table.started_at),
  }),
);
