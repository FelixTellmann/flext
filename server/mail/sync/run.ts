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
import { reclassifyMailbox } from "@server/mail/sync/reclassify";
import { reconcileFolder } from "@server/mail/sync/reconcile";
import { repairSenderLinks } from "@server/mail/sync/repair";
import type { SyncMode } from "@server/mail/types";
import { DATABASE_WIDE_RUN_MAILBOX_ID, parseMailboxFlavor } from "@server/mail/types";
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
  // Non-failure detail a successful run wants to report. `error` stays reserved for status: "failed", so
  // a consumer can keep treating a non-null error as a failed run.
  note: string | null;
};

type RunTotals = {
  folders: number;
  new_messages: number;
  flag_updates: number;
  vanished: number;
};

// Matches BACKFILL_BATCH_SIZE: the reclassify walks the same UID space with the same per-batch fetch.
const RECLASSIFY_BATCH_SIZE = 100;

async function runMode(input: { provider: MailboxProvider; mailbox_row: MailboxRow; mode: SyncMode }): Promise<RunTotals> {
  if (input.mode === "backfill") {
    const result = await backfillMailbox({ provider: input.provider, mailbox_row: input.mailbox_row });
    return { folders: result.folders, new_messages: result.messages, flag_updates: 0, vanished: 0 };
  }
  if (input.mode === "repair") {
    throw new Error("repair is database-wide and must not run per mailbox; call repairSenderLinks directly");
  }

  const folders = await input.provider.listFolders();
  const walked = selectSyncFolders({ flavor: parseMailboxFlavor(input.mailbox_row.flavor), folders });
  const totals: RunTotals = { folders: walked.length, new_messages: 0, flag_updates: 0, vanished: 0 };

  if (input.mode === "reclassify") {
    const result = await reclassifyMailbox({
      provider: input.provider,
      mailbox_row: input.mailbox_row,
      batch_size: RECLASSIFY_BATCH_SIZE,
    });
    // SyncRun has no column for the examined count, and `changed` is the number the operator judges the
    // pass by: how many derived columns the corrected identity list and the fixed DKIM parser moved.
    totals.flag_updates = result.changed;
    return totals;
  }

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
  // The id defaults to UUID() server-side, and drizzle's $returningId only reports ids it generated
  // itself — an autoincrement column or a JS defaultFn (mysql2/session.js:61-71). It returns an empty
  // array for a SQL default, which would leave every run row stuck at "running". Generating the id here
  // keeps the finishing update addressable.
  const run_id = crypto.randomUUID();
  await db.insert(syncRun).values({
    id: run_id,
    mailbox_id: input.mailbox_row.id,
    kind: input.mode,
    status: "running",
    started_at,
    updatedAt: started_at,
  });

  let provider: MailboxProvider | null = null;
  try {
    provider = await createImapProvider(mailboxConnection(input.mailbox_row));
    const totals = await runMode({ provider, mailbox_row: input.mailbox_row, mode: input.mode });
    const finished_at = new Date();

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
      note: null,
    };
  } catch (error) {
    // Per-mailbox isolation: a dead connection, an expired app password or an SPKI change fails this
    // mailbox's run and leaves the other five untouched (§11).
    const failure = classifyMailboxError(error);
    const finished_at = new Date();

    await db
      .update(syncRun)
      .set({ status: "failed", finished_at, error_message: `${failure.kind}: ${failure.message}`, updatedAt: finished_at })
      .where(eq(syncRun.id, run_id));

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
      note: null,
    };
  } finally {
    if (provider !== null) {
      await provider.disconnect();
    }
  }
}

const REPAIR_BATCH_SIZE = 500;

// repair touches Message/Sender only and never opens a mailbox, so it must not run once per row in
// `rows` below (that would repeat the same database-wide UPDATE loop N times for N mailboxes). It is
// lifted above the per-mailbox loop entirely and logged under DATABASE_WIDE_RUN_MAILBOX_ID rather than
// a real mailbox id: SyncRun.mailboxId is notNull but has no FK, and attaching the row to an arbitrary
// real mailbox would misattribute a database-wide run into that mailbox's history.
async function runRepairOnce(): Promise<MailboxRunSummary> {
  const started_at = new Date();
  const run_id = crypto.randomUUID();
  await db.insert(syncRun).values({
    id: run_id,
    mailbox_id: DATABASE_WIDE_RUN_MAILBOX_ID,
    kind: "repair",
    status: "running",
    started_at,
    updatedAt: started_at,
  });

  try {
    const result = await repairSenderLinks({ batch_size: REPAIR_BATCH_SIZE });
    const finished_at = new Date();
    await db
      .update(syncRun)
      .set({ status: "ok", finished_at, messages_updated: result.updated, updatedAt: finished_at })
      .where(eq(syncRun.id, run_id));

    return {
      mailbox_id: DATABASE_WIDE_RUN_MAILBOX_ID,
      label: "repair",
      kind: "repair",
      status: "ok",
      folders: 0,
      new_messages: 0,
      flag_updates: result.updated,
      vanished: 0,
      error: null,
      note: result.remaining > 0 ? `${result.remaining} message row(s) still have no matching Sender` : null,
    };
  } catch (error) {
    const failure = classifyMailboxError(error);
    const finished_at = new Date();
    await db
      .update(syncRun)
      .set({ status: "failed", finished_at, error_message: `${failure.kind}: ${failure.message}`, updatedAt: finished_at })
      .where(eq(syncRun.id, run_id));

    return {
      mailbox_id: DATABASE_WIDE_RUN_MAILBOX_ID,
      label: "repair",
      kind: "repair",
      status: "failed",
      folders: 0,
      new_messages: 0,
      flag_updates: 0,
      vanished: 0,
      error: `${failure.kind}: ${failure.message}`,
      note: null,
    };
  }
}

export async function runSyncForAllMailboxes(input: { mode: SyncMode; mailbox_id?: string }): Promise<MailboxRunSummary[]> {
  if (input.mode === "repair") {
    return [await runRepairOnce()];
  }

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
