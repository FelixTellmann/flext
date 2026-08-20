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
    // Non-failure detail from a run that still finished `ok` — most importantly the notes the three
    // stages added by Phase 6 (rescue detection, the new-mail shadow pass, promotion + execution) emit
    // when they catch. Those stages deliberately swallow their own failures so a broken classifier cannot
    // cost the operator their mail, which without somewhere durable to land means an unmigrated column or
    // a tripped loop-breaker fails silently on every run while the sync keeps reporting healthy. This
    // column is where the failure becomes visible in the sync-run list; `errorMessage` stays reserved for
    // a run whose status is `failed`.
    note: text("note"),
  },
  (table) => ({
    mailboxStartedIndex: index("SyncRun_mailboxId_startedAt_idx").on(table.mailbox_id, table.started_at),
  }),
);

// ─── SenderPolicy ────────────────────────────────────────────────────────────
export const senderPolicy = mysqlTable(
  "SenderPolicy",
  {
    id: varchar("id", { length: 191 }).primaryKey().default(sql`(UUID())`),
    createdAt: datetime("createdAt", { fsp: 3 }).default(sql`CURRENT_TIMESTAMP(3)`).notNull(),
    updatedAt: datetime("updatedAt", { fsp: 3 }).notNull(),
    scope: varchar("scope", { length: 191 }).notNull(),
    value: varchar("value", { length: 320 }).notNull(),
    // Never "purge": a derived/proposed policy must never be able to name the destructive
    // sweep action (design spec §5.4, §8) — purge only ever runs from the separate Phase 8 sweep (§1.7).
    action: varchar("action", { length: 191 }).notNull(),
    client: varchar("client", { length: 191 }),
    topic: varchar("topic", { length: 191 }),
    autonomy: varchar("autonomy", { length: 191 }).default("shadow").notNull(),
    // When the operator promoted this policy to autonomy "auto". §8's auto_trash gate measures "a full
    // shadow cycle" from here, so it must be the promotion moment and not createdAt — a policy that sat
    // in shadow for a year has not thereby earned anything.
    autonomy_promoted_at: datetime("autonomyPromotedAt", { fsp: 3 }),
    source: varchar("source", { length: 191 }).notNull(),
    suspended_at: datetime("suspendedAt", { fsp: 3 }),
    suspension_reason: text("suspensionReason"),
  },
  (table) => ({
    scopeValueUnique: uniqueIndex("SenderPolicy_scope_value_key").on(table.scope, table.value),
  }),
);

// ─── NeverTouchRule ──────────────────────────────────────────────────────────
export const neverTouchRule = mysqlTable("NeverTouchRule", {
  id: varchar("id", { length: 191 }).primaryKey().default(sql`(UUID())`),
  createdAt: datetime("createdAt", { fsp: 3 }).default(sql`CURRENT_TIMESTAMP(3)`).notNull(),
  updatedAt: datetime("updatedAt", { fsp: 3 }).notNull(),
  kind: varchar("kind", { length: 191 }).notNull(),
  value: varchar("value", { length: 512 }).notNull(),
  note: text("note"),
});

// ─── SenderSuppression ───────────────────────────────────────────────────────
export const senderSuppression = mysqlTable("SenderSuppression", {
  id: varchar("id", { length: 191 }).primaryKey().default(sql`(UUID())`),
  createdAt: datetime("createdAt", { fsp: 3 }).default(sql`CURRENT_TIMESTAMP(3)`).notNull(),
  updatedAt: datetime("updatedAt", { fsp: 3 }).notNull(),
  sender_address: varchar("senderAddress", { length: 320 }).notNull(),
  reason: text("reason").notNull(),
});

// ─── ThreadState ─────────────────────────────────────────────────────────────
export const threadState = mysqlTable(
  "ThreadState",
  {
    id: varchar("id", { length: 191 }).primaryKey().default(sql`(UUID())`),
    createdAt: datetime("createdAt", { fsp: 3 }).default(sql`CURRENT_TIMESTAMP(3)`).notNull(),
    updatedAt: datetime("updatedAt", { fsp: 3 }).notNull(),
    thread_key: varchar("threadKey", { length: 512 }).notNull(),
    mailbox_id: varchar("mailboxId", { length: 191 }).notNull(),
    state: varchar("state", { length: 191 }).default("open").notNull(),
    snoozed_until: datetime("snoozedUntil", { fsp: 3 }),
  },
  (table) => ({
    mailboxThreadKeyUnique: uniqueIndex("ThreadState_mailboxId_threadKey_key").on(table.mailbox_id, table.thread_key),
    stateSnoozedUntilIndex: index("ThreadState_state_snoozedUntil_idx").on(table.state, table.snoozed_until),
  }),
);

// ─── Action ──────────────────────────────────────────────────────────────────
export const action = mysqlTable(
  "Action",
  {
    id: varchar("id", { length: 191 }).primaryKey().default(sql`(UUID())`),
    createdAt: datetime("createdAt", { fsp: 3 }).default(sql`CURRENT_TIMESTAMP(3)`).notNull(),
    updatedAt: datetime("updatedAt", { fsp: 3 }).notNull(),
    message_id: varchar("messageId", { length: 191 }).notNull(),
    // Carried on every row, including shadow-only ones written by Phase 3, so that §7's bulk-undo-by-rule
    // and §10's get_shadow_report(policy_id) can be built later without a backfill.
    sender_policy_id: varchar("senderPolicyId", { length: 191 }),
    // Nullable: rows written by Phase 3's shadow runner predate this column, and a NOT NULL add would
    // fail or backfill ~29k rows with a meaningless value. Needed so undo reaches the same server it
    // mutated and §7.3's batching by (mailbox, folder, target) can be built later.
    mailbox_id: varchar("mailboxId", { length: 191 }),
    kind: varchar("kind", { length: 191 }).notNull(),
    // Decision.source (rules.ts): without it, a policy that fired, one an absolute guard overrode, one a
    // scoped guard suppressed, and a suspended policy are all indistinguishable rows sharing `kind` and
    // `senderPolicyId` — and §8 gates promoting a policy to auto on the operator reviewing exactly that
    // distinction in its shadow record.
    source: varchar("source", { length: 191 }).notNull(),
    status: varchar("status", { length: 191 }).default("shadow").notNull(),
    // Snapshot of the mutable state (folder, flags, labels) before this action, so Phase 4's undo can
    // restore it exactly rather than reconstruct it from later, possibly-incomplete sync data.
    from_state_json: text("fromStateJson"),
    to_state_json: text("toStateJson"),
    // The logical path §6 chose for a `file` action — "Clients/KidsLiving", never a server-native folder
    // name. Written by the shadow runner as the proposal and by filing-queue resolution as the operator's
    // confirmation; server/mail/filing/render.ts is the only thing that turns it into a real folder.
    // Nullable for the same reason mailboxId is: 29,375 rows predate it, and it is meaningless on the
    // archive and trash kinds.
    target_path: varchar("targetPath", { length: 191 }),
    // When a human confirmed `targetPath` from the filing queue, and null on every row that reached its
    // destination automatically. §6's DKIM gate is a proxy for "did a person vouch for this destination?",
    // so the confirmation supersedes it — without this column the gate re-reads the same policy scope and
    // DKIM state on the next run and re-queues the row the operator just resolved, forever.
    filing_confirmed_at: datetime("filingConfirmedAt", { fsp: 3 }),
    run_id: varchar("runId", { length: 191 }).notNull(),
    decided_at: datetime("decidedAt", { fsp: 3 }),
    applied_at: datetime("appliedAt", { fsp: 3 }),
    error: text("error"),
    // When a rescue was detected against this action. Makes detection idempotent — a rescue already
    // recorded must not re-suspend a policy the operator has since deliberately cleared — and lets the
    // journal show WHICH action was rescued rather than only that some policy is suspended.
    rescued_at: datetime("rescuedAt", { fsp: 3 }),
  },
  (table) => ({
    statusDecidedAtIndex: index("Action_status_decidedAt_idx").on(table.status, table.decided_at),
    senderPolicyIdIndex: index("Action_senderPolicyId_idx").on(table.sender_policy_id),
    mailboxIdStatusIndex: index("Action_mailboxId_status_idx").on(table.mailbox_id, table.status),
    // The rescue detector's candidate query: (mailboxId, status) equality then ORDER BY appliedAt with a
    // LIMIT. Without appliedAt in the index MySQL filesorts every applied row of the mailbox on every
    // sync just to return the oldest few — ~7,900 rows sorted to read 500.
    mailboxIdStatusAppliedAtIndex: index("Action_mailboxId_status_appliedAt_idx").on(table.mailbox_id, table.status, table.applied_at),
    messageIdKindRunIdUnique: uniqueIndex("Action_messageId_kind_runId_key").on(table.message_id, table.kind, table.run_id),
  }),
);

// ─── FilingBinding ───────────────────────────────────────────────────────────
// One mailbox's answer to "where does this logical path actually live?". §6 says filing paths are
// logical; this is what makes that true across servers that disagree about names. felix@tellmann.co.za
// carries thirteen hand-built folders flat under INBOX ("INBOX.KidsLiving", "INBOX.Finances - Ref") and
// the three Gmail mailboxes carry no user labels at all, so the same logical path has to reach an
// existing folder on one server and a folder created on first use on another.
//
// A logical path with no binding is not an error: render.ts derives a folder from its segments and the
// resolver creates it. A binding exists to override that, which is why `folder` is stored verbatim,
// delimiter already applied, and never re-rendered.
export const filingBinding = mysqlTable(
  "FilingBinding",
  {
    id: varchar("id", { length: 191 }).primaryKey().default(sql`(UUID())`),
    createdAt: datetime("createdAt", { fsp: 3 }).default(sql`CURRENT_TIMESTAMP(3)`).notNull(),
    updatedAt: datetime("updatedAt", { fsp: 3 }).notNull(),
    mailbox_id: varchar("mailboxId", { length: 191 }).notNull(),
    // 191 to match the `client` and `topic` columns a path is derived from.
    logical_path: varchar("logicalPath", { length: 191 }).notNull(),
    // 191 because Message.folder is 191: a bound folder is one a message will actually be stored under,
    // so a binding this column could hold and that one could not would fail at the next sync rather than
    // here. A server-native path, delimiter already applied.
    folder: varchar("folder", { length: 191 }).notNull(),
  },
  (table) => ({
    mailboxLogicalPathUnique: uniqueIndex("FilingBinding_mailboxId_logicalPath_key").on(table.mailbox_id, table.logical_path),
  }),
);
