import { db } from "@server/db/drizzle";
import { mailbox, mailboxObservedAddress, syncRun } from "@server/db/schema";
import { encryptCredential } from "@server/mail/crypto/credentials";
import { mailboxConnection } from "@server/mail/mailbox";
import { HEADER_FETCH_SPEC } from "@server/mail/providers/headers";
import { createImapProvider } from "@server/mail/providers/imap";
import { observeCertificate } from "@server/mail/providers/tls";
import { listNeedsAction } from "@server/mail/query/needs-action";
import { getDashboardSummary, getSenderProfile, listSenders } from "@server/mail/query/senders";
import { selectSentFolders, selectSyncFolders } from "@server/mail/sync/folders";
import { runSyncForAllMailboxes } from "@server/mail/sync/run";
import { parseMailboxFlavor, parseStringList, serializeStringList, sync_mode_schema } from "@server/mail/types";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { authed } from "./base";

const mailbox_id_schema = z.object({ id: z.string().min(1) });

// Every procedure here is `authed`: they read mailbox configuration and start IMAP work, so none of them
// may answer an anonymous caller. The middleware in ./base also covers server-side callers, which a
// path-prefix check in the HTTP handler would not.
export const mailProcedures = {
  listMailboxes: authed.handler(async () => {
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

  addMailbox: authed
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

  testConnection: authed.input(mailbox_id_schema).handler(async ({ input }) => {
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

  inspectCertificate: authed
    .input(z.object({ host: z.string().min(1), port: z.number().int().positive().default(993) }))
    .handler(async ({ input }) => {
      return observeCertificate({ host: input.host, port: input.port });
    }),

  repinMailbox: authed
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

  listObservedAddresses: authed.input(mailbox_id_schema).handler(async ({ input }) => {
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

  setIdentityAddresses: authed.input(z.object({ id: z.string().min(1), addresses: z.array(z.string()) })).handler(async ({ input }) => {
    await db
      .update(mailbox)
      .set({ identity_addresses: serializeStringList(input.addresses), updatedAt: new Date() })
      .where(eq(mailbox.id, input.id));
    return { addresses: input.addresses };
  }),

  triggerSync: authed.input(z.object({ mode: sync_mode_schema, mailbox_id: z.string().min(1).optional() })).handler(async ({ input }) => {
    return runSyncForAllMailboxes({ mode: input.mode, mailbox_id: input.mailbox_id });
  }),

  listSyncRuns: authed.input(z.object({ limit: z.number().int().positive().max(100).default(20) })).handler(async ({ input }) => {
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

  listSenders: authed
    .input(
      z.object({
        search: z.string().nullable().default(null),
        replied: z.enum(["all", "never", "replied"]).default("all"),
        bulk: z.enum(["all", "bulk", "direct"]).default("all"),
        mailbox_id: z.string().nullable().default(null),
        min_messages: z.number().int().min(0).max(10_000).default(0),
        sort: z.enum(["messages", "replies", "last_seen", "address"]).default("messages"),
        direction: z.enum(["asc", "desc"]).default("desc"),
        limit: z.number().int().positive().max(200).default(50),
        offset: z.number().int().min(0).default(0),
      }),
    )
    .handler(async ({ input }) =>
      listSenders({
        filter: {
          search: input.search,
          replied: input.replied,
          bulk: input.bulk,
          mailbox_id: input.mailbox_id,
          min_messages: input.min_messages,
        },
        sort: input.sort,
        direction: input.direction,
        limit: input.limit,
        offset: input.offset,
      }),
    ),

  getSenderProfile: authed.input(z.object({ address: z.string().min(1) })).handler(async ({ input }) => getSenderProfile(input.address)),

  listNeedsAction: authed
    .input(
      z.object({
        mailbox_id: z.string().nullable().default(null),
        max_age_days: z.number().int().positive().nullable().default(30),
        limit: z.number().int().positive().max(200).default(50),
        offset: z.number().int().min(0).default(0),
      }),
    )
    .handler(async ({ input }) =>
      listNeedsAction({
        mailbox_id: input.mailbox_id,
        max_age_days: input.max_age_days,
        limit: input.limit,
        offset: input.offset,
      }),
    ),

  getDashboardSummary: authed.handler(async () => getDashboardSummary()),
};
