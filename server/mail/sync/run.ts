import { db } from "@server/db/drizzle";
import { mailbox, syncRun } from "@server/db/schema";
import { createDatabaseAutonomyPort, promoteAutoPolicies } from "@server/mail/actions/autonomy";
import type { ActionJournal, ExecuteActionsInput, ExecuteActionsResult } from "@server/mail/actions/executor";
import { executeActions } from "@server/mail/actions/executor";
import { createDatabaseJournal } from "@server/mail/actions/journal";
import { createDatabaseAttentionPort, recordAttention } from "@server/mail/attention/record";
import type { MailboxFailureKind } from "@server/mail/errors";
import { classifyMailboxError, nextMailboxStateAfterFailure, readMailboxFailureKind } from "@server/mail/errors";
import type { MailboxRow } from "@server/mail/mailbox";
import { mailboxConnection } from "@server/mail/mailbox";
import { createImapProvider } from "@server/mail/providers/imap";
import type { MailboxProvider } from "@server/mail/providers/types";
import { SCHEDULED_RUN_ID } from "@server/mail/query/shadow";
import type { RescuePort } from "@server/mail/rescue/detect";
import { detectRescues } from "@server/mail/rescue/detect";
import { createDatabaseRescuePort } from "@server/mail/rescue/journal";
import type { RunShadowPassInput, RunShadowPassResult } from "@server/mail/shadow/run";
import { runDeclinedSweepPass, runNewMailShadowPass, runSettledSweepPass } from "@server/mail/shadow/run";
import { backfillMailbox, scanSentFolder } from "@server/mail/sync/backfill";
import { selectSentFolders, selectSyncFolders } from "@server/mail/sync/folders";
import { syncFolderIncrementally } from "@server/mail/sync/incremental";
import { reclassifyMailbox } from "@server/mail/sync/reclassify";
import { reconcileFolder } from "@server/mail/sync/reconcile";
import { repairSenderLinks } from "@server/mail/sync/repair";
import type { MailboxFlavor, SyncMode } from "@server/mail/types";
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
  // The triage evidence this run witnessed, persisted on SyncRun so later runs can pool it. Non-zero only
  // for an incremental run — the other modes never observe a transition.
  seen_transitions: number;
  flag_changes: number;
  replies_sent: number;
  note: string | null;
};

function emptyTotals(folders: number): RunTotals {
  return { folders, new_messages: 0, flag_updates: 0, vanished: 0, seen_transitions: 0, flag_changes: 0, replies_sent: 0, note: null };
}

// Matches BACKFILL_BATCH_SIZE: the reclassify walks the same UID space with the same per-batch fetch.
const RECLASSIFY_BATCH_SIZE = 100;

// The ORPC rescue paths let an operator hand in a batch size; a scheduled sync has nobody to ask, so this
// picks one. This is a CHUNK size, not a cap on total work: detectRescues loops with a keyset cursor until
// the RESCUE_WINDOW_DAYS = 30-day candidate window (server/mail/rescue/journal.ts) is exhausted, reading
// this many rows per round trip. A single batch-apply of ~7,900 actions costs ~4 chunks — a few queries,
// nothing that needs tuning down for cost or up for coverage the way an actual cap would.
const RESCUE_BATCH_SIZE = 2000;

// Exported so a test can drive it with a fake RescuePort instead of the real drizzle-backed one — see
// server/mail/sync/run.test.ts. Detection is a safety net, not a precondition for delivering mail: a
// throw here becomes a note on the run summary rather than a failed sync, following the same
// `${kind}: ${message}` shape runMailboxSync's catch block already uses via classifyMailboxError.
export async function runRescuePassForMailbox(input: { port: RescuePort; mailbox_id: string; batch_size: number }): Promise<string | null> {
  try {
    const result = await detectRescues({ port: input.port, mailbox_id: input.mailbox_id, batch_size: input.batch_size });
    if (result.rescued === 0) {
      return null;
    }
    return `rescue: examined ${result.examined}, rescued ${result.rescued}, suspended ${result.suspended}, unresolved ${result.unresolved}`;
  } catch (error) {
    const failure = classifyMailboxError(error);
    return `rescue detection failed: ${failure.kind}: ${failure.message}`;
  }
}

// The ORPC path lets the operator pick a shadow batch; a scheduled sync has nobody to ask, so this picks
// the same 500 the ORPC procedure defaults to and tmp/run-shadow.ts uses. Like RESCUE_BATCH_SIZE and
// unlike EXECUTOR_BATCH_SIZE below, this is a CHUNK size and not a cap: runShadowPass walks the mailbox's
// live messages with a keyset cursor until they are exhausted, reading this many rows per round trip, so
// every message is classified on every pass regardless of what this is set to.
const SHADOW_BATCH_SIZE = 500;

// The scheduled sync's executor batch — and unlike the two chunk sizes above, this one IS a cap on the
// work a single run does. executeActions issues ONE loadPendingActions query, executes those rows and
// returns; it does not loop until the queue drains. So a run that finds more than this many pending rows
// leaves the remainder for the next run, and a queue that grows faster than the schedule drains it is
// never fully executed. That is the intended trade rather than a limitation to remove: the incremental
// sync is on */15 (docs/runbooks/2026-08-17-mail-sync-schedules.txt), which drains 4 * EXECUTOR_BATCH_SIZE
// rows an hour, whereas an unbounded batch would let one unattended run fire an arbitrary number of IMAP
// mutations at a live mailbox with no ceiling on the blast radius of a mistaken promotion. 200 is the
// ORPC path's operator-facing maximum (MAX_ACTION_BATCH_SIZE) rather than its default of 25, because
// nobody is here to press the button a second time.
const EXECUTOR_BATCH_SIZE = 200;

export type ClassifyAndExecuteInput = {
  mailbox_id: string;
  flavor: MailboxFlavor;
  // Mailbox.hierarchyDelimiter, the same value applyPending hands the executor.
  hierarchy_delimiter: string;
  provider: MailboxProvider;
  journal: ActionJournal;
  // SCHEDULED_RUN_ID on the scheduled path, never a fresh UUID: see the constant's own note in
  // server/mail/query/shadow.ts for why the report must not be able to select it.
  run_id: string;
  // All three injected rather than called through their module imports so server/mail/sync/run.test.ts can
  // drive this pipeline over fakes. The shadow pass and the drizzle-backed journal both open the
  // production database on import, and executeActions is the one function here that can mutate a real
  // mailbox.
  shadowPass: (input: RunShadowPassInput) => Promise<RunShadowPassResult>;
  promoteAutoActions: (input: AutoPromotionInput) => Promise<string[]>;
  executePendingActions: (input: ExecuteActionsInput) => Promise<ExecuteActionsResult>;
};

export type AutoPromotionInput = { mailbox_id: string; run_id: string };

// THE RETURN TYPE IS THE SAFETY CONTRACT, not an implementation detail. `pending` is also the status
// operator approval produces, so an executor that loaded the whole pending set would apply, on a
// fifteen-minute timer, decisions the operator approved intending to review them before pressing Apply.
// Running against this id list and nothing else is what makes the invariant hold: A ROW THE OPERATOR
// APPROVED BY HAND CAN NEVER BE EXECUTED BY THE SCHEDULED SYNC — only rows this run promoted itself.
//
// Do not widen this to "everything pending for the mailbox", and do not let the executor re-derive the
// set by joining to the policy's autonomy: a row's autonomy at execution time is not necessarily what
// promoted it, and an id list is precise where a join is a guess.
//
// A thin wrapper around promoteAutoPolicies, wiring the real database-backed port and journal. The
// promotion logic itself — including the suspension guard — lives in server/mail/actions/autonomy.ts,
// where it can be exercised over fakes instead of the production database. `run_id` rides on
// AutoPromotionInput for symmetry with the rest of this pipeline's per-mailbox inputs; promotion has no
// use for it, since eligibility is a property of the policy and the shadow rows, not of which sync run is
// asking.
export async function promoteAutoActions(input: AutoPromotionInput): Promise<string[]> {
  return promoteAutoPolicies({
    mailbox_id: input.mailbox_id,
    batch_size: EXECUTOR_BATCH_SIZE,
    port: createDatabaseAutonomyPort(),
    journal: createDatabaseJournal(),
  });
}

// Classification and execution, unattended. Until this existed both halves ran only when the operator
// clicked a button in /admin; §8's `auto` promises that an auto policy "executes on the next sync run",
// and this is the only thing that keeps that promise.
//
// Failures on either half become a note on the run summary, never a thrown error: fetching mail is the
// sync's job, and a classifier or an executor that breaks must not cost the operator their mail. Same
// reasoning and the same `${kind}: ${message}` shape as runRescuePassForMailbox above.
// Inbox-dwell 1.9's stage 6. Journaled at `shadow` only — this stage decides, it never promotes and never
// executes, so nothing it produces can move mail until the operator promotes it from /admin/shadow.
//
// A suspended mailbox is skipped entirely rather than run and discarded: 1.11 suspends the sweep because
// acting on this mailbox already went wrong, and continuing to write proposals into the journal after that
// buries the evidence under exactly the rows the operator is trying to look at.
async function runSettledSweepForMailbox(input: {
  mailbox_row: MailboxRow;
  run_id: string;
  sweepPass: typeof runSettledSweepPass;
}): Promise<string | null> {
  if (input.mailbox_row.dwell_suspended_at !== null) {
    return `settled sweep: skipped, suspended (${input.mailbox_row.dwell_suspension_reason ?? "no reason recorded"})`;
  }

  try {
    const sweep = await input.sweepPass({
      mailbox_id: input.mailbox_row.id,
      batch_size: SHADOW_BATCH_SIZE,
      run_id: input.run_id,
      dwell_days: input.mailbox_row.dwell_settled_days,
      replied_dwell_days: input.mailbox_row.dwell_replied_days,
      now: new Date(),
    });
    if (sweep.examined === 0) {
      return null;
    }
    return `settled sweep: examined ${sweep.examined}, journaled ${sweep.journaled}`;
  } catch (error) {
    const failure = classifyMailboxError(error);
    return `settled sweep failed: ${failure.kind}: ${failure.message}`;
  }
}

// Inbox-dwell 1.9's unread half. Journals at `shadow` only, and skips a suspended mailbox entirely for
// the same reason the settled sweep does.
async function runDeclinedSweepForMailbox(input: {
  mailbox_row: MailboxRow;
  run_id: string;
  sweepPass: typeof runDeclinedSweepPass;
}): Promise<string | null> {
  if (input.mailbox_row.dwell_suspended_at !== null) {
    return null;
  }

  try {
    const sweep = await input.sweepPass({
      mailbox_id: input.mailbox_row.id,
      batch_size: SHADOW_BATCH_SIZE,
      run_id: input.run_id,
      ordinary_threshold: input.mailbox_row.dwell_decline_count,
      needs_action_threshold: input.mailbox_row.dwell_needs_action_decline_count,
      now: new Date(),
    });
    if (sweep.examined === 0) {
      return null;
    }
    return `declined sweep: examined ${sweep.examined}, journaled ${sweep.journaled}`;
  } catch (error) {
    const failure = classifyMailboxError(error);
    return `declined sweep failed: ${failure.kind}: ${failure.message}`;
  }
}

export async function runClassifyAndExecutePassForMailbox(input: ClassifyAndExecuteInput): Promise<string | null> {
  const notes: string[] = [];

  try {
    // runNewMailShadowPass, NOT runShadowPass: the scheduled path classifies only messages that have never
    // been classified, so its cost is bounded by how much mail arrived rather than by how much the
    // mailbox holds. The full re-sweep stays the operator's, from /admin/shadow.
    const shadow = await input.shadowPass({ mailbox_id: input.mailbox_id, batch_size: SHADOW_BATCH_SIZE, run_id: input.run_id });
    notes.push(`shadow: examined ${shadow.examined}, journaled ${shadow.journaled}`);
  } catch (error) {
    const failure = classifyMailboxError(error);
    notes.push(`shadow pass failed: ${failure.kind}: ${failure.message}`);
  }

  // Promotion and execution share one try/catch on purpose: the ids are the executor's entire input, so a
  // promotion that threw has nothing to hand it and there is no second attempt worth making this run.
  try {
    const promoted_action_ids = await input.promoteAutoActions({ mailbox_id: input.mailbox_id, run_id: input.run_id });

    // An early return rather than an executor call with an empty filter. This is the state every run is
    // in until a policy is promoted to `auto`, and the state a run returns to whenever no auto policy has
    // new shadow rows: nothing was promoted, so there is nothing to execute and the provider is not
    // touched at all. Calling the executor here instead would put the operator's approved backlog one
    // wrong predicate away from being applied by a timer.
    if (promoted_action_ids.length === 0) {
      return notes.length === 0 ? null : notes.join("; ");
    }

    const executed = await input.executePendingActions({
      mailbox_id: input.mailbox_id,
      flavor: input.flavor,
      provider: input.provider,
      journal: input.journal,
      batch_size: EXECUTOR_BATCH_SIZE,
      hierarchy_delimiter: input.hierarchy_delimiter,
      // Exactly the rows this run promoted. Anything the operator approved by hand is `pending` too and
      // must be left for them to apply deliberately.
      action_ids: promoted_action_ids,
    });
    notes.push(
      `execute: promoted ${promoted_action_ids.length}, examined ${executed.examined}, applied ${executed.applied}, failed ${executed.failed}, deferred ${executed.deferred}`,
    );
  } catch (error) {
    const failure = classifyMailboxError(error);
    notes.push(`execution failed: ${failure.kind}: ${failure.message}`);
  }

  return notes.length === 0 ? null : notes.join("; ");
}

async function runMode(input: { provider: MailboxProvider; mailbox_row: MailboxRow; mode: SyncMode }): Promise<RunTotals> {
  if (input.mode === "backfill") {
    const result = await backfillMailbox({ provider: input.provider, mailbox_row: input.mailbox_row });
    return { ...emptyTotals(result.folders), new_messages: result.messages };
  }
  if (input.mode === "repair") {
    throw new Error("repair is database-wide and must not run per mailbox; call repairSenderLinks directly");
  }

  const folders = await input.provider.listFolders();
  const walked = selectSyncFolders({ flavor: parseMailboxFlavor(input.mailbox_row.flavor), folders });
  const totals = emptyTotals(walked.length);

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
    totals.seen_transitions += result.seen_transitions;
    totals.flag_changes += result.flag_changes;
  }

  // Inbox-dwell 1.3/1.4. Immediately after the fetch, while the transitions this run witnessed are the
  // freshest thing known, and before rescue detection — which stamps rows and would otherwise be
  // indistinguishable from the operator's own activity on the next pass.
  //
  // Transitions, never the raw flag_updates count above: that one includes every message CONDSTORE
  // re-reported after a bulk apply, and feeding it here would let the sweeps manufacture the very
  // sessions that advance their clock.
  //
  // This run's evidence is judged together with what the other mailboxes' runs of the last two hours
  // witnessed (recordAttention pools SyncRun rows); this run's own row is still at zero at this point,
  // so it contributes nothing to that pool and is not counted twice.
  const attention = await recordAttention({
    port: createDatabaseAttentionPort(),
    evidence: {
      observed_at: new Date(),
      mailbox_id: input.mailbox_row.id,
      seen_transitions: totals.seen_transitions,
      flag_changes: totals.flag_changes,
      // Nothing counts replies yet: scanSentFolder reports scanned entries and touched senders, not messages
      // the operator authored this run. Zero rather than a guess, because a reply is sufficient evidence
      // on its own and an invented one would open a session off no evidence at all. SyncRun.repliesSent
      // exists so the count can be written without a migration once the scan produces it.
      replies_sent: 0,
    },
  });

  // Rescue detection runs here: after the incremental fetch above has observed this run's `\Seen`
  // transitions (openedAt is only fresh once that happens), and before anything else new is added to this
  // mode. It must not run any earlier — a pass before the fetch reads stale rows and silently
  // under-reports, which for a safety net is worse than an error.
  const notes = [
    attention.kind === "ignored" ? null : `attention: ${attention.kind}, ${attention.detail}`,
    await runRescuePassForMailbox({
      port: createDatabaseRescuePort(),
      mailbox_id: input.mailbox_row.id,
      batch_size: RESCUE_BATCH_SIZE,
    }),
  ];

  for (const folder of selectSentFolders(folders)) {
    await scanSentFolder({ provider: input.provider, mailbox_row: input.mailbox_row, folder });
  }

  // Classification and execution close the incremental pipeline, and only the incremental one: backfill,
  // reclassify and reconcile all return above. They run last rather than beside the rescue pass because
  // the shadow pass decides on stored rows — this run's new messages and this run's sent-folder scan are
  // both already written by the time it reads, so a message that arrives and is replied to between two
  // syncs is classified with the reply visible instead of a pass late.
  notes.push(
    await runClassifyAndExecutePassForMailbox({
      mailbox_id: input.mailbox_row.id,
      flavor: parseMailboxFlavor(input.mailbox_row.flavor),
      // Empty means this mailbox was never synced, and renderFolderPath is where that must surface — the
      // same value and the same reasoning as the applyPending procedure's.
      hierarchy_delimiter: input.mailbox_row.hierarchy_delimiter ?? "",
      provider: input.provider,
      journal: createDatabaseJournal(),
      // Every scheduled classification shares this one constant id — see server/mail/query/shadow.ts.
      run_id: SCHEDULED_RUN_ID,
      shadowPass: runNewMailShadowPass,
      promoteAutoActions,
      executePendingActions: executeActions,
    }),
  );

  // Stage 6, last and deliberately after classify-and-execute: the sweep decides on stored rows, and this
  // run's new messages, flag transitions and executed actions are all already written by the time it
  // reads. Its scoping is the inverse of the classify pass's (shadow/run.ts's SettledSweepScope), so the
  // two cannot fight over the same rows.
  notes.push(
    await runSettledSweepForMailbox({
      mailbox_row: input.mailbox_row,
      run_id: SCHEDULED_RUN_ID,
      sweepPass: runSettledSweepPass,
    }),
  );

  // Stage 7. After the settled sweep, and after this run recorded its own attention session near the top
  // of this function — the exposure count reads that log, so running earlier would judge every unread
  // message one session short of the truth.
  notes.push(
    await runDeclinedSweepForMailbox({
      mailbox_row: input.mailbox_row,
      run_id: SCHEDULED_RUN_ID,
      sweepPass: runDeclinedSweepPass,
    }),
  );

  const reported = notes.filter((note): note is string => note !== null);
  totals.note = reported.length === 0 ? null : reported.join("; ");
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
        seen_transitions: totals.seen_transitions,
        flag_changes: totals.flag_changes,
        replies_sent: totals.replies_sent,
        // The stage notes are persisted, not merely returned: rescue detection, the shadow pass and the
        // promote/execute pair each swallow their own failure into a note so a broken safety net cannot
        // cost the operator their mail. Returning that note only to the scheduled task's stdout would
        // make an unmigrated column or a tripped MAX_CHUNK_ITERATIONS fail silently on every run forever,
        // with the run still reporting `ok`. Here it lands in the sync-run list where it can be seen.
        note: totals.note,
        updatedAt: finished_at,
      })
      .where(eq(syncRun.id, run_id));

    await db
      .update(mailbox)
      .set({
        last_error: null,
        last_error_at: null,
        // Any mode that got this far logged in, which is all the counter measures.
        auth_failure_count: 0,
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
      note: totals.note,
    };
  } catch (error) {
    // Per-mailbox isolation: a dead connection, an expired app password or an SPKI change fails this
    // mailbox's run and leaves the other five untouched (§11).
    const next = nextMailboxStateAfterFailure({
      failure: classifyMailboxError(error),
      auth_failure_count: input.mailbox_row.auth_failure_count,
    });
    const finished_at = new Date();

    await db
      .update(syncRun)
      .set({ status: "failed", finished_at, error_message: next.last_error, updatedAt: finished_at })
      .where(eq(syncRun.id, run_id));

    await db
      .update(mailbox)
      .set({
        last_error: next.last_error,
        last_error_at: finished_at,
        auth_failure_count: next.auth_failure_count,
        ...(next.enabled ? {} : { enabled: false }),
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
      error: next.last_error,
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
    const note = result.remaining > 0 ? `${result.remaining} message row(s) still have no matching Sender` : null;
    await db
      .update(syncRun)
      .set({ status: "ok", finished_at, messages_updated: result.updated, note, updatedAt: finished_at })
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
      note,
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

export type MailboxNeedingOperator = { label: string; host: string; reason: MailboxFailureKind | null; error: string | null };

// Mailboxes the sync can no longer reach and will not recover on its own. Both kinds that disable a
// mailbox land here — a rotated certificate needs the operator to look at it and re-pin, a password
// refused on three consecutive runs needs a new credential — and neither resolves by waiting.
export async function listMailboxesNeedingOperator(): Promise<MailboxNeedingOperator[]> {
  const rows = await db
    .select({ label: mailbox.label, host: mailbox.host, last_error: mailbox.last_error })
    .from(mailbox)
    .where(eq(mailbox.enabled, false));

  return rows.map((row) => ({
    label: row.label,
    host: row.host,
    reason: readMailboxFailureKind(row.last_error),
    error: row.last_error,
  }));
}
