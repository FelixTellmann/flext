import { ORPCError } from "@orpc/server";
import { db } from "@server/db/drizzle";
import { mailbox, mailboxObservedAddress, syncRun } from "@server/db/schema";
import { executeActions } from "@server/mail/actions/executor";
import { createDatabaseJournal } from "@server/mail/actions/journal";
import { promoteAction, promotePolicyActions } from "@server/mail/actions/promote";
import type { UndoResult } from "@server/mail/actions/undo";
import { undoAction, undoPolicyActions } from "@server/mail/actions/undo";
import { POLICY_ACTIONS } from "@server/mail/classify/rules";
import { encryptCredential } from "@server/mail/crypto/credentials";
import { classifyMailboxError } from "@server/mail/errors";
import { CLIENT_SEGMENT_RULE } from "@server/mail/filing/paths";
import type { MailboxRow } from "@server/mail/mailbox";
import { mailboxConnection } from "@server/mail/mailbox";
import { HEADER_FETCH_SPEC } from "@server/mail/providers/headers";
import { createImapProvider } from "@server/mail/providers/imap";
import { observeCertificate } from "@server/mail/providers/tls";
import type { MailboxProvider } from "@server/mail/providers/types";
import { ACTION_JOURNAL_STATUS_FILTERS, listActionJournal } from "@server/mail/query/actions";
import { listNeedsAction } from "@server/mail/query/needs-action";
import {
  deleteNeverTouchRule,
  deletePolicy,
  listNeverTouchRules,
  listPolicies,
  upsertNeverTouchRule,
  upsertPolicy,
} from "@server/mail/query/policies";
import { getDashboardSummary, getSenderProfile, listSenders } from "@server/mail/query/senders";
import { getShadowReport, getShadowSummary } from "@server/mail/query/shadow";
import { dismissThread, markThreadDone, snoozeThread } from "@server/mail/query/threads";
import { runShadowPass } from "@server/mail/shadow/run";
import { selectSentFolders, selectSyncFolders } from "@server/mail/sync/folders";
import { runSyncForAllMailboxes } from "@server/mail/sync/run";
import type { MailboxFlavor } from "@server/mail/types";
import { parseMailboxFlavor, parseStringList, serializeStringList, sync_mode_schema } from "@server/mail/types";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { authed } from "./base";

const mailbox_id_schema = z.object({ id: z.string().min(1) });

const thread_target_schema = z.object({
  mailbox_id: z.string().min(1).max(191),
  thread_key: z.string().min(1).max(512),
});

// §8: every policy is born in shadow; nothing may promote to "auto" until Phase 4 gives the executor
// something to promote into. upsertPolicy in the query layer already rejects it, but rejecting it here
// too means the caller sees a clear message instead of that layer's opaque throw.
const policy_autonomy_schema = z
  .enum(["shadow", "auto"])
  .default("shadow")
  .refine((value): value is "shadow" => value === "shadow", {
    message: 'policy autonomy must be "shadow" in this phase — auto has no executor yet (§8)',
  });

// Phase 4's mutating procedures are bounded on both axes: an explicit mailbox, and a batch size that can
// never exceed this. Four mailboxes hold ~14,700 messages and the shadow pass journals a decision for
// almost every one of them, so an unbounded call would be a mailbox-wide sweep started by one click.
const MAX_ACTION_BATCH_SIZE = 200;

// A mutation must not run against a mailbox whose connection is not trusted: `enabled` is cleared by
// classifyMailboxError's disable_mailbox path after an auth failure or an SPKI change, and the sync
// runner skips those mailboxes for the same reason (§11). One definition, because the refusal reaches the
// operator two different ways — thrown when a mailbox is named, reported as an entry when undoByPolicy
// sweeps every mailbox — and the two must not drift into saying different things.
function disabledMailboxMessage(label: string): string {
  return `mailbox ${label} is disabled after a connection failure, so nothing was sent to it; re-test its connection before applying or undoing anything.`;
}

// ORPCError, not Error: RPCHandler turns any other throw into a bare INTERNAL_SERVER_ERROR, which would
// replace this guidance with a blank server error on the very screen written to explain it.
async function requireEnabledMailbox(mailbox_id: string): Promise<MailboxRow> {
  const rows = await db.select().from(mailbox).where(eq(mailbox.id, mailbox_id)).limit(1);
  const row = rows[0];
  if (row === undefined) {
    throw new ORPCError("NOT_FOUND", { message: `unknown mailbox ${mailbox_id}` });
  }
  if (!row.enabled) {
    throw new ORPCError("FORBIDDEN", { message: disabledMailboxMessage(row.label) });
  }
  return row;
}

async function withMailboxProvider<T>(
  row: MailboxRow,
  run: (input: { provider: MailboxProvider; flavor: MailboxFlavor }) => Promise<T>,
): Promise<T> {
  const provider = await createImapProvider(mailboxConnection(row));
  try {
    return await run({ provider, flavor: parseMailboxFlavor(row.flavor) });
  } finally {
    await provider.disconnect();
  }
}

// `skipped` is carried per mailbox and in the totals because it has no other record anywhere: a row a
// newer action on the same message blocked is left completely untouched — still `applied`, no `error` —
// so the journal shows nothing at all, and this counter is the only way the operator learns that part of
// the reversal did not happen.
type UndoByPolicyMailboxSummary = UndoResult & { mailbox_id: string; label: string; error: string | null };

function sumUndoResults(summaries: UndoByPolicyMailboxSummary[]): UndoResult {
  return summaries.reduce<UndoResult>(
    (totals, summary) => ({
      examined: totals.examined + summary.examined,
      undone: totals.undone + summary.undone,
      failed: totals.failed + summary.failed,
      skipped: totals.skipped + summary.skipped,
    }),
    { examined: 0, undone: 0, failed: 0, skipped: 0 },
  );
}

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
      throw new ORPCError("NOT_FOUND", { message: `unknown mailbox ${input.id}` });
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
        throw new ORPCError("NOT_FOUND", { message: `unknown mailbox ${input.id}` });
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

  listPolicies: authed
    .input(
      z.object({
        scope: z.enum(["address", "domain", "all"]).default("all"),
        suspended: z.enum(["all", "active", "suspended"]).default("all"),
        search: z.string().nullable().default(null),
      }),
    )
    .handler(async ({ input }) => listPolicies({ scope: input.scope, suspended: input.suspended, search: input.search })),

  upsertPolicy: authed
    .input(
      z.object({
        scope: z.enum(["address", "domain"]),
        value: z.string().min(1).max(320),
        // POLICY_ACTIONS is the same allowlist rules.ts and the query layer enforce — imported rather than
        // retyped, so "purge" (the irreversible sweep action reserved for the separate Phase 8 job) has
        // exactly one place it could ever be added back.
        action: z.enum(POLICY_ACTIONS),
        client: z.string().max(191).refine(CLIENT_SEGMENT_RULE.test, { message: CLIENT_SEGMENT_RULE.message }).nullable().default(null),
        topic: z.string().max(191).nullable().default(null),
        autonomy: policy_autonomy_schema,
        source: z.string().min(1).max(191),
        suspended_at: z.date().nullable().default(null),
        suspension_reason: z.string().nullable().default(null),
      }),
    )
    .handler(async ({ input }) => upsertPolicy(input)),

  deletePolicy: authed.input(mailbox_id_schema).handler(async ({ input }) => deletePolicy(input.id)),

  listNeverTouchRules: authed.handler(async () => listNeverTouchRules()),

  upsertNeverTouchRule: authed
    .input(
      z.object({
        id: z.string().min(1).optional(),
        kind: z.enum(["address", "domain", "subject_pattern"]),
        value: z.string().min(1).max(512),
        note: z.string().nullable().default(null),
      }),
    )
    .handler(async ({ input }) => upsertNeverTouchRule(input)),

  deleteNeverTouchRule: authed.input(mailbox_id_schema).handler(async ({ input }) => deleteNeverTouchRule(input.id)),

  snoozeThread: authed.input(thread_target_schema.extend({ until: z.date() })).handler(async ({ input }) => snoozeThread(input)),

  markThreadDone: authed.input(thread_target_schema).handler(async ({ input }) => markThreadDone(input)),

  dismissThread: authed
    .input(
      thread_target_schema.extend({
        sender_address: z.string().max(320).nullable().default(null),
        reason: z.string().min(1),
      }),
    )
    .handler(async ({ input }) => dismissThread(input)),

  getShadowReport: authed.input(z.object({ policy_id: z.string().min(1) })).handler(async ({ input }) => getShadowReport(input)),

  getShadowSummary: authed.handler(async () => getShadowSummary()),

  runShadowPass: authed
    .input(
      z.object({
        mailbox_id: z.string().min(1),
        batch_size: z.number().int().positive().max(1000).default(500),
        run_id: z.string().min(1).nullable().default(null),
      }),
    )
    .handler(async ({ input }) => runShadowPass(input)),

  // Ruling 3: there is no "approve everything". A caller must name either one action or one policy, and a
  // mailbox in both cases — the scope is part of the input's shape, not a convention a caller can drop.
  // Nothing here opens a connection: promotion only moves an Action row from "shadow" to "pending", and
  // the mailbox it will execute against comes from applyPending, deliberately, as a second decision.
  approveDecision: authed
    .input(
      z.discriminatedUnion("scope", [
        z.object({ scope: z.literal("action"), mailbox_id: z.string().min(1), action_id: z.string().min(1) }),
        z.object({
          scope: z.literal("policy"),
          mailbox_id: z.string().min(1),
          sender_policy_id: z.string().min(1),
          batch_size: z.number().int().positive().max(MAX_ACTION_BATCH_SIZE).default(50),
        }),
      ]),
    )
    .handler(async ({ input }) => {
      const journal = createDatabaseJournal();

      if (input.scope === "action") {
        // The discriminated result reaches the caller intact: "no such action", "another mailbox's
        // action" and "not a shadow row" each carry an operator-facing `detail`, and collapsing them into
        // a boolean would leave the review screen unable to say why the click did nothing.
        const result = await promoteAction({ action_id: input.action_id, mailbox_id: input.mailbox_id, journal });
        return { scope: "action" as const, ...result };
      }

      const result = await promotePolicyActions({
        sender_policy_id: input.sender_policy_id,
        mailbox_id: input.mailbox_id,
        batch_size: input.batch_size,
        journal,
      });
      return { scope: "policy" as const, ...result };
    }),

  // The first procedure in this codebase that changes a real mailbox. One mailbox, one bounded batch,
  // named explicitly — a stray call cannot reach the other three.
  applyPending: authed
    .input(
      z.object({
        mailbox_id: z.string().min(1),
        batch_size: z.number().int().positive().max(MAX_ACTION_BATCH_SIZE).default(25),
      }),
    )
    .handler(async ({ input }) => {
      const row = await requireEnabledMailbox(input.mailbox_id);
      const result = await withMailboxProvider(row, ({ provider, flavor }) =>
        executeActions({
          mailbox_id: row.id,
          flavor,
          provider,
          journal: createDatabaseJournal(),
          batch_size: input.batch_size,
        }),
      );
      return { mailbox_id: row.id, label: row.label, ...result };
    }),

  undoAction: authed.input(z.object({ action_id: z.string().min(1), mailbox_id: z.string().min(1) })).handler(async ({ input }) => {
    const row = await requireEnabledMailbox(input.mailbox_id);
    return withMailboxProvider(row, ({ provider, flavor }) =>
      undoAction({ action_id: input.action_id, mailbox_id: row.id, flavor, provider, journal: createDatabaseJournal() }),
    );
  }),

  undoByPolicy: authed
    .input(
      z.object({
        sender_policy_id: z.string().min(1),
        // Null reverses the policy across every enabled mailbox, one connection at a time. A policy is
        // not mailbox-scoped but undoPolicyActions is, so the loop below is the only correct shape:
        // handing one mailbox's provider the rows of another would address those UIDs on the wrong
        // server. The batch size bounds each mailbox separately, which is what keeps the sweep bounded.
        mailbox_id: z.string().nullable().default(null),
        batch_size: z.number().int().positive().max(MAX_ACTION_BATCH_SIZE).default(50),
      }),
    )
    .handler(async ({ input }) => {
      // Every mailbox, not only the enabled ones: a disabled mailbox is REPORTED below rather than
      // filtered out here. Silently omitting it returns a result covering three of four mailboxes with
      // nothing saying so, which reads as a reversal that covered everything.
      const rows =
        input.mailbox_id === null
          ? await db.select().from(mailbox).orderBy(mailbox.label)
          : [await requireEnabledMailbox(input.mailbox_id)];

      const journal = createDatabaseJournal();
      const mailboxes: UndoByPolicyMailboxSummary[] = [];

      for (const row of rows) {
        if (!row.enabled) {
          mailboxes.push({
            mailbox_id: row.id,
            label: row.label,
            examined: 0,
            undone: 0,
            failed: 0,
            skipped: 0,
            error: disabledMailboxMessage(row.label),
          });
          continue;
        }

        try {
          const result = await withMailboxProvider(row, ({ provider, flavor }) =>
            undoPolicyActions({
              sender_policy_id: input.sender_policy_id,
              mailbox_id: row.id,
              flavor,
              provider,
              journal,
              batch_size: input.batch_size,
            }),
          );
          mailboxes.push({ mailbox_id: row.id, label: row.label, ...result, error: null });
        } catch (error) {
          // Per-mailbox isolation, matching runMailboxSync: a dead connection or an expired app password
          // fails this mailbox's reversal and leaves the others reversible (§11).
          const failure = classifyMailboxError(error);
          mailboxes.push({
            mailbox_id: row.id,
            label: row.label,
            examined: 0,
            undone: 0,
            failed: 0,
            skipped: 0,
            error: `${failure.kind}: ${failure.message}`,
          });
        }
      }

      return { mailboxes, totals: sumUndoResults(mailboxes) };
    }),

  listActionJournal: authed
    .input(
      z.object({
        mailbox_id: z.string().nullable().default(null),
        sender_policy_id: z.string().nullable().default(null),
        sender_address: z.string().nullable().default(null),
        status: z.enum(ACTION_JOURNAL_STATUS_FILTERS).default("all"),
        since: z.date().nullable().default(null),
        until: z.date().nullable().default(null),
        limit: z.number().int().positive().max(200).default(50),
        offset: z.number().int().min(0).default(0),
      }),
    )
    .handler(async ({ input }) =>
      listActionJournal({
        mailbox_id: input.mailbox_id,
        sender_policy_id: input.sender_policy_id,
        sender_address: input.sender_address,
        status: input.status,
        since: input.since,
        until: input.until,
        limit: input.limit,
        offset: input.offset,
      }),
    ),
};
