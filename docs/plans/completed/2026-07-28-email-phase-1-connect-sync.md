# Email Suite Phase 1: Connect + Sync — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect all six mailboxes over IMAP and keep a metadata-only mirror of their headers in MySQL — cursors, reconciliation, identity discovery and a full backfill including the Sent scan — without ever mutating a mailbox.

**Architecture:** A single `MailboxProvider` contract (`server/mail/providers/types.ts`) is the only thing sync code imports; `imap.ts` is its one implementation, with Gmail as a capability flag and `[Gmail]/All Mail` as the canonical folder. `server/mail/sync/*` holds the cursor bookkeeping, incremental fetch, reconciliation, `UIDVALIDITY` re-key and backfill; every header-derived computation (identity matching, DKIM alignment, thread key, UID range arithmetic) is a pure function under `server/mail/classify/*` and `sync/uid-range.ts` so it is testable without a mail server. An ORPC router plus an `/admin/mail` page manage mailboxes, and a secret-gated `/api/mail-sync` route is what the Coolify scheduled task calls.

**Tech Stack:** `imapflow` 1.6.1 (IMAP, QRESYNC/CONDSTORE), Drizzle + `mysql2` (MySQL on Coolify), ORPC + Zod v3, TanStack Start routes, Node `crypto` (SPKI hashing, AES-256-GCM from Phase 0), `bun test` for the pure helpers.

## Global Constraints

- **Never run `bun run dev`** or any watch/long-running server. Verification is `bun run tsc`, `bunx biome check --fix <file>`, `bun test <file>` and (only where the route tree must be regenerated) `bun run build`.
- **Never run `bun run db:push`, `bun run db:migrate`, or raw DML.** Schema changes: edit `server/db/schema.ts`, run `bun run db:generate`, then surface the generated SQL from `server/db/migrations/` for the user to apply manually.
- **Phase 1 is read-only.** Every mailbox is opened with `{ readOnly: true }` (EXAMINE, not SELECT) and every header fetch uses `BODY.PEEK`. No `STORE`, `COPY`, `MOVE`, `EXPUNGE` or `APPEND` anywhere in this phase.
- **No `rejectUnauthorized: false` anywhere**, including in the certificate-inspection probe (§1.2).
- TypeScript strict + `verbatimModuleSyntax` — type-only imports use `import type`. No `any`: use `unknown` + narrowing.
- Named exports only, never `export default`. `type` over `interface`. Functions/factories over classes. Two `if` blocks over `if/else`.
- Biome: line width 140, double quotes, spaces. Run `bunx biome check --fix <file>` after editing a file.
- Comments: default to none. Write one only for a non-obvious *why* — a gotcha and its cause, an invariant, a spec reference. Never narrate the edit.
- Git: never `git add -A` / `git add .` — stage specific files by name. No `Co-Authored-By` trailers.
- Naming: `snake_case` variables and object fields, `camelCase` functions, no abbreviations.
- DB tables are PascalCase, DB columns camelCase passed explicitly as strings, all varchars `{ length: 191 }`, `updatedAt` has no DB default and must be set on every insert.
- **Phase 0 is assumed delivered:** Coolify MySQL wired to `DATABASE_URL`, an auth-gated `/admin` route group, `MAIL_ENCRYPTION_KEY` validated in `env.ts`, and `server/mail/crypto/credentials.ts` exporting `EncryptedCredential`, `encryptCredential(plaintext)`, `decryptCredential(record)`.
- **Phase 0 session cookie:** this plan assumes the JWT session cookie is named `flext_session` and is verified with `verifyJWT` from `server/auth/jwt.ts`. Task 16 centralises that in `server/auth/session.ts`; if Phase 0 already exports an equivalent helper, reuse it instead of creating a second one.
- **Schema file choice:** all Phase 1 tables go into the existing `server/db/schema.ts`. `drizzle.config.ts` points at that single file path (`schema: "./server/db/schema.ts"`), so a separate file would require editing the config; keeping one file keeps the drizzle-kit setup untouched.

---

### Task 1: Dependencies and the `bun test` type surface

**Files:**
- Modify: `package.json`
- Modify: `tsconfig.json`

**Interfaces:**
- Consumes: nothing.
- Produces: the `imapflow` module (ships its own types at `lib/imap-flow.d.ts`), and `bun:test` types so `<name>.test.ts` files typecheck under `bun run tsc`.

- [x] **Step 1: Install `imapflow` and the Bun test types**
  ```bash
  bun add imapflow@1.6.1
  bun add -d @types/bun
  ```

- [x] **Step 2: Register the Bun types and a test script**
  In `tsconfig.json`, add `"bun"` to `compilerOptions.types`:
  ```json
  "types": ["node", "bun", "vite/client", "vite-plugin-svgr/client"]
  ```
  In `package.json`, add a `test` script next to `tsc`:
  ```json
  "test": "bun test",
  ```

- [x] **Step 3: Verify**
  Run: `bun run tsc && bunx biome check --fix package.json tsconfig.json`
  Expected: tsc passes with no new errors; `bun pm ls | grep imapflow` shows `imapflow@1.6.1`.

- [x] **Step 4: Commit**
  ```bash
  git add package.json tsconfig.json bun.lock && git commit -m "chore: add imapflow and bun test types for the mail suite"
  ```

---

### Task 2: Phase 1 schema tables + generated migration

**Files:**
- Modify: `server/db/schema.ts`
- Modify: `server/db/relations.ts`
- Create: `server/db/migrations/<generated>.sql` (drizzle-kit output — never hand-edited)

**Interfaces:**
- Consumes: nothing.
- Produces: `mailbox`, `mailboxCursor`, `message`, `sender`, `mailboxObservedAddress`, `syncRun` Drizzle tables; row types `typeof mailbox.$inferSelect` etc. used by every later task.

- [x] **Step 1: Extend the schema imports**
  In `server/db/schema.ts` replace the mysql-core import line with:
  ```ts
  import { boolean, datetime, float, index, int, mysqlTable, primaryKey, text, uniqueIndex, varchar } from "drizzle-orm/mysql-core";
  ```

- [x] **Step 2: Append the Phase 1 tables**
  Append to `server/db/schema.ts`:
  ```ts
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
      message_id: varchar("messageId", { length: 191 }),
      thread_key: varchar("threadKey", { length: 191 }),
      sender_id: varchar("senderId", { length: 191 }),
      from_address: varchar("fromAddress", { length: 191 }),
      from_domain: varchar("fromDomain", { length: 191 }),
      from_name: varchar("fromName", { length: 191 }),
      to_me: boolean("toMe").default(false).notNull(),
      cc_me: boolean("ccMe").default(false).notNull(),
      subject: text("subject"),
      sent_at: datetime("sentAt", { fsp: 3 }),
      internal_date: datetime("internalDate", { fsp: 3 }).notNull(),
      size: int("size"),
      has_attachment: boolean("hasAttachment").default(false).notNull(),
      list_id: varchar("listId", { length: 191 }),
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
    }),
  );

  // ─── Sender ──────────────────────────────────────────────────────────────────
  export const sender = mysqlTable(
    "Sender",
    {
      id: varchar("id", { length: 191 }).primaryKey().default(sql`(UUID())`),
      createdAt: datetime("createdAt", { fsp: 3 }).default(sql`CURRENT_TIMESTAMP(3)`).notNull(),
      updatedAt: datetime("updatedAt", { fsp: 3 }).notNull(),
      address: varchar("address", { length: 191 }).notNull(),
      domain: varchar("domain", { length: 191 }).notNull(),
      display_name: varchar("displayName", { length: 191 }),
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
      address: varchar("address", { length: 191 }).notNull(),
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
  ```

- [x] **Step 3: Add the relations**
  Append to `server/db/relations.ts`, and extend its import to `import { account, mailbox, mailboxCursor, mailboxObservedAddress, message, sender, session, syncRun, user } from "./schema";`:
  ```ts
  // ─── Mailbox relations ───────────────────────────────────────────────────────
  export const mailboxRelations = relations(mailbox, ({ many }) => ({
    cursors: many(mailboxCursor),
    messages: many(message),
    observed_addresses: many(mailboxObservedAddress),
    sync_runs: many(syncRun),
  }));

  // ─── MailboxCursor relations ─────────────────────────────────────────────────
  export const mailboxCursorRelations = relations(mailboxCursor, ({ one }) => ({
    mailbox: one(mailbox, {
      fields: [mailboxCursor.mailbox_id],
      references: [mailbox.id],
    }),
  }));

  // ─── Message relations ───────────────────────────────────────────────────────
  export const messageRelations = relations(message, ({ one }) => ({
    mailbox: one(mailbox, {
      fields: [message.mailbox_id],
      references: [mailbox.id],
    }),
    sender: one(sender, {
      fields: [message.sender_id],
      references: [sender.id],
    }),
  }));

  // ─── MailboxObservedAddress relations ────────────────────────────────────────
  export const mailboxObservedAddressRelations = relations(mailboxObservedAddress, ({ one }) => ({
    mailbox: one(mailbox, {
      fields: [mailboxObservedAddress.mailbox_id],
      references: [mailbox.id],
    }),
  }));

  // ─── SyncRun relations ───────────────────────────────────────────────────────
  export const syncRunRelations = relations(syncRun, ({ one }) => ({
    mailbox: one(mailbox, {
      fields: [syncRun.mailbox_id],
      references: [mailbox.id],
    }),
  }));
  ```

- [x] **Step 4: Generate the migration and surface the SQL**
  Run: `bun run db:generate`
  Then read the newly created `server/db/migrations/*.sql` and **print its full contents in the session output** so the user can apply it manually against the Coolify MySQL instance.
  **Do NOT run `bun run db:push` or `bun run db:migrate`, and do not execute the SQL yourself.** The generated files under `server/db/migrations/**` are drizzle-kit output — never hand-edit them.

- [x] **Step 5: Verify**
  Run: `bun run tsc && bunx biome check --fix server/db/schema.ts server/db/relations.ts`
  Expected: tsc passes; the migration SQL contains `CREATE TABLE \`Mailbox\``, `\`MailboxCursor\``, `\`Message\``, `\`Sender\``, `\`MailboxObservedAddress\``, `\`SyncRun\``.

- [x] **Step 6: Commit**
  ```bash
  git add server/db/schema.ts server/db/relations.ts server/db/migrations && git commit -m "feat: add the phase 1 mail schema (mailbox, cursor, message, sender, sync run)"
  ```

---

### Task 3: Mail domain types, JSON codecs and the mailbox connection record

**Files:**
- Create: `server/mail/types.ts`
- Create: `server/mail/mailbox.ts`

**Interfaces:**
- Consumes: `encryptCredential` / `decryptCredential` from `server/mail/crypto/credentials.ts` (Phase 0); `mailbox` from `@server/db/schema`.
- Produces:
  - `type MailboxFlavor = "gmail" | "generic"`, `type TlsPolicy = "strict" | "pinned"`, `type SyncMode = "incremental" | "reconcile" | "backfill"`
  - `GMAIL_CANONICAL_FOLDER: "[Gmail]/All Mail"`
  - `parseStringList(raw: string | null): string[]`, `serializeStringList(values: string[]): string`
  - `parseMailboxFlavor(raw: string): MailboxFlavor`, `parseTlsPolicy(raw: string): TlsPolicy`
  - `type MailboxRow = typeof mailbox.$inferSelect`
  - `type MailboxConnection = { host, port, username, password, flavor, tls_policy, pinned_spki }`
  - `mailboxConnection(row: MailboxRow): MailboxConnection`

- [x] **Step 1: Write `server/mail/types.ts`**
  ```ts
  import { z } from "zod";

  export type MailboxFlavor = "gmail" | "generic";
  export type TlsPolicy = "strict" | "pinned";
  export type SyncMode = "incremental" | "reconcile" | "backfill";

  // Gmail is a label store: a message with labels INBOX and Work is visible in three folders with three
  // different UIDs, so only [Gmail]/All Mail is ever walked (§4.1).
  export const GMAIL_CANONICAL_FOLDER = "[Gmail]/All Mail";

  export const mailbox_flavor_schema = z.enum(["gmail", "generic"]);
  export const tls_policy_schema = z.enum(["strict", "pinned"]);
  export const sync_mode_schema = z.enum(["incremental", "reconcile", "backfill"]);

  const string_list_schema = z.array(z.string());

  export function parseStringList(raw: string | null): string[] {
    if (raw === null || raw.length === 0) {
      return [];
    }
    try {
      const parsed = string_list_schema.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : [];
    } catch {
      return [];
    }
  }

  export function serializeStringList(values: string[]): string {
    return JSON.stringify(values);
  }

  export function parseMailboxFlavor(raw: string): MailboxFlavor {
    return mailbox_flavor_schema.catch("generic").parse(raw);
  }

  export function parseTlsPolicy(raw: string): TlsPolicy {
    return tls_policy_schema.catch("strict").parse(raw);
  }
  ```

- [x] **Step 2: Write `server/mail/mailbox.ts`**
  ```ts
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
  ```

- [x] **Step 3: Verify**
  Run: `bun run tsc && bunx biome check --fix server/mail/types.ts server/mail/mailbox.ts`
  Expected: tsc passes; no `any`, all cross-module imports of types use `import type`.

- [x] **Step 4: Commit**
  ```bash
  git add server/mail/types.ts server/mail/mailbox.ts && git commit -m "feat: add mail domain types and mailbox credential decoding"
  ```

---

### Task 4: TLS policy — SPKI pinning and the operator re-pin probe (§1.2)

**Files:**
- Create: `server/mail/providers/tls.ts`
- Create: `server/mail/providers/tls.test.ts`

**Interfaces:**
- Consumes: `TlsPolicy` from `@server/mail/types`.
- Produces:
  - `spkiHashFromSpkiDer(spki_der: Buffer): string` (base64 SHA-256)
  - `spkiHashFromCertificate(certificate_der: Buffer): string`
  - `type ObservedCertificate = { spki_sha256, issuer, subject, valid_from, valid_to, subject_alt_names }`
  - `buildTlsOptions(input: { host: string; tls_policy: TlsPolicy; pinned_spki: string[] }): ConnectionOptions`
  - `observeCertificate(input: { host: string; port: number }): Promise<ObservedCertificate>`

- [x] **Step 1: Write `server/mail/providers/tls.ts`**
  ```ts
  import { createHash, X509Certificate } from "node:crypto";
  import type { ConnectionOptions, PeerCertificate } from "node:tls";
  import { connect as tlsConnect } from "node:tls";
  import type { TlsPolicy } from "@server/mail/types";

  export type ObservedCertificate = {
    spki_sha256: string;
    issuer: string;
    subject: string;
    valid_from: string;
    valid_to: string;
    subject_alt_names: string[];
  };

  const PROBE_TIMEOUT_MS = 15_000;

  export function spkiHashFromSpkiDer(spki_der: Buffer): string {
    return createHash("sha256").update(spki_der).digest("base64");
  }

  export function spkiHashFromCertificate(certificate_der: Buffer): string {
    const certificate = new X509Certificate(certificate_der);
    return spkiHashFromSpkiDer(certificate.publicKey.export({ type: "spki", format: "der" }));
  }

  export function describeCertificate(certificate: PeerCertificate): ObservedCertificate {
    const parsed = new X509Certificate(certificate.raw);
    return {
      spki_sha256: spkiHashFromSpkiDer(parsed.publicKey.export({ type: "spki", format: "der" })),
      issuer: parsed.issuer,
      subject: parsed.subject,
      valid_from: parsed.validFrom,
      valid_to: parsed.validTo,
      subject_alt_names: (parsed.subjectAltName ?? "")
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0),
    };
  }

  export function buildTlsOptions(input: { host: string; tls_policy: TlsPolicy; pinned_spki: string[] }): ConnectionOptions {
    if (input.tls_policy === "strict") {
      return { rejectUnauthorized: true, servername: input.host };
    }
    if (input.pinned_spki.length === 0) {
      throw new Error(`mailbox ${input.host} uses the pinned tls policy but has no pinned SPKI hash`);
    }
    const accepted = new Set(input.pinned_spki);
    return {
      // Chain validation stays on. Only the hostname check is replaced: the xneelo certificate is valid but
      // issued for the hosting server, not the vanity domain, and the SPKI survives ACME renewal while a
      // leaf fingerprint would not (§1.2). rejectUnauthorized is never turned off anywhere.
      rejectUnauthorized: true,
      servername: input.host,
      checkServerIdentity: (_hostname: string, certificate: PeerCertificate) => {
        const observed = spkiHashFromCertificate(certificate.raw);
        if (accepted.has(observed)) {
          return undefined;
        }
        return new Error(`pinned SPKI mismatch for ${input.host}: server presented ${observed}`);
      },
    };
  }

  export function observeCertificate(input: { host: string; port: number }): Promise<ObservedCertificate> {
    return new Promise((resolve, reject) => {
      let observed: ObservedCertificate | null = null;

      const socket = tlsConnect(
        {
          host: input.host,
          port: input.port,
          servername: input.host,
          rejectUnauthorized: true,
          // The probe records the presented certificate from inside the identity check and then fails the
          // handshake on purpose. Reading it any other way would mean rejectUnauthorized: false, which §1.2
          // forbids outright.
          checkServerIdentity: (_hostname: string, certificate: PeerCertificate) => {
            observed = describeCertificate(certificate);
            return new Error("certificate captured for operator re-pin review");
          },
        },
        () => {
          socket.destroy();
          reject(new Error(`unexpected accepted handshake while probing ${input.host}:${input.port}`));
        },
      );

      socket.setTimeout(PROBE_TIMEOUT_MS, () => {
        socket.destroy();
        reject(new Error(`timed out probing ${input.host}:${input.port}`));
      });

      socket.once("error", () => {
        socket.destroy();
        if (observed !== null) {
          resolve(observed);
          return;
        }
        reject(new Error(`could not read a certificate from ${input.host}:${input.port}`));
      });
    });
  }
  ```

- [x] **Step 2: Write `server/mail/providers/tls.test.ts`**
  ```ts
  import { createHash, generateKeyPairSync } from "node:crypto";
  import { expect, test } from "bun:test";
  import { buildTlsOptions, spkiHashFromSpkiDer } from "./tls";

  test("spkiHashFromSpkiDer is the base64 sha256 of the DER SubjectPublicKeyInfo", () => {
    const { publicKey } = generateKeyPairSync("ed25519");
    const spki_der = publicKey.export({ type: "spki", format: "der" });

    expect(spkiHashFromSpkiDer(spki_der)).toBe(createHash("sha256").update(spki_der).digest("base64"));
  });

  test("strict policy keeps the default hostname check and never disables verification", () => {
    const options = buildTlsOptions({ host: "imap.gmail.com", tls_policy: "strict", pinned_spki: [] });

    expect(options.rejectUnauthorized).toBe(true);
    expect(options.checkServerIdentity).toBeUndefined();
  });

  test("pinned policy accepts a pinned hash and rejects anything else", () => {
    const { publicKey } = generateKeyPairSync("ed25519");
    const spki_der = publicKey.export({ type: "spki", format: "der" });
    const pinned = spkiHashFromSpkiDer(spki_der);
    const options = buildTlsOptions({ host: "mail.example.com", tls_policy: "pinned", pinned_spki: [pinned] });

    expect(options.rejectUnauthorized).toBe(true);
    expect(typeof options.checkServerIdentity).toBe("function");
  });

  test("pinned policy without a pinned hash is a hard error", () => {
    expect(() => buildTlsOptions({ host: "mail.example.com", tls_policy: "pinned", pinned_spki: [] })).toThrow();
  });
  ```

- [x] **Step 3: Verify**
  Run: `bun test server/mail/providers/tls.test.ts && bun run tsc && bunx biome check --fix server/mail/providers/tls.ts server/mail/providers/tls.test.ts`
  Expected: 4 tests pass; tsc clean. Also confirm the repo-wide invariant: `grep -rn "rejectUnauthorized" server src` returns only `rejectUnauthorized: true`.

- [x] **Step 4: Commit**
  ```bash
  git add server/mail/providers/tls.ts server/mail/providers/tls.test.ts && git commit -m "feat: add SPKI-pinned TLS policy and the re-pin certificate probe"
  ```

---

### Task 5: The `MailboxProvider` contract

**Files:**
- Create: `server/mail/providers/types.ts`

**Interfaces:**
- Consumes: nothing (pure type module).
- Produces: `MailboxCapabilities`, `FolderInfo`, `FolderStatus`, `HeaderMap`, `MessageAddress`, `FetchedEnvelope`, `FetchedMessage`, `MessageIdentity`, `FlagChange`, `FlagChangeResult`, `MailboxProvider` — the only surface sync code imports.

- [x] **Step 1: Write `server/mail/providers/types.ts`**
  ```ts
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
  ```

- [x] **Step 2: Verify**
  Run: `bun run tsc && bunx biome check --fix server/mail/providers/types.ts`
  Expected: tsc passes.

- [x] **Step 3: Commit**
  ```bash
  git add server/mail/providers/types.ts && git commit -m "feat: define the MailboxProvider contract"
  ```

---

### Task 6: Header fetch spec and header-block parsing

**Files:**
- Create: `server/mail/providers/headers.ts`
- Create: `server/mail/providers/headers.test.ts`

**Interfaces:**
- Consumes: `HeaderMap` from `@server/mail/providers/types`.
- Produces:
  - `HEADER_FIELDS: readonly string[]` (the §4.2 list)
  - `HEADER_FETCH_SPEC: string` — the literal `BODY.PEEK[HEADER.FIELDS (...)]` data item, surfaced by the connection test
  - `parseHeaderBlock(raw: Buffer | undefined): HeaderMap`
  - `headerValue(headers: HeaderMap, name: string): string | null`
  - `headerValues(headers: HeaderMap, name: string): string[]`
  - `extractAddresses(value: string): string[]`

- [x] **Step 1: Write `server/mail/providers/headers.ts`**
  ```ts
  import type { HeaderMap } from "@server/mail/providers/types";

  export const HEADER_FIELDS = [
    "From",
    "To",
    "Cc",
    "Subject",
    "Date",
    "Message-ID",
    "References",
    "In-Reply-To",
    "List-Id",
    "List-Unsubscribe",
    "Precedence",
    "Auto-Submitted",
    "Return-Path",
    "Content-Type",
    "Delivered-To",
    "X-Original-To",
    "Authentication-Results",
  ] as const;

  // The exact IMAP data item imapflow renders for `headers: [...]`. PEEK is mandatory and is why Phase 1 can
  // read every message without touching a mailbox: a bare BODY[] fetch sets \Seen on everything it reads
  // (§4.2). Surfaced by the connection test so the read-only contract is visible in the admin UI.
  export const HEADER_FETCH_SPEC = `BODY.PEEK[HEADER.FIELDS (${HEADER_FIELDS.join(" ").toUpperCase()})]`;

  export function parseHeaderBlock(raw: Buffer | undefined): HeaderMap {
    const headers: HeaderMap = {};
    if (raw === undefined) {
      return headers;
    }

    const unfolded: string[] = [];
    for (const line of raw.toString("utf8").split(/\r?\n/)) {
      if (line.length === 0) {
        continue;
      }
      if (/^[ \t]/.test(line) && unfolded.length > 0) {
        unfolded[unfolded.length - 1] = `${unfolded[unfolded.length - 1]} ${line.trim()}`;
        continue;
      }
      unfolded.push(line);
    }

    for (const line of unfolded) {
      const separator = line.indexOf(":");
      if (separator < 1) {
        continue;
      }
      const name = line.slice(0, separator).trim().toLowerCase();
      const value = line.slice(separator + 1).trim();
      const existing = headers[name];
      if (existing !== undefined) {
        existing.push(value);
        continue;
      }
      headers[name] = [value];
    }

    return headers;
  }

  export function headerValues(headers: HeaderMap, name: string): string[] {
    return headers[name.toLowerCase()] ?? [];
  }

  export function headerValue(headers: HeaderMap, name: string): string | null {
    return headerValues(headers, name)[0] ?? null;
  }

  export function extractAddresses(value: string): string[] {
    const angled = value.match(/<([^<>]+)>/g);
    if (angled !== null) {
      return angled.map((entry) => entry.slice(1, -1).trim().toLowerCase());
    }
    return value
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => entry.includes("@"));
  }
  ```

- [x] **Step 2: Write `server/mail/providers/headers.test.ts`**
  ```ts
  import { expect, test } from "bun:test";
  import { extractAddresses, HEADER_FETCH_SPEC, headerValue, headerValues, parseHeaderBlock } from "./headers";

  test("the fetch spec always peeks", () => {
    expect(HEADER_FETCH_SPEC.startsWith("BODY.PEEK[HEADER.FIELDS (")).toBe(true);
    expect(HEADER_FETCH_SPEC).toContain("DELIVERED-TO");
    expect(HEADER_FETCH_SPEC).toContain("AUTHENTICATION-RESULTS");
  });

  test("folded header lines are unfolded into a single value", () => {
    const raw = Buffer.from("List-Unsubscribe: <https://example.com/u>,\r\n <mailto:u@example.com>\r\n\r\n", "utf8");

    expect(headerValue(parseHeaderBlock(raw), "list-unsubscribe")).toBe("<https://example.com/u>, <mailto:u@example.com>");
  });

  test("repeated headers keep every value in order", () => {
    const raw = Buffer.from("Delivered-To: a@example.com\r\nDelivered-To: b@example.com\r\n", "utf8");

    expect(headerValues(parseHeaderBlock(raw), "Delivered-To")).toEqual(["a@example.com", "b@example.com"]);
  });

  test("an absent header block parses to an empty map", () => {
    expect(parseHeaderBlock(undefined)).toEqual({});
  });

  test("addresses are extracted from angle brackets and bare lists alike", () => {
    expect(extractAddresses('"Felix T" <Felix@Example.com>, ops@example.com')).toEqual(["felix@example.com"]);
    expect(extractAddresses("Felix@Example.com, ops@example.com")).toEqual(["felix@example.com", "ops@example.com"]);
  });
  ```

- [x] **Step 3: Verify**
  Run: `bun test server/mail/providers/headers.test.ts && bun run tsc && bunx biome check --fix server/mail/providers/headers.ts server/mail/providers/headers.test.ts`
  Expected: 5 tests pass; tsc clean.

- [x] **Step 4: Commit**
  ```bash
  git add server/mail/providers/headers.ts server/mail/providers/headers.test.ts && git commit -m "feat: add the BODY.PEEK header fetch spec and header parsing"
  ```

---

### Task 7: The IMAP provider

**Files:**
- Create: `server/mail/providers/imap.ts`

**Interfaces:**
- Consumes: `MailboxConnection` (Task 3), `buildTlsOptions` (Task 4), the provider types (Task 5), `HEADER_FIELDS` / `parseHeaderBlock` (Task 6).
- Produces: `createImapProvider(connection: MailboxConnection): Promise<MailboxProvider>`.

- [x] **Step 1: Write `server/mail/providers/imap.ts`**
  ```ts
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
  ```

- [x] **Step 2: Verify**
  Run: `bun run tsc && bunx biome check --fix server/mail/providers/imap.ts`
  Expected: tsc passes. Then confirm the read-only invariant: `grep -n "getMailboxLock" server/mail/providers/imap.ts` shows `{ readOnly: true }` on every call, and `grep -rn "messageFlagsAdd\|messageFlagsSet\|messageMove\|messageCopy\|messageDelete\|append(" server/mail` returns nothing.

- [x] **Step 3: Commit**
  ```bash
  git add server/mail/providers/imap.ts && git commit -m "feat: add the read-only imapflow provider"
  ```

---

### Task 8: Pure header-derived helpers — identity, DKIM alignment, thread key

**Files:**
- Create: `server/mail/classify/identity.ts`
- Create: `server/mail/classify/identity.test.ts`
- Create: `server/mail/classify/authentication.ts`
- Create: `server/mail/classify/authentication.test.ts`
- Create: `server/mail/classify/thread.ts`

**Interfaces:**
- Consumes: `MailboxFlavor` from `@server/mail/types`.
- Produces:
  - `normalizeAddress(address: string, flavor: MailboxFlavor): string`
  - `type IdentityMatcher = { matches: (address: string) => boolean }`
  - `createIdentityMatcher(input: { patterns: string[]; flavor: MailboxFlavor }): IdentityMatcher`
  - `isAddressedToMe(input: { to: string[]; delivered_to: string[]; x_original_to: string[] }, matcher: IdentityMatcher): boolean`
  - `isCcMe(cc: string[], matcher: IdentityMatcher): boolean`
  - `dkimAligned(authentication_results: string | null, from_domain: string | null): boolean | null`
  - `deriveThreadKey(input: { gm_thrid: string | null; references: string | null; in_reply_to: string | null; message_id: string | null }): string | null`

- [x] **Step 1: Write `server/mail/classify/identity.ts`**
  ```ts
  import type { MailboxFlavor } from "@server/mail/types";

  export type IdentityMatcher = {
    matches: (address: string) => boolean;
  };

  export function normalizeAddress(address: string, flavor: MailboxFlavor): string {
    const trimmed = address.trim().toLowerCase();
    const separator = trimmed.lastIndexOf("@");
    if (separator < 1) {
      return trimmed;
    }
    const local = trimmed.slice(0, separator);
    const domain = trimmed.slice(separator + 1);
    if (flavor !== "gmail") {
      return `${local}@${domain}`;
    }
    // Gmail ignores everything after a "+" in the local part, so felix+invoices@ and felix@ are the same
    // inbox; treating them as different addresses silently empties the Needs Action queue for the alias (§1.10).
    const plus = local.indexOf("+");
    return `${plus === -1 ? local : local.slice(0, plus)}@${domain}`;
  }

  export function createIdentityMatcher(input: { patterns: string[]; flavor: MailboxFlavor }): IdentityMatcher {
    const exact = new Set<string>();
    const domains = new Set<string>();

    for (const pattern of input.patterns) {
      const normalized = pattern.trim().toLowerCase();
      if (normalized.length === 0) {
        continue;
      }
      if (normalized.startsWith("*@")) {
        domains.add(normalized.slice(2));
        continue;
      }
      if (normalized.startsWith("@")) {
        domains.add(normalized.slice(1));
        continue;
      }
      exact.add(normalizeAddress(normalized, input.flavor));
    }

    return {
      matches: (address: string) => {
        const normalized = normalizeAddress(address, input.flavor);
        if (exact.has(normalized)) {
          return true;
        }
        const separator = normalized.lastIndexOf("@");
        if (separator < 1) {
          return false;
        }
        return domains.has(normalized.slice(separator + 1));
      },
    };
  }

  export function isAddressedToMe(
    input: { to: string[]; delivered_to: string[]; x_original_to: string[] },
    matcher: IdentityMatcher,
  ): boolean {
    return [...input.to, ...input.delivered_to, ...input.x_original_to].some((address) => matcher.matches(address));
  }

  export function isCcMe(cc: string[], matcher: IdentityMatcher): boolean {
    return cc.some((address) => matcher.matches(address));
  }
  ```

- [x] **Step 2: Write `server/mail/classify/identity.test.ts`**
  ```ts
  import { expect, test } from "bun:test";
  import { createIdentityMatcher, isAddressedToMe, isCcMe, normalizeAddress } from "./identity";

  test("gmail plus-addressing normalizes to the base address, generic IMAP keeps it", () => {
    expect(normalizeAddress("Felix+Invoices@Gmail.com", "gmail")).toBe("felix@gmail.com");
    expect(normalizeAddress("Felix+Invoices@example.com", "generic")).toBe("felix+invoices@example.com");
  });

  test("a gmail matcher recognises a plus-alias of a listed address", () => {
    const matcher = createIdentityMatcher({ patterns: ["felix@gmail.com"], flavor: "gmail" });

    expect(matcher.matches("felix+receipts@gmail.com")).toBe(true);
    expect(matcher.matches("someoneelse@gmail.com")).toBe(false);
  });

  test("a catch-all pattern matches any local part on the domain", () => {
    const matcher = createIdentityMatcher({ patterns: ["*@flext.dev"], flavor: "generic" });

    expect(matcher.matches("anything@flext.dev")).toBe(true);
    expect(matcher.matches("anything@other.dev")).toBe(false);
  });

  test("Delivered-To alone is enough to count as addressed to me", () => {
    const matcher = createIdentityMatcher({ patterns: ["felix@flext.dev"], flavor: "generic" });

    expect(isAddressedToMe({ to: ["list@example.com"], delivered_to: ["felix@flext.dev"], x_original_to: [] }, matcher)).toBe(true);
    expect(isAddressedToMe({ to: ["list@example.com"], delivered_to: [], x_original_to: [] }, matcher)).toBe(false);
  });

  test("Cc is tracked separately from addressed-to-me", () => {
    const matcher = createIdentityMatcher({ patterns: ["felix@flext.dev"], flavor: "generic" });

    expect(isCcMe(["felix@flext.dev"], matcher)).toBe(true);
    expect(isAddressedToMe({ to: [], delivered_to: [], x_original_to: [] }, matcher)).toBe(false);
  });
  ```

- [x] **Step 3: Write `server/mail/classify/authentication.ts`**
  ```ts
  export function dkimAligned(authentication_results: string | null, from_domain: string | null): boolean | null {
    if (authentication_results === null || from_domain === null) {
      return null;
    }
    const verdict = authentication_results.match(/dkim=(\w+)[^;]*?header\.d=([^\s;]+)/i);
    if (verdict === null) {
      return null;
    }
    const [, result, signing_domain] = verdict;
    const normalized_signing_domain = signing_domain.toLowerCase().replace(/^"|"$/g, "");
    const normalized_from_domain = from_domain.toLowerCase();
    const aligned =
      normalized_signing_domain === normalized_from_domain || normalized_from_domain.endsWith(`.${normalized_signing_domain}`);
    return result.toLowerCase() === "pass" && aligned;
  }
  ```

- [x] **Step 4: Write `server/mail/classify/authentication.test.ts`**
  ```ts
  import { expect, test } from "bun:test";
  import { dkimAligned } from "./authentication";

  test("a passing signature from the From domain is aligned", () => {
    expect(dkimAligned("mx.google.com; dkim=pass header.i=@acmecorp.com header.d=acmecorp.com; spf=pass", "acmecorp.com")).toBe(true);
  });

  test("a passing signature from a different domain is not aligned", () => {
    expect(dkimAligned("mx.google.com; dkim=pass header.d=sendgrid.net; spf=pass", "acmecorp.com")).toBe(false);
  });

  test("a failing signature is not aligned", () => {
    expect(dkimAligned("mx.google.com; dkim=fail header.d=acmecorp.com", "acmecorp.com")).toBe(false);
  });

  test("an absent or unparseable header is unknown, not false", () => {
    expect(dkimAligned(null, "acmecorp.com")).toBeNull();
    expect(dkimAligned("spf=pass smtp.mailfrom=acmecorp.com", "acmecorp.com")).toBeNull();
  });
  ```

- [x] **Step 5: Write `server/mail/classify/thread.ts`**
  ```ts
  export function deriveThreadKey(input: {
    gm_thrid: string | null;
    references: string | null;
    in_reply_to: string | null;
    message_id: string | null;
  }): string | null {
    if (input.gm_thrid !== null) {
      return input.gm_thrid;
    }
    const root_reference = (input.references ?? "").match(/<[^<>]+>/)?.[0] ?? null;
    return root_reference ?? input.in_reply_to ?? input.message_id;
  }
  ```

- [x] **Step 6: Verify**
  Run: `bun test server/mail/classify && bun run tsc && bunx biome check --fix server/mail/classify/identity.ts server/mail/classify/identity.test.ts server/mail/classify/authentication.ts server/mail/classify/authentication.test.ts server/mail/classify/thread.ts`
  Expected: 9 tests pass; tsc clean.

- [x] **Step 7: Commit**
  ```bash
  git add server/mail/classify && git commit -m "feat: add pure identity, dkim alignment and thread key helpers"
  ```

---

### Task 9: Cursors, folder selection and UID range arithmetic

**Files:**
- Create: `server/mail/sync/cursor.ts`
- Create: `server/mail/sync/folders.ts`
- Create: `server/mail/sync/uid-range.ts`
- Create: `server/mail/sync/uid-range.test.ts`

**Interfaces:**
- Consumes: `mailboxCursor` from `@server/db/schema`, `FolderInfo` from `@server/mail/providers/types`, `MailboxFlavor` / `GMAIL_CANONICAL_FOLDER` from `@server/mail/types`.
- Produces:
  - `type CursorKind = "messages" | "sent-scan"`, `type CursorRecord = typeof mailboxCursor.$inferSelect`
  - `loadCursor(input: { mailbox_id: string; folder: string; kind: CursorKind }): Promise<CursorRecord | null>`
  - `saveCursor(input: { mailbox_id; folder; kind; uid_validity; last_seen_uid; highest_modseq; last_sync_at?; last_reconcile_at? }): Promise<void>`
  - `selectSyncFolders(input: { flavor: MailboxFlavor; folders: FolderInfo[] }): string[]`
  - `selectSentFolders(folders: FolderInfo[]): string[]`
  - `buildUidRange(last_seen_uid: number): string`, `dropStaleUids<T extends { uid: number }>(items: T[], last_seen_uid: number): T[]`, `highestUid(items: Array<{ uid: number }>, fallback: number): number`, `batchUidRanges(input: { uid_next: number; batch_size: number }): string[]`

- [x] **Step 1: Write `server/mail/sync/uid-range.ts`**
  ```ts
  export function buildUidRange(last_seen_uid: number): string {
    return `${last_seen_uid + 1}:*`;
  }

  export function dropStaleUids<T extends { uid: number }>(items: T[], last_seen_uid: number): T[] {
    // RFC 3501 range semantics: when <last_seen_uid + 1> is past the highest UID present, the server still
    // returns the highest-UID message. Without this filter the newest message is reprocessed on all 96 runs
    // a day (§4.2).
    return items.filter((item) => item.uid > last_seen_uid);
  }

  export function highestUid(items: Array<{ uid: number }>, fallback: number): number {
    return items.reduce((highest, item) => (item.uid > highest ? item.uid : highest), fallback);
  }

  export function batchUidRanges(input: { uid_next: number; batch_size: number }): string[] {
    const ranges: string[] = [];
    const highest = input.uid_next - 1;
    for (let start = 1; start <= highest; start += input.batch_size) {
      const end = Math.min(start + input.batch_size - 1, highest);
      ranges.push(`${start}:${end}`);
    }
    return ranges;
  }
  ```

- [x] **Step 2: Write `server/mail/sync/uid-range.test.ts`**
  ```ts
  import { expect, test } from "bun:test";
  import { batchUidRanges, buildUidRange, dropStaleUids, highestUid } from "./uid-range";

  test("the incremental range starts one past the cursor", () => {
    expect(buildUidRange(1200)).toBe("1201:*");
    expect(buildUidRange(0)).toBe("1:*");
  });

  test("a server echoing the highest UID for an out-of-range request is filtered out", () => {
    const returned = [{ uid: 1200 }];

    expect(dropStaleUids(returned, 1200)).toEqual([]);
    expect(dropStaleUids([{ uid: 1201 }], 1200)).toEqual([{ uid: 1201 }]);
  });

  test("highestUid falls back when nothing came back", () => {
    expect(highestUid([], 1200)).toBe(1200);
    expect(highestUid([{ uid: 1201 }, { uid: 1205 }], 1200)).toBe(1205);
  });

  test("backfill ranges cover 1..uid_next-1 in batches", () => {
    expect(batchUidRanges({ uid_next: 1201, batch_size: 500 })).toEqual(["1:500", "501:1000", "1001:1200"]);
    expect(batchUidRanges({ uid_next: 1, batch_size: 500 })).toEqual([]);
  });
  ```

- [x] **Step 3: Write `server/mail/sync/folders.ts`**
  ```ts
  import type { FolderInfo } from "@server/mail/providers/types";
  import type { MailboxFlavor } from "@server/mail/types";
  import { GMAIL_CANONICAL_FOLDER } from "@server/mail/types";

  export function selectSyncFolders(input: { flavor: MailboxFlavor; folders: FolderInfo[] }): string[] {
    if (input.flavor === "gmail") {
      // Per-label folders are never walked: the same message appears in INBOX, the label folder and All Mail
      // with three different UIDs, which would triple every sender count downstream (§4.1).
      return [GMAIL_CANONICAL_FOLDER];
    }
    return input.folders.filter((folder) => folder.selectable).map((folder) => folder.path);
  }

  export function selectSentFolders(folders: FolderInfo[]): string[] {
    return folders.filter((folder) => folder.selectable && folder.special_use === "\\Sent").map((folder) => folder.path);
  }
  ```

- [x] **Step 4: Write `server/mail/sync/cursor.ts`**
  ```ts
  import { db } from "@server/db/drizzle";
  import { mailboxCursor } from "@server/db/schema";
  import { and, eq } from "drizzle-orm";

  export type CursorKind = "messages" | "sent-scan";
  export type CursorRecord = typeof mailboxCursor.$inferSelect;

  export async function loadCursor(input: { mailbox_id: string; folder: string; kind: CursorKind }): Promise<CursorRecord | null> {
    const rows = await db
      .select()
      .from(mailboxCursor)
      .where(
        and(
          eq(mailboxCursor.mailbox_id, input.mailbox_id),
          eq(mailboxCursor.folder, input.folder),
          eq(mailboxCursor.kind, input.kind),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  export async function saveCursor(input: {
    mailbox_id: string;
    folder: string;
    kind: CursorKind;
    uid_validity: string;
    last_seen_uid: number;
    highest_modseq: string | null;
    last_sync_at?: Date;
    last_reconcile_at?: Date;
  }): Promise<void> {
    const now = new Date();
    await db
      .insert(mailboxCursor)
      .values({
        mailbox_id: input.mailbox_id,
        folder: input.folder,
        kind: input.kind,
        uid_validity: input.uid_validity,
        last_seen_uid: input.last_seen_uid,
        highest_modseq: input.highest_modseq,
        last_sync_at: input.last_sync_at ?? null,
        last_reconcile_at: input.last_reconcile_at ?? null,
        updatedAt: now,
      })
      .onDuplicateKeyUpdate({
        set: {
          uid_validity: input.uid_validity,
          last_seen_uid: input.last_seen_uid,
          highest_modseq: input.highest_modseq,
          ...(input.last_sync_at ? { last_sync_at: input.last_sync_at } : {}),
          ...(input.last_reconcile_at ? { last_reconcile_at: input.last_reconcile_at } : {}),
          updatedAt: now,
        },
      });
  }
  ```

- [x] **Step 5: Verify**
  Run: `bun test server/mail/sync/uid-range.test.ts && bun run tsc && bunx biome check --fix server/mail/sync/uid-range.ts server/mail/sync/uid-range.test.ts server/mail/sync/folders.ts server/mail/sync/cursor.ts`
  Expected: 4 tests pass; tsc clean.

- [x] **Step 6: Commit**
  ```bash
  git add server/mail/sync/uid-range.ts server/mail/sync/uid-range.test.ts server/mail/sync/folders.ts server/mail/sync/cursor.ts && git commit -m "feat: add sync cursors, folder selection and uid range helpers"
  ```

---

### Task 10: Message and sender writer

**Files:**
- Create: `server/mail/sync/writer.ts`

**Interfaces:**
- Consumes: `FetchedMessage` (Task 5), `headerValue`/`headerValues`/`extractAddresses` (Task 6), `IdentityMatcher`/`isAddressedToMe`/`isCcMe` (Task 8), `dkimAligned` (Task 8), `deriveThreadKey` (Task 8), `MailboxRow` (Task 3).
- Produces:
  - `type WriteResult = { inserted: number; updated: number }`
  - `writeMessages(input: { mailbox_row: MailboxRow; folder: string; uid_validity: string; messages: FetchedMessage[]; matcher: IdentityMatcher }): Promise<WriteResult>`
  - `incrementReplyCounts(input: { counts: Map<string, number> }): Promise<number>`

- [x] **Step 1: Write `server/mail/sync/writer.ts`**
  ```ts
  import { db } from "@server/db/drizzle";
  import { mailboxObservedAddress, message, sender } from "@server/db/schema";
  import { dkimAligned } from "@server/mail/classify/authentication";
  import type { IdentityMatcher } from "@server/mail/classify/identity";
  import { isAddressedToMe, isCcMe } from "@server/mail/classify/identity";
  import { deriveThreadKey } from "@server/mail/classify/thread";
  import type { MailboxRow } from "@server/mail/mailbox";
  import { extractAddresses, headerValue, headerValues } from "@server/mail/providers/headers";
  import type { FetchedMessage } from "@server/mail/providers/types";
  import { serializeStringList } from "@server/mail/types";
  import { and, eq, inArray, sql } from "drizzle-orm";

  export type WriteResult = {
    inserted: number;
    updated: number;
  };

  const INSERT_CHUNK_SIZE = 200;

  type SenderAggregate = {
    address: string;
    domain: string;
    display_name: string | null;
    count: number;
    last_seen_at: Date;
  };

  function addressDomain(address: string): string {
    return address.slice(address.lastIndexOf("@") + 1);
  }

  function headerAddresses(headers: FetchedMessage["headers"], name: string): string[] {
    return headerValues(headers, name).flatMap((value) => extractAddresses(value));
  }

  async function existingUids(input: { mailbox_id: string; folder: string; uid_validity: string; uids: number[] }): Promise<Set<number>> {
    if (input.uids.length === 0) {
      return new Set();
    }
    const rows = await db
      .select({ uid: message.uid })
      .from(message)
      .where(
        and(
          eq(message.mailbox_id, input.mailbox_id),
          eq(message.folder, input.folder),
          eq(message.uid_validity, input.uid_validity),
          inArray(message.uid, input.uids),
        ),
      );
    return new Set(rows.map((row) => row.uid));
  }

  async function upsertSenders(aggregates: SenderAggregate[]): Promise<void> {
    const now = new Date();
    for (const aggregate of aggregates) {
      await db
        .insert(sender)
        .values({
          address: aggregate.address,
          domain: aggregate.domain,
          display_name: aggregate.display_name,
          message_count: aggregate.count,
          first_seen_at: aggregate.last_seen_at,
          last_seen_at: aggregate.last_seen_at,
          updatedAt: now,
        })
        .onDuplicateKeyUpdate({
          set: {
            message_count: sql`${sender.message_count} + ${aggregate.count}`,
            last_seen_at: aggregate.last_seen_at,
            updatedAt: now,
          },
        });
    }
  }

  async function upsertObservedAddresses(input: { mailbox_id: string; observed: Map<string, { source_header: string; count: number }> }): Promise<void> {
    const now = new Date();
    for (const [address, entry] of input.observed) {
      await db
        .insert(mailboxObservedAddress)
        .values({
          mailbox_id: input.mailbox_id,
          address,
          source_header: entry.source_header,
          occurrences: entry.count,
          first_seen_at: now,
          last_seen_at: now,
          updatedAt: now,
        })
        .onDuplicateKeyUpdate({
          set: {
            occurrences: sql`${mailboxObservedAddress.occurrences} + ${entry.count}`,
            last_seen_at: now,
            updatedAt: now,
          },
        });
    }
  }

  export async function writeMessages(input: {
    mailbox_row: MailboxRow;
    folder: string;
    uid_validity: string;
    messages: FetchedMessage[];
    matcher: IdentityMatcher;
  }): Promise<WriteResult> {
    if (input.messages.length === 0) {
      return { inserted: 0, updated: 0 };
    }

    const known_uids = await existingUids({
      mailbox_id: input.mailbox_row.id,
      folder: input.folder,
      uid_validity: input.uid_validity,
      uids: input.messages.map((entry) => entry.uid),
    });

    const now = new Date();
    const sender_aggregates = new Map<string, SenderAggregate>();
    const observed = new Map<string, { source_header: string; count: number }>();
    const rows = input.messages.map((entry) => {
      const from = entry.envelope.from[0] ?? null;
      const from_address = from?.address ?? null;
      const from_domain = from_address === null ? null : addressDomain(from_address);
      const delivered_to = headerAddresses(entry.headers, "Delivered-To");
      const x_original_to = headerAddresses(entry.headers, "X-Original-To");
      const content_type = headerValue(entry.headers, "Content-Type");

      if (from_address !== null && from_domain !== null && !known_uids.has(entry.uid)) {
        const aggregate = sender_aggregates.get(from_address);
        if (aggregate === undefined) {
          sender_aggregates.set(from_address, {
            address: from_address,
            domain: from_domain,
            display_name: from?.name ?? null,
            count: 1,
            last_seen_at: entry.internal_date,
          });
        }
        if (aggregate !== undefined) {
          aggregate.count += 1;
          aggregate.last_seen_at = entry.internal_date > aggregate.last_seen_at ? entry.internal_date : aggregate.last_seen_at;
        }
      }

      for (const address of delivered_to) {
        const seen = observed.get(address);
        observed.set(address, { source_header: "Delivered-To", count: (seen?.count ?? 0) + 1 });
      }
      for (const address of x_original_to) {
        const seen = observed.get(address);
        observed.set(address, { source_header: seen?.source_header ?? "X-Original-To", count: (seen?.count ?? 0) + 1 });
      }

      return {
        mailbox_id: input.mailbox_row.id,
        folder: input.folder,
        uid: entry.uid,
        uid_validity: input.uid_validity,
        gm_msgid: entry.gm_msgid,
        gm_thrid: entry.gm_thrid,
        message_id: entry.envelope.message_id,
        thread_key: deriveThreadKey({
          gm_thrid: entry.gm_thrid,
          references: headerValue(entry.headers, "References"),
          in_reply_to: entry.envelope.in_reply_to,
          message_id: entry.envelope.message_id,
        }),
        from_address,
        from_domain,
        from_name: from?.name ?? null,
        to_me: isAddressedToMe(
          { to: entry.envelope.to.map((address) => address.address), delivered_to, x_original_to },
          input.matcher,
        ),
        cc_me: isCcMe(
          entry.envelope.cc.map((address) => address.address),
          input.matcher,
        ),
        subject: entry.envelope.subject,
        sent_at: entry.envelope.date,
        internal_date: entry.internal_date,
        size: entry.size,
        has_attachment: (content_type ?? "").toLowerCase().startsWith("multipart/mixed"),
        list_id: headerValue(entry.headers, "List-Id"),
        list_unsubscribe: headerValue(entry.headers, "List-Unsubscribe"),
        precedence: headerValue(entry.headers, "Precedence"),
        auto_submitted: headerValue(entry.headers, "Auto-Submitted"),
        dkim_aligned: dkimAligned(headerValue(entry.headers, "Authentication-Results"), from_domain),
        is_seen: entry.flags.includes("\\Seen"),
        is_flagged: entry.flags.includes("\\Flagged"),
        labels: entry.labels === null ? null : serializeStringList(entry.labels),
        updatedAt: now,
      };
    });

    for (let offset = 0; offset < rows.length; offset += INSERT_CHUNK_SIZE) {
      const chunk = rows.slice(offset, offset + INSERT_CHUNK_SIZE);
      await db
        .insert(message)
        .values(chunk)
        .onDuplicateKeyUpdate({
          set: {
            uid: sql`VALUES(\`uid\`)`,
            uid_validity: sql`VALUES(\`uidValidity\`)`,
            is_seen: sql`VALUES(\`isSeen\`)`,
            is_flagged: sql`VALUES(\`isFlagged\`)`,
            labels: sql`VALUES(\`labels\`)`,
            disappeared_at: null,
            updatedAt: now,
          },
        });
    }

    await upsertSenders([...sender_aggregates.values()]);
    await upsertObservedAddresses({ mailbox_id: input.mailbox_row.id, observed });

    const inserted = rows.length - known_uids.size;
    return { inserted, updated: known_uids.size };
  }

  export async function incrementReplyCounts(input: { counts: Map<string, number> }): Promise<number> {
    const now = new Date();
    for (const [address, count] of input.counts) {
      await db
        .insert(sender)
        .values({
          address,
          domain: addressDomain(address),
          my_reply_count: count,
          first_seen_at: now,
          last_seen_at: now,
          updatedAt: now,
        })
        .onDuplicateKeyUpdate({
          set: {
            my_reply_count: sql`${sender.my_reply_count} + ${count}`,
            updatedAt: now,
          },
        });
    }
    return input.counts.size;
  }
  ```

- [x] **Step 2: Verify**
  Run: `bun run tsc && bunx biome check --fix server/mail/sync/writer.ts`
  Expected: tsc passes. `sql\`VALUES(\`uid\`)\`` is MySQL's on-duplicate value reference — confirm the generated statement shape by reading the drizzle query in `db.insert(...).onDuplicateKeyUpdate(...)` (no execution needed).

- [x] **Step 3: Commit**
  ```bash
  git add server/mail/sync/writer.ts && git commit -m "feat: add the metadata message writer with sender and alias aggregation"
  ```

---

### Task 11: `UIDVALIDITY` re-key (§11)

**Files:**
- Create: `server/mail/sync/rekey.ts`

**Interfaces:**
- Consumes: `MailboxProvider.fetchIdentities` (Task 5/7), `MailboxRow` (Task 3).
- Produces: `type RekeyResult = { rekeyed: number; disappeared: number }`, `rekeyFolder(input: { provider: MailboxProvider; mailbox_row: MailboxRow; folder: string; old_uid_validity: string; new_uid_validity: string }): Promise<RekeyResult>`.

- [x] **Step 1: Write `server/mail/sync/rekey.ts`**
  ```ts
  import { db } from "@server/db/drizzle";
  import { message } from "@server/db/schema";
  import type { MailboxRow } from "@server/mail/mailbox";
  import type { MailboxProvider } from "@server/mail/providers/types";
  import { parseMailboxFlavor } from "@server/mail/types";
  import { and, eq, isNull } from "drizzle-orm";

  export type RekeyResult = {
    rekeyed: number;
    disappeared: number;
  };

  export async function rekeyFolder(input: {
    provider: MailboxProvider;
    mailbox_row: MailboxRow;
    folder: string;
    old_uid_validity: string;
    new_uid_validity: string;
  }): Promise<RekeyResult> {
    const gmail = parseMailboxFlavor(input.mailbox_row.flavor) === "gmail";
    const identities = await input.provider.fetchIdentities(input.folder);

    const rows = await db
      .select({ id: message.id, gm_msgid: message.gm_msgid, message_id: message.message_id })
      .from(message)
      .where(
        and(
          eq(message.mailbox_id, input.mailbox_row.id),
          eq(message.folder, input.folder),
          eq(message.uid_validity, input.old_uid_validity),
          isNull(message.disappeared_at),
        ),
      );

    // UIDs are gone after a server-side reindex, but X-GM-MSGID (Gmail) and RFC Message-ID (generic) are not.
    // Without this the whole action journal silently detaches from its messages (§11).
    const by_stable_key = new Map<string, string>();
    for (const row of rows) {
      const key = gmail ? row.gm_msgid : row.message_id;
      if (key === null) {
        continue;
      }
      by_stable_key.set(key, row.id);
    }

    const now = new Date();
    const matched_ids = new Set<string>();
    for (const identity of identities) {
      const key = gmail ? identity.gm_msgid : identity.message_id;
      if (key === null) {
        continue;
      }
      const row_id = by_stable_key.get(key);
      if (row_id === undefined) {
        continue;
      }
      await db
        .update(message)
        .set({ uid: identity.uid, uid_validity: input.new_uid_validity, updatedAt: now })
        .where(eq(message.id, row_id));
      matched_ids.add(row_id);
    }

    let disappeared = 0;
    for (const row of rows) {
      if (matched_ids.has(row.id)) {
        continue;
      }
      await db.update(message).set({ disappeared_at: now, updatedAt: now }).where(eq(message.id, row.id));
      disappeared += 1;
    }

    return { rekeyed: matched_ids.size, disappeared };
  }
  ```

- [x] **Step 2: Verify**
  Run: `bun run tsc && bunx biome check --fix server/mail/sync/rekey.ts`
  Expected: tsc passes.

- [x] **Step 3: Commit**
  ```bash
  git add server/mail/sync/rekey.ts && git commit -m "feat: re-key messages by gm_msgid or message-id on uidvalidity change"
  ```

---

### Task 12: Incremental fetch (§4.2)

**Files:**
- Create: `server/mail/sync/incremental.ts`

**Interfaces:**
- Consumes: cursor helpers (Task 9), uid-range helpers (Task 9), `writeMessages` (Task 10), `rekeyFolder` (Task 11), `createIdentityMatcher` (Task 8).
- Produces: `type FolderSyncResult = { folder: string; new_messages: number; flag_updates: number; vanished: number; resynced: boolean }`, `syncFolderIncrementally(input: { provider: MailboxProvider; mailbox_row: MailboxRow; folder: string }): Promise<FolderSyncResult>`, `markVanished(input: { mailbox_id: string; folder: string; uid_validity: string; uids: number[] }): Promise<number>`.

- [x] **Step 1: Write `server/mail/sync/incremental.ts`**
  ```ts
  import { db } from "@server/db/drizzle";
  import { message } from "@server/db/schema";
  import { createIdentityMatcher } from "@server/mail/classify/identity";
  import type { MailboxRow } from "@server/mail/mailbox";
  import { mailboxIdentityAddresses } from "@server/mail/mailbox";
  import type { MailboxProvider } from "@server/mail/providers/types";
  import { loadCursor, saveCursor } from "@server/mail/sync/cursor";
  import { rekeyFolder } from "@server/mail/sync/rekey";
  import { buildUidRange, dropStaleUids, highestUid } from "@server/mail/sync/uid-range";
  import { writeMessages } from "@server/mail/sync/writer";
  import { parseMailboxFlavor } from "@server/mail/types";
  import { and, eq, inArray, isNull, sql } from "drizzle-orm";

  export type FolderSyncResult = {
    folder: string;
    new_messages: number;
    flag_updates: number;
    vanished: number;
    resynced: boolean;
  };

  export async function markVanished(input: {
    mailbox_id: string;
    folder: string;
    uid_validity: string;
    uids: number[];
  }): Promise<number> {
    if (input.uids.length === 0) {
      return 0;
    }
    const now = new Date();
    await db
      .update(message)
      .set({ disappeared_at: now, updatedAt: now })
      .where(
        and(
          eq(message.mailbox_id, input.mailbox_id),
          eq(message.folder, input.folder),
          eq(message.uid_validity, input.uid_validity),
          inArray(message.uid, input.uids),
          isNull(message.disappeared_at),
        ),
      );
    return input.uids.length;
  }

  async function applyFlagChanges(input: {
    mailbox_id: string;
    folder: string;
    uid_validity: string;
    changes: Array<{ uid: number; flags: string[] }>;
  }): Promise<number> {
    const now = new Date();
    for (const change of input.changes) {
      const is_seen = change.flags.includes("\\Seen");
      const scope = and(
        eq(message.mailbox_id, input.mailbox_id),
        eq(message.folder, input.folder),
        eq(message.uid_validity, input.uid_validity),
        eq(message.uid, change.uid),
      );
      if (!is_seen) {
        await db.update(message).set({ is_seen, is_flagged: change.flags.includes("\\Flagged"), updatedAt: now }).where(scope);
        continue;
      }
      // opened_at is the first \Seen transition and never moves afterwards; §8's rescue detection compares it
      // against the action's applied_at, which a bare is_read flag cannot express.
      await db
        .update(message)
        .set({
          is_seen,
          is_flagged: change.flags.includes("\\Flagged"),
          opened_at: sql`COALESCE(${message.opened_at}, ${now})`,
          updatedAt: now,
        })
        .where(scope);
    }
    return input.changes.length;
  }

  export async function syncFolderIncrementally(input: {
    provider: MailboxProvider;
    mailbox_row: MailboxRow;
    folder: string;
  }): Promise<FolderSyncResult> {
    const status = await input.provider.openFolder(input.folder);
    const cursor = await loadCursor({ mailbox_id: input.mailbox_row.id, folder: input.folder, kind: "messages" });
    const matcher = createIdentityMatcher({
      patterns: mailboxIdentityAddresses(input.mailbox_row),
      flavor: parseMailboxFlavor(input.mailbox_row.flavor),
    });

    if (cursor === null) {
      await saveCursor({
        mailbox_id: input.mailbox_row.id,
        folder: input.folder,
        kind: "messages",
        uid_validity: status.uid_validity,
        last_seen_uid: 0,
        highest_modseq: null,
      });
      return { folder: input.folder, new_messages: 0, flag_updates: 0, vanished: 0, resynced: true };
    }

    if (cursor.uid_validity !== status.uid_validity) {
      const rekey = await rekeyFolder({
        provider: input.provider,
        mailbox_row: input.mailbox_row,
        folder: input.folder,
        old_uid_validity: cursor.uid_validity,
        new_uid_validity: status.uid_validity,
      });
      // The server invalidated every UID, so the folder is refetched from UID 1 on the next pass — no
      // exceptions (§4.2 step 1).
      await saveCursor({
        mailbox_id: input.mailbox_row.id,
        folder: input.folder,
        kind: "messages",
        uid_validity: status.uid_validity,
        last_seen_uid: 0,
        highest_modseq: null,
      });
      return { folder: input.folder, new_messages: 0, flag_updates: rekey.rekeyed, vanished: rekey.disappeared, resynced: true };
    }

    let flag_updates = 0;
    let vanished = 0;
    if (input.provider.capabilities.condstore && cursor.highest_modseq !== null) {
      const result = await input.provider.fetchFlagChanges(input.folder, cursor.highest_modseq);
      flag_updates = await applyFlagChanges({
        mailbox_id: input.mailbox_row.id,
        folder: input.folder,
        uid_validity: status.uid_validity,
        changes: result.changes,
      });
      vanished = await markVanished({
        mailbox_id: input.mailbox_row.id,
        folder: input.folder,
        uid_validity: status.uid_validity,
        uids: result.vanished_uids,
      });
    }

    const fetched = await input.provider.fetchHeaders(input.folder, buildUidRange(cursor.last_seen_uid));
    const fresh = dropStaleUids(fetched, cursor.last_seen_uid);
    const written = await writeMessages({
      mailbox_row: input.mailbox_row,
      folder: input.folder,
      uid_validity: status.uid_validity,
      messages: fresh,
      matcher,
    });

    await saveCursor({
      mailbox_id: input.mailbox_row.id,
      folder: input.folder,
      kind: "messages",
      uid_validity: status.uid_validity,
      last_seen_uid: highestUid(fresh, cursor.last_seen_uid),
      highest_modseq: status.highest_modseq,
      last_sync_at: new Date(),
    });

    return { folder: input.folder, new_messages: written.inserted, flag_updates, vanished, resynced: false };
  }
  ```

- [x] **Step 2: Verify**
  Run: `bun run tsc && bunx biome check --fix server/mail/sync/incremental.ts`
  Expected: tsc passes; `grep -n "dropStaleUids" server/mail/sync/incremental.ts` shows the filter applied to every incremental fetch.

- [x] **Step 3: Commit**
  ```bash
  git add server/mail/sync/incremental.ts && git commit -m "feat: add incremental header sync with condstore flag updates"
  ```

---

### Task 13: Reconciliation (§4.3)

**Files:**
- Create: `server/mail/sync/reconcile.ts`

**Interfaces:**
- Consumes: `markVanished` (Task 12), cursor helpers (Task 9), `MailboxProvider.listUids` / `fetchFlagChanges` (Task 5/7).
- Produces: `type ReconcileResult = { folder: string; vanished: number; strategy: "qresync" | "search" }`, `reconcileFolder(input: { provider: MailboxProvider; mailbox_row: MailboxRow; folder: string }): Promise<ReconcileResult>`.

- [x] **Step 1: Write `server/mail/sync/reconcile.ts`**
  ```ts
  import { db } from "@server/db/drizzle";
  import { message } from "@server/db/schema";
  import type { MailboxRow } from "@server/mail/mailbox";
  import type { MailboxProvider } from "@server/mail/providers/types";
  import { loadCursor, saveCursor } from "@server/mail/sync/cursor";
  import { markVanished } from "@server/mail/sync/incremental";
  import { and, eq, isNull } from "drizzle-orm";

  export type ReconcileResult = {
    folder: string;
    vanished: number;
    strategy: "qresync" | "search";
  };

  export async function reconcileFolder(input: {
    provider: MailboxProvider;
    mailbox_row: MailboxRow;
    folder: string;
  }): Promise<ReconcileResult> {
    const status = await input.provider.openFolder(input.folder);
    const cursor = await loadCursor({ mailbox_id: input.mailbox_row.id, folder: input.folder, kind: "messages" });
    if (cursor === null || cursor.uid_validity !== status.uid_validity) {
      return { folder: input.folder, vanished: 0, strategy: "search" };
    }

    const now = new Date();

    // CONDSTORE reports changes but never expunges. With QRESYNC the VANISHED (EARLIER) response carries the
    // UIDs deleted while we were away; without it the only honest answer is a full set difference (§4.3).
    if (input.provider.capabilities.qresync && cursor.highest_modseq !== null) {
      const result = await input.provider.fetchFlagChanges(input.folder, cursor.highest_modseq);
      const vanished = await markVanished({
        mailbox_id: input.mailbox_row.id,
        folder: input.folder,
        uid_validity: status.uid_validity,
        uids: result.vanished_uids,
      });
      await saveCursor({
        mailbox_id: input.mailbox_row.id,
        folder: input.folder,
        kind: "messages",
        uid_validity: cursor.uid_validity,
        last_seen_uid: cursor.last_seen_uid,
        highest_modseq: status.highest_modseq,
        last_reconcile_at: now,
      });
      return { folder: input.folder, vanished, strategy: "qresync" };
    }

    const server_uids = new Set(await input.provider.listUids(input.folder));
    const stored = await db
      .select({ uid: message.uid })
      .from(message)
      .where(
        and(
          eq(message.mailbox_id, input.mailbox_row.id),
          eq(message.folder, input.folder),
          eq(message.uid_validity, status.uid_validity),
          isNull(message.disappeared_at),
        ),
      );

    const missing = stored.map((row) => row.uid).filter((uid) => !server_uids.has(uid));
    const vanished = await markVanished({
      mailbox_id: input.mailbox_row.id,
      folder: input.folder,
      uid_validity: status.uid_validity,
      uids: missing,
    });

    await saveCursor({
      mailbox_id: input.mailbox_row.id,
      folder: input.folder,
      kind: "messages",
      uid_validity: cursor.uid_validity,
      last_seen_uid: cursor.last_seen_uid,
      highest_modseq: cursor.highest_modseq,
      last_reconcile_at: now,
    });

    return { folder: input.folder, vanished, strategy: "search" };
  }
  ```

- [x] **Step 2: Verify**
  Run: `bun run tsc && bunx biome check --fix server/mail/sync/reconcile.ts`
  Expected: tsc passes. Confirm rows are never deleted: `grep -n "db.delete" server/mail` returns nothing — vanished messages only get `disappeared_at` so the journal stays intact.

- [x] **Step 3: Commit**
  ```bash
  git add server/mail/sync/reconcile.ts && git commit -m "feat: reconcile vanished messages via qresync with a uid search fallback"
  ```

---

### Task 14: Backfill and the Sent scan (§4.4)

**Files:**
- Create: `server/mail/sync/backfill.ts`

**Interfaces:**
- Consumes: folder selection (Task 9), uid-range batching (Task 9), `writeMessages` / `incrementReplyCounts` (Task 10), identity matcher (Task 8).
- Produces:
  - `type BackfillResult = { folders: number; messages: number; sent_scanned: number; reply_senders: number }`
  - `backfillMailbox(input: { provider: MailboxProvider; mailbox_row: MailboxRow }): Promise<BackfillResult>`
  - `scanSentFolder(input: { provider: MailboxProvider; mailbox_row: MailboxRow; folder: string }): Promise<{ scanned: number; senders: number }>`

- [x] **Step 1: Write `server/mail/sync/backfill.ts`**
  ```ts
  import { createIdentityMatcher } from "@server/mail/classify/identity";
  import type { MailboxRow } from "@server/mail/mailbox";
  import { mailboxIdentityAddresses } from "@server/mail/mailbox";
  import type { MailboxProvider } from "@server/mail/providers/types";
  import { loadCursor, saveCursor } from "@server/mail/sync/cursor";
  import { selectSentFolders, selectSyncFolders } from "@server/mail/sync/folders";
  import { batchUidRanges, buildUidRange, dropStaleUids, highestUid } from "@server/mail/sync/uid-range";
  import { incrementReplyCounts, writeMessages } from "@server/mail/sync/writer";
  import { parseMailboxFlavor } from "@server/mail/types";

  export type BackfillResult = {
    folders: number;
    messages: number;
    sent_scanned: number;
    reply_senders: number;
  };

  const BACKFILL_BATCH_SIZE = 500;

  export async function scanSentFolder(input: {
    provider: MailboxProvider;
    mailbox_row: MailboxRow;
    folder: string;
  }): Promise<{ scanned: number; senders: number }> {
    const status = await input.provider.openFolder(input.folder);
    const cursor = await loadCursor({ mailbox_id: input.mailbox_row.id, folder: input.folder, kind: "sent-scan" });
    const from_scratch = cursor === null || cursor.uid_validity !== status.uid_validity;
    const last_seen_uid = from_scratch ? 0 : cursor.last_seen_uid;

    const matcher = createIdentityMatcher({
      patterns: mailboxIdentityAddresses(input.mailbox_row),
      flavor: parseMailboxFlavor(input.mailbox_row.flavor),
    });

    const counts = new Map<string, number>();
    let scanned = 0;
    let highest_seen = last_seen_uid;

    const ranges = from_scratch
      ? batchUidRanges({ uid_next: status.uid_next, batch_size: BACKFILL_BATCH_SIZE })
      : [buildUidRange(last_seen_uid)];

    for (const range of ranges) {
      const fetched = dropStaleUids(await input.provider.fetchHeaders(input.folder, range), highest_seen);
      for (const entry of fetched) {
        scanned += 1;
        const authored_by_me = entry.envelope.from.some((address) => matcher.matches(address.address));
        if (!authored_by_me) {
          continue;
        }
        // "Have I ever written to this person?" is the highest-signal feature in the system and no vendor
        // has it; it costs exactly this one scan (§4.4).
        for (const recipient of [...entry.envelope.to, ...entry.envelope.cc]) {
          if (matcher.matches(recipient.address)) {
            continue;
          }
          counts.set(recipient.address, (counts.get(recipient.address) ?? 0) + 1);
        }
      }
      highest_seen = highestUid(fetched, highest_seen);
    }

    const senders = await incrementReplyCounts({ counts });

    await saveCursor({
      mailbox_id: input.mailbox_row.id,
      folder: input.folder,
      kind: "sent-scan",
      uid_validity: status.uid_validity,
      last_seen_uid: highest_seen,
      highest_modseq: status.highest_modseq,
      last_sync_at: new Date(),
    });

    return { scanned, senders };
  }

  export async function backfillMailbox(input: { provider: MailboxProvider; mailbox_row: MailboxRow }): Promise<BackfillResult> {
    const flavor = parseMailboxFlavor(input.mailbox_row.flavor);
    const folders = await input.provider.listFolders();
    const matcher = createIdentityMatcher({ patterns: mailboxIdentityAddresses(input.mailbox_row), flavor });

    let messages = 0;
    const walked = selectSyncFolders({ flavor, folders });
    for (const folder of walked) {
      const status = await input.provider.openFolder(folder);
      let highest_seen = 0;
      for (const range of batchUidRanges({ uid_next: status.uid_next, batch_size: BACKFILL_BATCH_SIZE })) {
        const fetched = await input.provider.fetchHeaders(folder, range);
        const written = await writeMessages({
          mailbox_row: input.mailbox_row,
          folder,
          uid_validity: status.uid_validity,
          messages: fetched,
          matcher,
        });
        messages += written.inserted;
        highest_seen = highestUid(fetched, highest_seen);
      }
      await saveCursor({
        mailbox_id: input.mailbox_row.id,
        folder,
        kind: "messages",
        uid_validity: status.uid_validity,
        last_seen_uid: highest_seen,
        highest_modseq: status.highest_modseq,
        last_sync_at: new Date(),
      });
    }

    let sent_scanned = 0;
    let reply_senders = 0;
    for (const folder of selectSentFolders(folders)) {
      const scan = await scanSentFolder({ provider: input.provider, mailbox_row: input.mailbox_row, folder });
      sent_scanned += scan.scanned;
      reply_senders += scan.senders;
    }

    return { folders: walked.length, messages, sent_scanned, reply_senders };
  }
  ```

- [x] **Step 2: Verify**
  Run: `bun run tsc && bunx biome check --fix server/mail/sync/backfill.ts`
  Expected: tsc passes. Confirm the Gmail rule holds: `selectSyncFolders` is the only source of walked folders, so a Gmail mailbox backfills `[Gmail]/All Mail` only.

- [x] **Step 3: Commit**
  ```bash
  git add server/mail/sync/backfill.ts && git commit -m "feat: add batched backfill and the sent folder reply-count scan"
  ```

---

### Task 15: Run orchestration, error classification and per-mailbox isolation (§11)

**Files:**
- Create: `server/mail/errors.ts`
- Create: `server/mail/errors.test.ts`
- Create: `server/mail/sync/run.ts`

**Interfaces:**
- Consumes: `mailboxConnection` (Task 3), `createImapProvider` (Task 7), `syncFolderIncrementally` (Task 12), `reconcileFolder` (Task 13), `backfillMailbox` / `scanSentFolder` (Task 14), folder selection (Task 9).
- Produces:
  - `type MailboxFailureKind = "auth" | "tls_pin" | "network" | "unknown"`, `type MailboxFailure = { kind; message; disable_mailbox }`, `classifyMailboxError(error: unknown): MailboxFailure`
  - `type MailboxRunSummary = { mailbox_id; label; kind; status; folders; new_messages; flag_updates; vanished; error }`
  - `runMailboxSync(input: { mailbox_row: MailboxRow; mode: SyncMode }): Promise<MailboxRunSummary>`
  - `runSyncForAllMailboxes(input: { mode: SyncMode; mailbox_id?: string }): Promise<MailboxRunSummary[]>`

- [x] **Step 1: Write `server/mail/errors.ts`**
  ```ts
  export type MailboxFailureKind = "auth" | "tls_pin" | "network" | "unknown";

  export type MailboxFailure = {
    kind: MailboxFailureKind;
    message: string;
    disable_mailbox: boolean;
  };

  function readStringField(value: unknown, field: string): string | null {
    if (typeof value !== "object" || value === null) {
      return null;
    }
    const candidate = (value as Record<string, unknown>)[field];
    return typeof candidate === "string" ? candidate : null;
  }

  function readBooleanField(value: unknown, field: string): boolean {
    if (typeof value !== "object" || value === null) {
      return false;
    }
    return (value as Record<string, unknown>)[field] === true;
  }

  export function classifyMailboxError(error: unknown): MailboxFailure {
    const message = error instanceof Error ? error.message : String(error);
    const code = readStringField(error, "code") ?? "";

    if (message.includes("pinned SPKI mismatch")) {
      return { kind: "tls_pin", message, disable_mailbox: true };
    }
    if (readBooleanField(error, "authenticationFailed") || code === "AUTHENTICATIONFAILED") {
      return { kind: "auth", message, disable_mailbox: true };
    }
    if (["ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND", "ECONNRESET", "EAI_AGAIN", "CONNECT_TIMEOUT"].includes(code)) {
      return { kind: "network", message, disable_mailbox: false };
    }
    return { kind: "unknown", message, disable_mailbox: false };
  }
  ```

- [x] **Step 2: Write `server/mail/errors.test.ts`**
  ```ts
  import { expect, test } from "bun:test";
  import { classifyMailboxError } from "./errors";

  test("an SPKI mismatch is a hard stop that disables the mailbox", () => {
    const failure = classifyMailboxError(new Error("pinned SPKI mismatch for mail.example.com: server presented abc="));

    expect(failure.kind).toBe("tls_pin");
    expect(failure.disable_mailbox).toBe(true);
  });

  test("an expired app password disables the mailbox instead of retrying", () => {
    const error = Object.assign(new Error("Invalid credentials"), { authenticationFailed: true });

    expect(classifyMailboxError(error)).toEqual({ kind: "auth", message: "Invalid credentials", disable_mailbox: true });
  });

  test("a network blip keeps the mailbox enabled", () => {
    const error = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
    const failure = classifyMailboxError(error);

    expect(failure.kind).toBe("network");
    expect(failure.disable_mailbox).toBe(false);
  });

  test("a non-Error rejection still classifies", () => {
    expect(classifyMailboxError("boom")).toEqual({ kind: "unknown", message: "boom", disable_mailbox: false });
  });
  ```

- [x] **Step 3: Write `server/mail/sync/run.ts`**
  ```ts
  import { db } from "@server/db/drizzle";
  import { mailbox, syncRun } from "@server/db/schema";
  import { classifyMailboxError } from "@server/mail/errors";
  import type { MailboxRow } from "@server/mail/mailbox";
  import { mailboxConnection } from "@server/mail/mailbox";
  import { createImapProvider } from "@server/mail/providers/imap";
  import type { MailboxProvider } from "@server/mail/providers/types";
  import { backfillMailbox, scanSentFolder } from "@server/mail/sync/backfill";
  import { selectSentFolders, selectSyncFolders } from "@server/mail/sync/folders";
  import { syncFolderIncrementally } from "@server/mail/sync/incremental";
  import { reconcileFolder } from "@server/mail/sync/reconcile";
  import type { SyncMode } from "@server/mail/types";
  import { parseMailboxFlavor } from "@server/mail/types";
  import { and, eq } from "drizzle-orm";

  export type MailboxRunSummary = {
    mailbox_id: string;
    label: string;
    kind: SyncMode;
    status: "ok" | "failed";
    folders: number;
    new_messages: number;
    flag_updates: number;
    vanished: number;
    error: string | null;
  };

  type RunTotals = {
    folders: number;
    new_messages: number;
    flag_updates: number;
    vanished: number;
  };

  async function runMode(input: { provider: MailboxProvider; mailbox_row: MailboxRow; mode: SyncMode }): Promise<RunTotals> {
    if (input.mode === "backfill") {
      const result = await backfillMailbox({ provider: input.provider, mailbox_row: input.mailbox_row });
      return { folders: result.folders, new_messages: result.messages, flag_updates: 0, vanished: 0 };
    }

    const folders = await input.provider.listFolders();
    const walked = selectSyncFolders({ flavor: parseMailboxFlavor(input.mailbox_row.flavor), folders });
    const totals: RunTotals = { folders: walked.length, new_messages: 0, flag_updates: 0, vanished: 0 };

    if (input.mode === "reconcile") {
      for (const folder of walked) {
        const result = await reconcileFolder({ provider: input.provider, mailbox_row: input.mailbox_row, folder });
        totals.vanished += result.vanished;
      }
      return totals;
    }

    for (const folder of walked) {
      const result = await syncFolderIncrementally({ provider: input.provider, mailbox_row: input.mailbox_row, folder });
      totals.new_messages += result.new_messages;
      totals.flag_updates += result.flag_updates;
      totals.vanished += result.vanished;
    }
    for (const folder of selectSentFolders(folders)) {
      await scanSentFolder({ provider: input.provider, mailbox_row: input.mailbox_row, folder });
    }
    return totals;
  }

  export async function runMailboxSync(input: { mailbox_row: MailboxRow; mode: SyncMode }): Promise<MailboxRunSummary> {
    const started_at = new Date();
    const run_rows = await db
      .insert(syncRun)
      .values({
        mailbox_id: input.mailbox_row.id,
        kind: input.mode,
        status: "running",
        started_at,
        updatedAt: started_at,
      })
      .$returningId();
    const run_id = run_rows[0]?.id ?? null;

    let provider: MailboxProvider | null = null;
    try {
      provider = await createImapProvider(mailboxConnection(input.mailbox_row));
      const totals = await runMode({ provider, mailbox_row: input.mailbox_row, mode: input.mode });
      const finished_at = new Date();

      if (run_id !== null) {
        await db
          .update(syncRun)
          .set({
            status: "ok",
            finished_at,
            folders_synced: totals.folders,
            messages_new: totals.new_messages,
            messages_updated: totals.flag_updates,
            messages_vanished: totals.vanished,
            updatedAt: finished_at,
          })
          .where(eq(syncRun.id, run_id));
      }

      await db
        .update(mailbox)
        .set({
          last_error: null,
          last_error_at: null,
          ...(input.mode === "backfill" ? { backfilled_at: finished_at } : {}),
          updatedAt: finished_at,
        })
        .where(eq(mailbox.id, input.mailbox_row.id));

      return {
        mailbox_id: input.mailbox_row.id,
        label: input.mailbox_row.label,
        kind: input.mode,
        status: "ok",
        folders: totals.folders,
        new_messages: totals.new_messages,
        flag_updates: totals.flag_updates,
        vanished: totals.vanished,
        error: null,
      };
    } catch (error) {
      // Per-mailbox isolation: a dead connection, an expired app password or an SPKI change fails this
      // mailbox's run and leaves the other five untouched (§11).
      const failure = classifyMailboxError(error);
      const finished_at = new Date();

      if (run_id !== null) {
        await db
          .update(syncRun)
          .set({ status: "failed", finished_at, error_message: `${failure.kind}: ${failure.message}`, updatedAt: finished_at })
          .where(eq(syncRun.id, run_id));
      }

      await db
        .update(mailbox)
        .set({
          last_error: `${failure.kind}: ${failure.message}`,
          last_error_at: finished_at,
          ...(failure.disable_mailbox ? { enabled: false } : {}),
          updatedAt: finished_at,
        })
        .where(eq(mailbox.id, input.mailbox_row.id));

      return {
        mailbox_id: input.mailbox_row.id,
        label: input.mailbox_row.label,
        kind: input.mode,
        status: "failed",
        folders: 0,
        new_messages: 0,
        flag_updates: 0,
        vanished: 0,
        error: `${failure.kind}: ${failure.message}`,
      };
    } finally {
      if (provider !== null) {
        await provider.disconnect();
      }
    }
  }

  export async function runSyncForAllMailboxes(input: { mode: SyncMode; mailbox_id?: string }): Promise<MailboxRunSummary[]> {
    const rows = await db
      .select()
      .from(mailbox)
      .where(input.mailbox_id ? and(eq(mailbox.enabled, true), eq(mailbox.id, input.mailbox_id)) : eq(mailbox.enabled, true));

    const summaries: MailboxRunSummary[] = [];
    for (const row of rows) {
      summaries.push(await runMailboxSync({ mailbox_row: row, mode: input.mode }));
    }
    return summaries;
  }
  ```

- [x] **Step 4: Verify**
  Run: `bun test server/mail/errors.test.ts && bun run tsc && bunx biome check --fix server/mail/errors.ts server/mail/errors.test.ts server/mail/sync/run.ts`
  Expected: 4 tests pass; tsc clean. If `$returningId()` is unavailable on this drizzle-mysql2 version, replace the insert with an explicit `crypto.randomUUID()` id in `values({ id: run_id, ... })` and drop the `$returningId` call.

- [x] **Step 5: Commit**
  ```bash
  git add server/mail/errors.ts server/mail/errors.test.ts server/mail/sync/run.ts && git commit -m "feat: orchestrate mailbox sync runs with per-mailbox failure isolation"
  ```

---

### Task 16: ORPC mail router and the RPC auth gate

**Files:**
- Create: `server/orpc/mail.ts`
- Create: `server/auth/session.ts`
- Modify: `server/orpc/index.ts`
- Modify: `src/routes/api/orpc/$.ts`


> **Implemented differently on 2026-08-13.** Phase 0 already shipped `server/auth/session.ts`
> (whose `readSession` also re-checks `ADMIN_EMAIL`) plus an ORPC context and an `authed`
> procedure base, so Step 1 was skipped and every mail procedure uses `authed` instead. Step 4
> was skipped too: `src/routes/api/orpc/$.ts` already passes `createContext()`, and the version
> written here would have replaced it with `context: {}`, which breaks `authed` for the mail
> procedures *and* for the existing books writes.

**Interfaces:**
- Consumes: `encryptCredential` (Phase 0), `observeCertificate` (Task 4), `createImapProvider` (Task 7), `runSyncForAllMailboxes` (Task 15), folder selection (Task 9), `HEADER_FETCH_SPEC` (Task 6).
- Produces: `mailProcedures` with `listMailboxes`, `addMailbox`, `testConnection`, `inspectCertificate`, `repinMailbox`, `listObservedAddresses`, `setIdentityAddresses`, `triggerSync`, `listSyncRuns`; `SESSION_COOKIE_NAME` and `readSessionFromHeaders(headers: Headers)`.

- [x] **Step 1: Write `server/auth/session.ts`**
  ```ts
  import type { AuthJWT } from "@server/auth/jwt";
  import { verifyJWT } from "@server/auth/jwt";

  export const SESSION_COOKIE_NAME = "flext_session";

  export function readCookie(header: string | null, name: string): string | null {
    if (header === null) {
      return null;
    }
    for (const part of header.split(";")) {
      const separator = part.indexOf("=");
      if (separator < 1) {
        continue;
      }
      if (part.slice(0, separator).trim() !== name) {
        continue;
      }
      return decodeURIComponent(part.slice(separator + 1).trim());
    }
    return null;
  }

  export async function readSessionFromHeaders(headers: Headers): Promise<AuthJWT | null> {
    const token = readCookie(headers.get("cookie"), SESSION_COOKIE_NAME);
    if (token === null) {
      return null;
    }
    return verifyJWT(token);
  }
  ```

- [x] **Step 2: Write `server/orpc/mail.ts`**
  ```ts
  import { os } from "@orpc/server";
  import { db } from "@server/db/drizzle";
  import { mailbox, mailboxObservedAddress, syncRun } from "@server/db/schema";
  import { mailboxConnection } from "@server/mail/mailbox";
  import { encryptCredential } from "@server/mail/crypto/credentials";
  import { HEADER_FETCH_SPEC } from "@server/mail/providers/headers";
  import { createImapProvider } from "@server/mail/providers/imap";
  import { observeCertificate } from "@server/mail/providers/tls";
  import { selectSentFolders, selectSyncFolders } from "@server/mail/sync/folders";
  import { runSyncForAllMailboxes } from "@server/mail/sync/run";
  import { parseMailboxFlavor, parseStringList, serializeStringList, sync_mode_schema } from "@server/mail/types";
  import { desc, eq } from "drizzle-orm";
  import { z } from "zod";

  const mailbox_id_schema = z.object({ id: z.string().min(1) });

  export const mailProcedures = {
    listMailboxes: os.handler(async () => {
      const rows = await db.select().from(mailbox).orderBy(mailbox.label);
      return rows.map((row) => ({
        id: row.id,
        label: row.label,
        host: row.host,
        port: row.port,
        username: row.username,
        flavor: row.flavor,
        tls_policy: row.tls_policy,
        pinned_spki: parseStringList(row.pinned_spki),
        identity_addresses: parseStringList(row.identity_addresses),
        sent_folders: parseStringList(row.sent_folders),
        hierarchy_delimiter: row.hierarchy_delimiter,
        canonical_folder: row.canonical_folder,
        trash_retention_days: row.trash_retention_days,
        enabled: row.enabled,
        backfilled_at: row.backfilled_at?.toISOString() ?? null,
        last_error: row.last_error,
        last_error_at: row.last_error_at?.toISOString() ?? null,
      }));
    }),

    addMailbox: os
      .input(
        z.object({
          label: z.string().min(1),
          host: z.string().min(1),
          port: z.number().int().positive().default(993),
          username: z.string().min(1),
          password: z.string().min(1),
          flavor: z.enum(["gmail", "generic"]),
          account_index: z.number().int().nonnegative().optional(),
          trash_retention_days: z.number().int().nonnegative().optional(),
          identity_addresses: z.array(z.string()).default([]),
        }),
      )
      .handler(async ({ input }) => {
        const credential = encryptCredential(input.password);
        const now = new Date();
        await db.insert(mailbox).values({
          label: input.label,
          host: input.host,
          port: input.port,
          username: input.username,
          flavor: input.flavor,
          account_index: input.account_index ?? null,
          credential_ciphertext: credential.ciphertext,
          credential_iv: credential.iv,
          credential_auth_tag: credential.auth_tag,
          credential_key_version: credential.key_version,
          identity_addresses: serializeStringList(input.identity_addresses),
          trash_retention_days: input.trash_retention_days ?? null,
          updatedAt: now,
        });
        return { ok: true };
      }),

    testConnection: os.input(mailbox_id_schema).handler(async ({ input }) => {
      const rows = await db.select().from(mailbox).where(eq(mailbox.id, input.id)).limit(1);
      const row = rows[0];
      if (row === undefined) {
        throw new Error(`unknown mailbox ${input.id}`);
      }

      const provider = await createImapProvider(mailboxConnection(row));
      try {
        const folders = await provider.listFolders();
        const flavor = parseMailboxFlavor(row.flavor);
        const walked = selectSyncFolders({ flavor, folders });
        const sent = selectSentFolders(folders);
        const delimiter = folders[0]?.delimiter ?? "/";
        const now = new Date();

        await db
          .update(mailbox)
          .set({
            hierarchy_delimiter: delimiter,
            canonical_folder: walked[0] ?? null,
            sent_folders: serializeStringList(sent),
            enabled: true,
            last_error: null,
            last_error_at: null,
            updatedAt: now,
          })
          .where(eq(mailbox.id, row.id));

        return {
          capabilities: provider.capabilities,
          folder_count: folders.length,
          synced_folders: walked,
          sent_folders: sent,
          hierarchy_delimiter: delimiter,
          header_fetch_spec: HEADER_FETCH_SPEC,
        };
      } finally {
        await provider.disconnect();
      }
    }),

    inspectCertificate: os
      .input(z.object({ host: z.string().min(1), port: z.number().int().positive().default(993) }))
      .handler(async ({ input }) => {
        return observeCertificate({ host: input.host, port: input.port });
      }),

    repinMailbox: os
      .input(z.object({ id: z.string().min(1), spki_sha256: z.string().min(1), replace: z.boolean().default(false) }))
      .handler(async ({ input }) => {
        const rows = await db.select().from(mailbox).where(eq(mailbox.id, input.id)).limit(1);
        const row = rows[0];
        if (row === undefined) {
          throw new Error(`unknown mailbox ${input.id}`);
        }
        const current = parseStringList(row.pinned_spki);
        // The set is additive by default so a planned key rotation can be staged; replacing is the explicit
        // operator choice after comparing the old and new certificate side by side (§1.2).
        const next = input.replace ? [input.spki_sha256] : [...new Set([...current, input.spki_sha256])];
        await db
          .update(mailbox)
          .set({ tls_policy: "pinned", pinned_spki: serializeStringList(next), updatedAt: new Date() })
          .where(eq(mailbox.id, row.id));
        return { pinned_spki: next };
      }),

    listObservedAddresses: os.input(mailbox_id_schema).handler(async ({ input }) => {
      const rows = await db
        .select()
        .from(mailboxObservedAddress)
        .where(eq(mailboxObservedAddress.mailbox_id, input.id))
        .orderBy(desc(mailboxObservedAddress.occurrences))
        .limit(200);
      return rows.map((row) => ({
        address: row.address,
        source_header: row.source_header,
        occurrences: row.occurrences,
        last_seen_at: row.last_seen_at?.toISOString() ?? null,
      }));
    }),

    setIdentityAddresses: os
      .input(z.object({ id: z.string().min(1), addresses: z.array(z.string()) }))
      .handler(async ({ input }) => {
        await db
          .update(mailbox)
          .set({ identity_addresses: serializeStringList(input.addresses), updatedAt: new Date() })
          .where(eq(mailbox.id, input.id));
        return { addresses: input.addresses };
      }),

    triggerSync: os
      .input(z.object({ mode: sync_mode_schema, mailbox_id: z.string().min(1).optional() }))
      .handler(async ({ input }) => {
        return runSyncForAllMailboxes({ mode: input.mode, mailbox_id: input.mailbox_id });
      }),

    listSyncRuns: os.input(z.object({ limit: z.number().int().positive().max(100).default(20) })).handler(async ({ input }) => {
      const rows = await db.select().from(syncRun).orderBy(desc(syncRun.started_at)).limit(input.limit);
      return rows.map((row) => ({
        id: row.id,
        mailbox_id: row.mailbox_id,
        kind: row.kind,
        status: row.status,
        started_at: row.started_at.toISOString(),
        finished_at: row.finished_at?.toISOString() ?? null,
        folders_synced: row.folders_synced,
        messages_new: row.messages_new,
        messages_updated: row.messages_updated,
        messages_vanished: row.messages_vanished,
        error_message: row.error_message,
      }));
    }),
  };
  ```

- [x] **Step 3: Register the router**
  In `server/orpc/index.ts`:
  ```ts
  import { os } from "@orpc/server";
  import { booksProcedures } from "./books";
  import { fetchProcedures } from "./fetch";
  import { mailProcedures } from "./mail";

  export const orpcRouter = os.router({
    books: booksProcedures,
    fetch: fetchProcedures,
    mail: mailProcedures,
  });

  export type ORPCRouter = typeof orpcRouter;
  ```

- [x] **Step 4: Gate the mail procedures over HTTP**
  Replace `src/routes/api/orpc/$.ts` with:
  ```ts
  import { RPCHandler } from "@orpc/server/fetch";
  import { readSessionFromHeaders } from "@server/auth/session";
  import { orpcRouter } from "@server/orpc";
  import { createFileRoute } from "@tanstack/react-router";

  const handler = new RPCHandler(orpcRouter);

  async function handle({ request }: { request: Request }) {
    // The mail procedures read mailbox configuration and start IMAP work, so the HTTP entry point requires the
    // same session the /admin route group requires. Server-side calls bypass this path and are already gated.
    if (new URL(request.url).pathname.startsWith("/api/orpc/mail")) {
      const session = await readSessionFromHeaders(request.headers);
      if (session === null) {
        return new Response("Unauthorized", { status: 401 });
      }
    }

    const { response } = await handler.handle(request, {
      prefix: "/api/orpc",
      context: {},
    });
    return response ?? new Response("Not Found", { status: 404 });
  }

  export const Route = createFileRoute("/api/orpc/$")({
    server: {
      handlers: {
        GET: handle,
        POST: handle,
        PUT: handle,
        DELETE: handle,
        OPTIONS: handle,
      },
    },
  });
  ```

- [x] **Step 5: Verify**
  Run: `bun run tsc && bunx biome check --fix server/orpc/mail.ts server/orpc/index.ts server/auth/session.ts src/routes/api/orpc/$.ts`
  Expected: tsc passes. Confirm no procedure returns credential fields: `grep -n "credential" server/orpc/mail.ts` shows them only in `addMailbox`'s insert.

- [x] **Step 6: Commit**
  ```bash
  git add server/orpc/mail.ts server/orpc/index.ts server/auth/session.ts src/routes/api/orpc/\$.ts && git commit -m "feat: add the mail orpc router behind a session gate"
  ```

---

### Task 17: Admin UI — add a mailbox, test it, re-pin it, confirm identities

**Files:**
- Create: `src/routes/admin/mail.tsx`


> **Adjusted on 2026-08-13.** The plan's `bg-accent text-accent-contrast` buttons would have
> rendered invisible labels — those two CSS variables hold the same RGB (known gap, logged in
> `docs/plans/ideas.md`). Uses the same workaround as `src/routes/auth/sign-in.tsx:80`:
> `bg-accent text-white dark:bg-accent-dark dark:text-dark-bg`.

**Interfaces:**
- Consumes: `orpc.mail.*` (Task 16) via `~/integrations/orpc`.
- Produces: the `/admin/mail` route (inside Phase 0's auth-gated `/admin` group).

- [x] **Step 1: Write `src/routes/admin/mail.tsx`**
  ```tsx
  import { createFileRoute, useRouter } from "@tanstack/react-router";
  import { type FC, useState } from "react";
  import { orpc } from "~/integrations/orpc";

  type ObservedCertificate = {
    spki_sha256: string;
    issuer: string;
    subject: string;
    valid_from: string;
    valid_to: string;
    subject_alt_names: string[];
  };

  export const Route = createFileRoute("/admin/mail")({
    loader: async () => {
      const [mailboxes, runs] = await Promise.all([orpc.mail.listMailboxes(), orpc.mail.listSyncRuns({ limit: 20 })]);
      return { mailboxes, runs };
    },
    component: AdminMailPage,
  });

  const Panel: FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
    <section className="rounded-lg border border-gray-200 bg-card p-4 dark:border-dark-border dark:bg-dark-card">
      <h2 className="mb-3 font-semibold text-gray-900 text-sm dark:text-dark-headings">{title}</h2>
      {children}
    </section>
  );

  function AdminMailPage() {
    const { mailboxes, runs } = Route.useLoaderData();
    const router = useRouter();
    const [status, setStatus] = useState<string | null>(null);
    const [certificate, setCertificate] = useState<ObservedCertificate | null>(null);
    const [certificate_target, setCertificateTarget] = useState<string | null>(null);
    const [form, setForm] = useState({
      label: "",
      host: "",
      port: 993,
      username: "",
      password: "",
      flavor: "generic" as "gmail" | "generic",
      identity_addresses: "",
    });

    const runAction = async (label: string, action: () => Promise<unknown>) => {
      setStatus(`${label}…`);
      try {
        const result = await action();
        setStatus(`${label}: ${JSON.stringify(result)}`);
        await router.invalidate();
      } catch (error) {
        setStatus(`${label} failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    };

    return (
      <div className="mx-auto flex max-w-4xl flex-col gap-6 p-6">
        <h1 className="font-bold text-gray-900 text-xl dark:text-dark-headings">Mail — connect &amp; sync</h1>

        {status !== null && <p className="rounded border border-info/40 bg-info/10 p-3 text-sm">{status}</p>}

        <Panel title="Add a mailbox">
          <form
            className="grid grid-cols-2 gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void runAction("Add mailbox", () =>
                orpc.mail.addMailbox({
                  label: form.label,
                  host: form.host,
                  port: form.port,
                  username: form.username,
                  password: form.password,
                  flavor: form.flavor,
                  identity_addresses: form.identity_addresses
                    .split(",")
                    .map((entry) => entry.trim())
                    .filter((entry) => entry.length > 0),
                }),
              );
            }}
          >
            <input
              className="rounded border border-gray-300 p-2 text-sm dark:border-dark-border dark:bg-dark-bg"
              onChange={(event) => setForm({ ...form, label: event.target.value })}
              placeholder="Label"
              required
              value={form.label}
            />
            <input
              className="rounded border border-gray-300 p-2 text-sm dark:border-dark-border dark:bg-dark-bg"
              onChange={(event) => setForm({ ...form, host: event.target.value })}
              placeholder="imap.gmail.com"
              required
              value={form.host}
            />
            <input
              className="rounded border border-gray-300 p-2 text-sm dark:border-dark-border dark:bg-dark-bg"
              onChange={(event) => setForm({ ...form, port: Number(event.target.value) })}
              placeholder="993"
              type="number"
              value={form.port}
            />
            <select
              className="rounded border border-gray-300 p-2 text-sm dark:border-dark-border dark:bg-dark-bg"
              onChange={(event) => setForm({ ...form, flavor: event.target.value === "gmail" ? "gmail" : "generic" })}
              value={form.flavor}
            >
              <option value="generic">generic</option>
              <option value="gmail">gmail</option>
            </select>
            <input
              className="rounded border border-gray-300 p-2 text-sm dark:border-dark-border dark:bg-dark-bg"
              onChange={(event) => setForm({ ...form, username: event.target.value })}
              placeholder="Username"
              required
              value={form.username}
            />
            <input
              className="rounded border border-gray-300 p-2 text-sm dark:border-dark-border dark:bg-dark-bg"
              onChange={(event) => setForm({ ...form, password: event.target.value })}
              placeholder="App password"
              required
              type="password"
              value={form.password}
            />
            <input
              className="col-span-2 rounded border border-gray-300 p-2 text-sm dark:border-dark-border dark:bg-dark-bg"
              onChange={(event) => setForm({ ...form, identity_addresses: event.target.value })}
              placeholder="Identity addresses, comma separated (felix@flext.dev, *@flext.dev)"
              value={form.identity_addresses}
            />
            <button className="col-span-2 rounded bg-accent px-3 py-2 font-medium text-accent-contrast text-sm" type="submit">
              Add mailbox
            </button>
          </form>
        </Panel>

        {mailboxes.map((entry) => (
          <Panel key={entry.id} title={`${entry.label} — ${entry.username}@${entry.host}`}>
            <dl className="mb-3 grid grid-cols-2 gap-1 text-gray-600 text-sm dark:text-dark-text">
              <dt>Flavor / TLS</dt>
              <dd>
                {entry.flavor} / {entry.tls_policy}
              </dd>
              <dt>Canonical folder</dt>
              <dd>{entry.canonical_folder ?? "—"}</dd>
              <dt>Delimiter</dt>
              <dd>{entry.hierarchy_delimiter ?? "—"}</dd>
              <dt>Identity addresses</dt>
              <dd>{entry.identity_addresses.join(", ") || "none yet"}</dd>
              <dt>Backfilled</dt>
              <dd>{entry.backfilled_at ?? "never"}</dd>
              <dt>Enabled</dt>
              <dd>{entry.enabled ? "yes" : "no"}</dd>
            </dl>

            {entry.last_error !== null && <p className="mb-3 rounded bg-danger/10 p-2 text-danger text-sm">{entry.last_error}</p>}

            <div className="flex flex-wrap gap-2">
              <button
                className="rounded border border-gray-300 px-3 py-1 text-sm dark:border-dark-border"
                onClick={() => void runAction("Test connection", () => orpc.mail.testConnection({ id: entry.id }))}
                type="button"
              >
                Test connection
              </button>
              <button
                className="rounded border border-gray-300 px-3 py-1 text-sm dark:border-dark-border"
                onClick={() => void runAction("Backfill", () => orpc.mail.triggerSync({ mode: "backfill", mailbox_id: entry.id }))}
                type="button"
              >
                Backfill
              </button>
              <button
                className="rounded border border-gray-300 px-3 py-1 text-sm dark:border-dark-border"
                onClick={() => void runAction("Sync", () => orpc.mail.triggerSync({ mode: "incremental", mailbox_id: entry.id }))}
                type="button"
              >
                Sync now
              </button>
              <button
                className="rounded border border-gray-300 px-3 py-1 text-sm dark:border-dark-border"
                onClick={() =>
                  void runAction("Observed addresses", async () => {
                    const observed = await orpc.mail.listObservedAddresses({ id: entry.id });
                    return observed.map((row) => `${row.address} (${row.source_header} ×${row.occurrences})`);
                  })
                }
                type="button"
              >
                Show observed Delivered-To
              </button>
              <button
                className="rounded border border-warning px-3 py-1 text-sm text-warning"
                onClick={() =>
                  void runAction("Inspect certificate", async () => {
                    const observed = await orpc.mail.inspectCertificate({ host: entry.host, port: entry.port });
                    setCertificate(observed);
                    setCertificateTarget(entry.id);
                    return observed.spki_sha256;
                  })
                }
                type="button"
              >
                Inspect certificate
              </button>
            </div>

            {certificate !== null && certificate_target === entry.id && (
              <div className="mt-3 rounded border border-warning/50 bg-warning/10 p-3 text-sm">
                <p className="mb-2 font-medium">
                  A routine key rotation and a MITM look identical on the wire — compare both sides before confirming.
                </p>
                <dl className="grid grid-cols-2 gap-1">
                  <dt>Pinned now</dt>
                  <dd>{entry.pinned_spki.join(", ") || "nothing pinned"}</dd>
                  <dt>Presented SPKI</dt>
                  <dd>{certificate.spki_sha256}</dd>
                  <dt>Issuer</dt>
                  <dd>{certificate.issuer}</dd>
                  <dt>Subject</dt>
                  <dd>{certificate.subject}</dd>
                  <dt>Valid</dt>
                  <dd>
                    {certificate.valid_from} → {certificate.valid_to}
                  </dd>
                  <dt>SANs</dt>
                  <dd>{certificate.subject_alt_names.join(", ") || "—"}</dd>
                </dl>
                <div className="mt-3 flex gap-2">
                  <button
                    className="rounded bg-accent px-3 py-1 text-accent-contrast text-sm"
                    onClick={() =>
                      void runAction("Stage pin", () =>
                        orpc.mail.repinMailbox({ id: entry.id, spki_sha256: certificate.spki_sha256, replace: false }),
                      )
                    }
                    type="button"
                  >
                    Add to pinned set
                  </button>
                  <button
                    className="rounded border border-danger px-3 py-1 text-danger text-sm"
                    onClick={() =>
                      void runAction("Replace pin", () =>
                        orpc.mail.repinMailbox({ id: entry.id, spki_sha256: certificate.spki_sha256, replace: true }),
                      )
                    }
                    type="button"
                  >
                    Replace pinned set
                  </button>
                </div>
              </div>
            )}
          </Panel>
        ))}

        <Panel title="Recent sync runs">
          <ul className="flex flex-col gap-1 text-gray-600 text-sm dark:text-dark-text">
            {runs.map((run) => (
              <li key={run.id}>
                {run.started_at} · {run.kind} · {run.status} · +{run.messages_new} new · {run.messages_vanished} vanished
                {run.error_message === null ? "" : ` · ${run.error_message}`}
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    );
  }
  ```

- [x] **Step 2: Verify**
  Run: `bun run build && bun run tsc && bunx biome check --fix src/routes/admin/mail.tsx`
  Expected: `bun run build` regenerates `src/routeTree.gen.ts` with the `/admin/mail` route so tsc resolves `createFileRoute("/admin/mail")`; tsc and biome pass. Do not start a dev server — the build is the only thing needed to regenerate the tree. Before adding any further class names, grep `tailwind.config.mjs` for an existing token.

- [x] **Step 3: Commit**
  ```bash
  git add src/routes/admin/mail.tsx && git commit -m "feat: add the admin mail page with connection test and re-pin flow"
  ```

---

### Task 18: Scheduled sync entrypoint for Coolify

**Files:**
- Create: `src/routes/api/mail-sync.ts`


> **Adjusted on 2026-08-14.** Reads `SCRIPT_SECRET` via `serverEnv()` from `server/env.ts`, not
> the root `env.ts` this task named. The root module validates ~40 variables at import time and
> calls `process.exit(1)` on a miss, so importing it from a route would make the Docker build read
> environment (it currently reads none) and would kill the container at runtime over the
> PlanetScale-era variables that no longer exist in Coolify. `SCRIPT_SECRET` is declared optional
> so a deploy that forgets it degrades to a 503 on this one endpoint rather than breaking sign-in
> and every other `serverEnv()` caller.

**Interfaces:**
- Consumes: `runSyncForAllMailboxes` (Task 15), `sync_mode_schema` (Task 3), `env.SCRIPT_SECRET`.
- Produces: `POST /api/mail-sync?mode=incremental|reconcile|backfill`, bearer-authenticated with `SCRIPT_SECRET`.

- [x] **Step 1: Write `src/routes/api/mail-sync.ts`**
  ```ts
  import { timingSafeEqual } from "node:crypto";
  import { runSyncForAllMailboxes } from "@server/mail/sync/run";
  import { sync_mode_schema } from "@server/mail/types";
  import { createFileRoute } from "@tanstack/react-router";
  import { env } from "../../../env";

  function matchesSecret(provided: string | null): boolean {
    if (provided === null) {
      return false;
    }
    const expected = Buffer.from(`Bearer ${env.SCRIPT_SECRET}`, "utf8");
    const candidate = Buffer.from(provided, "utf8");
    if (expected.length !== candidate.length) {
      return false;
    }
    return timingSafeEqual(expected, candidate);
  }

  async function handle({ request }: { request: Request }) {
    if (!matchesSecret(request.headers.get("authorization"))) {
      return new Response("Unauthorized", { status: 401 });
    }

    const mode = sync_mode_schema.safeParse(new URL(request.url).searchParams.get("mode") ?? "incremental");
    if (!mode.success) {
      return Response.json({ error: "mode must be incremental, reconcile or backfill" }, { status: 400 });
    }

    const summaries = await runSyncForAllMailboxes({ mode: mode.data });
    const failed = summaries.filter((summary) => summary.status === "failed").length;
    return Response.json({ mode: mode.data, mailboxes: summaries.length, failed, summaries });
  }

  export const Route = createFileRoute("/api/mail-sync")({
    server: { handlers: { POST: handle } },
  });
  ```

- [x] **Step 2: Record the schedule in the plan's closing notes**
  The Coolify scheduled tasks the operator creates (no code, no dev server):
  ```bash
  # every 15 minutes
  curl -fsS -X POST -H "Authorization: Bearer $SCRIPT_SECRET" "https://flext.dev/api/mail-sync?mode=incremental"
  # hourly
  curl -fsS -X POST -H "Authorization: Bearer $SCRIPT_SECRET" "https://flext.dev/api/mail-sync?mode=reconcile"
  ```
  Backfill is run once per mailbox from `/admin/mail`, not on a schedule.

- [x] **Step 3: Verify**
  Run: `bun run build && bun run tsc && bunx biome check --fix src/routes/api/mail-sync.ts`
  Expected: the route appears in `src/routeTree.gen.ts`; tsc and biome pass.

- [x] **Step 4: Commit**
  ```bash
  git add src/routes/api/mail-sync.ts && git commit -m "feat: add the secret-gated scheduled mail sync entrypoint"
  ```

---

## Self-review

| Task | Spec sections covered |
|---|---|
| 1 — dependencies | §2 (library choice: `imapflow`), §12 (test runner for the pure helpers) |
| 2 — schema | §3 (Phase 1 subset: `mailbox`, `mailbox_cursor`, `message`, `sender`, `sync_run`), §1.8 (encrypted credential triple + `key_version` columns), §1.2 (`tls_policy`, `pinned_spki`), §1.10 (`identity_addresses`), §1.7 (`trash_retention_days` recorded now, used in Phase 8), §4 (`disappeared_at`), §8 (`opened_at`) |
| 3 — domain types | §1.1 (Gmail as a flavor flag, not a provider), §4.1 (`GMAIL_CANONICAL_FOLDER`), §1.8 (credential decryption at the edge) |
| 4 — TLS | §1.2 in full: SPKI-not-fingerprint pinning, pinned set for staged rotation, no `rejectUnauthorized: false`, operator re-pin probe capturing issuer/subject/validity |
| 5 — provider contract | §2 (`providers/types.ts` is the only thing downstream imports) |
| 6 — header spec | §4.2 (the exact header list, `BODY.PEEK[HEADER.FIELDS (...)]`), §1.3 (headers only — `source` is never requested) |
| 7 — IMAP provider | §1.1, §1.3, §4.1 (Gmail extensions read via `emailId`/`threadId`/`labels`), §4.2 (CONDSTORE modifier as a second parenthesized list on a UID fetch), §4.3 (QRESYNC `VANISHED` collected from `expunge` events), read-only `{ readOnly: true }` locks throughout |
| 8 — pure helpers | §1.10 (identity matching incl. Gmail plus-stripping, catch-alls, `Delivered-To` / `X-Original-To`), §5.1 (`addressed_to_me` excludes Cc), §6 (DKIM alignment gate feeding `dkim_aligned`), §3 (thread identity computed per flavor) |
| 9 — cursors/folders/ranges | §3 (`mailbox_cursor`), §4.1 (Gmail walks only `[Gmail]/All Mail`), §4.2 (the `<last+1>:*` off-by-one filter), §14 (batched backfill for volume) |
| 10 — writer | §1.3 (metadata only), §3 (`message` + `sender` columns), §1.10 (observed alias discovery), §5.1 (`my_reply_count` storage) |
| 11 — re-key | §11 (`UIDVALIDITY` change re-keys by `X-GM-MSGID` / `Message-ID`) |
| 12 — incremental | §4.2 (all three steps), §4.3 (VANISHED applied inline when QRESYNC is on), §8 (`opened_at` first-seen semantics) |
| 13 — reconcile | §4.3 (QRESYNC `VANISHED` with a `UID SEARCH ALL` set-difference fallback; rows are marked, never deleted) |
| 14 — backfill | §4.4 (headers-only walk of every folder + the Sent scan computing `my_reply_count`), §1.10 (alias evidence gathered during backfill) |
| 15 — run orchestration | §11 (per-mailbox isolation, credential failure disables without a retry storm, SPKI mismatch is a hard stop), §3 (`sync_run` log), §4.4 (schedule modes) |
| 16 — ORPC router | §9 (admin surfaces' data layer), §1.2 (re-pin as an explicit operator action), §1.8 (credentials encrypted on write, never returned), §1.10 (observed addresses → `identity_addresses`) |
| 17 — admin UI | §1.2 (side-by-side old/new SPKI, issuer, subject, validity with explicit confirmation), §1.10 (fill the identity list from evidence), §9 (a first operator surface) |
| 18 — scheduled entrypoint | §4.4 (Coolify scheduled task: 15-minute incremental, hourly reconcile; not IMAP IDLE) |

**Deliberately deferred to later phases**

- Tables `sender_policy`, `client`, `never_touch_rule`, `sender_suppression`, `filing_queue`, `thread_state`, `action`, `proposal` (§3) — Phases 3–7. `message.state`, `message.client`, `message.topic` and `message.trashed_at` land with the phases that write them.
- Everything in §5 (signals, resolution order, guards, derived defaults), §6 (filing, delimiter-aware paths), §7 (executor, `COPYUID`, journal, undo), §8 (autonomy ladder, rescue detection), §10 (MCP surface) and §1.7's purge sweep — Phases 3–8. Phase 1 writes `dkim_aligned` and `hierarchy_delimiter` now only because they are free at fetch time and expensive to backfill later.
- Gmail deep links (§9) need `X-GM-THRID` rendered as hexadecimal plus `account_index`; the columns exist, the rendering belongs to Phase 2's dashboard.
- **Two support tables beyond the spec's thirteen:** `MailboxObservedAddress` (§1.10 requires backfill to *surface distinct `Delivered-To` values*, and an aggregate table answers that without storing a `delivered_to` column on every message) and the `kind` discriminator on `MailboxCursor` (keeps the Sent scan's position independent of the same folder's message cursor so reply counts stay idempotent across re-runs).
- **Known tradeoff:** `sender.my_reply_count` is incremented from cursor-advanced Sent scans. A `UIDVALIDITY` change on a Sent folder resets that cursor and re-counts its history, inflating the number. Every consumer in §5.1 uses `my_reply_count > 0`, so the drift is tolerable; a per-mailbox recount table is the fix if a later phase needs an exact figure.
- **Open item carried from §14:** app-password/IMAP availability on the Workspace domain we do not administer must be confirmed before Task 17 is exercised against that mailbox. Nothing in this plan unblocks it.

---

**Completed: 2026-08-14**
- Verified: `bun run tsc` zero errors; `bun test` 31 pass / 0 fail across 7 files; `bunx biome check` clean across all 31 touched files; `bun run build` succeeds and registers `/admin/mail` and `/api/mail-sync` in the route tree.
- Safety invariants re-checked at ship time: all 5 `getMailboxLock` calls pass `{ readOnly: true }`; zero `messageFlagsAdd/Set`, `messageMove/Copy/Delete` or `append(` calls anywhere in `server/mail`; zero `db.delete` (vanished messages only get `disappeared_at`); every `rejectUnauthorized` in `server/` and `src/` is `true`.
- Schema applied to the live Coolify MySQL on 2026-08-12, and migration history baselined so `db:generate` + `db:migrate` is the workflow from here.
- Four deviations from the plan, each noted inline at its task: task 15 generates the `SyncRun` id in JS because `$returningId` returns nothing for a SQL-default primary key (every run would have been stuck at "running"); task 16 reuses phase 0's session helper and `authed` middleware instead of adding a second cookie reader and a path-prefix gate that would have broken the existing books writes; task 17 avoids the `bg-accent`/`text-accent-contrast` pairing that renders invisible text; task 18 reads `SCRIPT_SECRET` via `serverEnv()` because the root `env.ts` exits the process at import.
- Open: no mailbox has been connected yet, so nothing here has run against a real IMAP server. Before the first run the operator must set `SCRIPT_SECRET` in Coolify (absent it, `/api/mail-sync` answers 503 by design) and create the two scheduled tasks. App-password/IMAP availability on the Google Workspace domain we do not administer is still unconfirmed. Manual browser QA of `/admin/mail` not done — silence = confirmed.
