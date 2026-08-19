import { db } from "@server/db/drizzle";
import { action, message } from "@server/db/schema";
import type {
  ActionJournal,
  AppliedEntry,
  DeferredEntry,
  FailedEntry,
  FromStateEntry,
  PendingActionRow,
} from "@server/mail/actions/executor";
import { APPLIED_STATUS, DEFERRED_STATUS, FAILED_STATUS, PENDING_STATUS } from "@server/mail/actions/executor";
import { isExecutableActionKind } from "@server/mail/actions/kinds";
import { and, asc, eq, isNull } from "drizzle-orm";

// The only drizzle-backed implementation of the executor's journal port, kept out of executor.ts so a test
// importing the executor cannot reach a real connection: every DATABASE_URL variant points at the same
// production MySQL.

async function loadPendingActions(input: { mailbox_id: string; batch_size: number }): Promise<PendingActionRow[]> {
  if (input.mailbox_id.length === 0) {
    throw new Error("loadPendingActions needs a mailbox id: an unscoped sweep would execute pending actions across every mailbox at once.");
  }
  if (!Number.isInteger(input.batch_size) || input.batch_size < 1) {
    throw new Error(
      `loadPendingActions needs a positive batch size, got ${input.batch_size}. The caller bounds how much mail one run may mutate.`,
    );
  }

  const rows = await db
    .select({
      action_id: action.id,
      message_id: action.message_id,
      kind: action.kind,
      run_id: action.run_id,
      folder: message.folder,
      uid: message.uid,
    })
    .from(action)
    .innerJoin(message, eq(message.id, action.message_id))
    .where(and(eq(action.status, PENDING_STATUS), eq(action.mailbox_id, input.mailbox_id), isNull(message.disappeared_at)))
    .orderBy(asc(action.decided_at), asc(action.id))
    .limit(input.batch_size);

  // `kind` is a varchar, so the narrowing happens here rather than in a cast. A pending row carrying
  // keep_inbox or needs_action would be a Task 8 promotion bug — planFor throws on both — and dropping it
  // leaves it pending and visible rather than turning it into a mutation.
  return rows.flatMap((row) =>
    isExecutableActionKind(row.kind)
      ? [{ action_id: row.action_id, message_id: row.message_id, kind: row.kind, run_id: row.run_id, folder: row.folder, uid: row.uid }]
      : [],
  );
}

// One statement per row: to_state_json and error differ per row, so a single UPDATE would need a CASE
// expression over the batch for no gain at these sizes (the caller bounds the batch). Sequential rather
// than concurrent so a failure part-way leaves a prefix written rather than an arbitrary subset.
async function recordFromState(entries: FromStateEntry[]): Promise<void> {
  for (const entry of entries) {
    const now = new Date();
    await db
      .update(action)
      .set({ status: PENDING_STATUS, from_state_json: entry.from_state_json, updatedAt: now })
      .where(eq(action.id, entry.action_id));
  }
}

async function markApplied(entries: AppliedEntry[]): Promise<void> {
  for (const entry of entries) {
    const now = new Date();
    // `error` is cleared because a retry that succeeds must not leave the previous run's failure standing
    // next to an applied status.
    await db
      .update(action)
      .set({ status: APPLIED_STATUS, to_state_json: entry.to_state_json, applied_at: now, error: null, updatedAt: now })
      .where(eq(action.id, entry.action_id));
  }
}

async function markFailed(entries: FailedEntry[]): Promise<void> {
  for (const entry of entries) {
    const now = new Date();
    // from_state_json is deliberately left untouched: it is what a retry or an undo works from, and a
    // failed row that has already been mutated server-side is exactly the case it exists for.
    await db.update(action).set({ status: FAILED_STATUS, error: entry.error, updatedAt: now }).where(eq(action.id, entry.action_id));
  }
}

async function markDeferred(entries: DeferredEntry[]): Promise<void> {
  for (const entry of entries) {
    const now = new Date();
    // A status of its own, not "failed": nothing went wrong, the action simply has no executable plan in
    // this phase (Ruling 4). It parks the row out of the pending set instead of re-examining it every run.
    // The reason rides in `error` because it is the row's only free-text column.
    await db.update(action).set({ status: DEFERRED_STATUS, error: entry.reason, updatedAt: now }).where(eq(action.id, entry.action_id));
  }
}

export function createDatabaseJournal(): ActionJournal {
  return { loadPendingActions, recordFromState, markApplied, markFailed, markDeferred };
}
