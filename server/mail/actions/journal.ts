import { db } from "@server/db/drizzle";
import { action, message } from "@server/db/schema";
import type {
  ActionJournal,
  ActionUndoLookup,
  AppliedEntry,
  DeferredEntry,
  FailedEntry,
  FromStateEntry,
  PendingActionRow,
  UndoableActionRow,
  UndoFailureEntry,
  UndoneEntry,
} from "@server/mail/actions/executor";
import { APPLIED_STATUS, DEFERRED_STATUS, FAILED_STATUS, PENDING_STATUS } from "@server/mail/actions/executor";
import { isExecutableActionKind } from "@server/mail/actions/kinds";
import { UNDONE_STATUS } from "@server/mail/actions/undo";
import { and, asc, desc, eq, isNull, or } from "drizzle-orm";

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
//
// FIRST WRITE WINS, and the rule lives in the WHERE clause rather than in the caller so no code path can
// bypass it. A crash between the mutation and the status update is the case §7.1 exists for: the row stays
// pending holding the correct PRE-state, and the next run selects it again and re-captures — a POST-mutation
// state. On Gmail that capture succeeds, because removing \Inbox leaves the UID stable, so an unconditional
// write would replace the pre-state with the post-state; inverseOf would then filter every label it was
// meant to restore against the set that no longer holds it, return no mutations, and undo would report a
// clean reversal that did nothing to a permanently archived message. Re-issuing the mutation is the safe
// half of the retry: removing an absent \Inbox changes nothing, and a move whose source UID is gone fails.
//
// An empty string counts as no recorded state and may be overwritten, matching parseActionState, so a row
// cannot be stuck forever with a snapshot nothing can read.
async function recordFromState(entries: FromStateEntry[]): Promise<void> {
  for (const entry of entries) {
    const now = new Date();
    await db
      .update(action)
      .set({ status: PENDING_STATUS, from_state_json: entry.from_state_json, updatedAt: now })
      .where(and(eq(action.id, entry.action_id), or(isNull(action.from_state_json), eq(action.from_state_json, ""))));
  }
}

async function markApplied(entries: AppliedEntry[]): Promise<void> {
  for (const entry of entries) {
    const now = new Date();
    // `error` is cleared because a row promoted again after an earlier failure must not carry that failure
    // standing next to an applied status.
    await db
      .update(action)
      .set({ status: APPLIED_STATUS, to_state_json: entry.to_state_json, applied_at: now, error: null, updatedAt: now })
      .where(eq(action.id, entry.action_id));
  }
}

async function markFailed(entries: FailedEntry[]): Promise<void> {
  for (const entry of entries) {
    const now = new Date();
    // from_state_json is deliberately left untouched, and nothing rewrites it later: a failed row is never
    // re-selected (loadPendingActions takes only pending ones) and never undone (undo refuses any status
    // but applied), so this snapshot is the sole record of where the message was before a mutation that
    // may have half-landed — which is what §7.1's reconciliation compares against real server state.
    await db.update(action).set({ status: FAILED_STATUS, error: entry.error, updatedAt: now }).where(eq(action.id, entry.action_id));
  }
}

async function markDeferred(entries: DeferredEntry[]): Promise<void> {
  for (const entry of entries) {
    const now = new Date();
    // A status of its own, not "failed": nothing went wrong, the action simply has no executable plan in
    // this phase (Ruling 4). It parks the row out of the pending set instead of re-examining it every run.
    // The reason rides in `error` because it is the row's only free-text column, which is a trap for any
    // surface that reads a non-null `error` as a failure: §9's journal and the admin views must render
    // `deferred` as its own outcome, or a deliberate deferral reads as a broken action.
    await db.update(action).set({ status: DEFERRED_STATUS, error: entry.reason, updatedAt: now }).where(eq(action.id, entry.action_id));
  }
}

type UndoableRowShape = {
  action_id: string;
  message_id: string;
  kind: string;
  from_state_json: string | null;
  to_state_json: string | null;
  applied_at: Date | null;
};

const undoable_columns = {
  action_id: action.id,
  message_id: action.message_id,
  kind: action.kind,
  from_state_json: action.from_state_json,
  to_state_json: action.to_state_json,
  applied_at: action.applied_at,
};

// `kind` is a varchar and `applied_at` is nullable, so both narrow here rather than in a cast. A row with
// no applied_at cannot be ordered against its siblings, and newest-first replay is the correctness
// property of a bulk undo — so it is withheld rather than replayed in an unknown position. Withholding
// leaves the row visible and `applied`; the operator sees it in §9's journal either way.
function toUndoableRow(row: UndoableRowShape): UndoableActionRow[] {
  if (!isExecutableActionKind(row.kind) || row.applied_at === null) {
    return [];
  }
  return [
    {
      action_id: row.action_id,
      message_id: row.message_id,
      kind: row.kind,
      from_state_json: row.from_state_json,
      to_state_json: row.to_state_json,
      applied_at: row.applied_at,
    },
  ];
}

// Deliberately unfiltered beyond the primary key: undo classifies status, mailbox and addressability
// itself so it can say WHY a row cannot be reversed. Filtering here would collapse "no such action",
// "another mailbox's action", "already undone" and "never applied" into one null. Read-only, one row by
// primary key, and undo refuses to act on anything outside the caller's mailbox.
async function loadActionForUndo(input: { action_id: string }): Promise<ActionUndoLookup | null> {
  if (input.action_id.length === 0) {
    throw new Error("loadActionForUndo needs an action id.");
  }

  const rows = await db
    .select({
      action_id: action.id,
      message_id: action.message_id,
      mailbox_id: action.mailbox_id,
      status: action.status,
      kind: action.kind,
      from_state_json: action.from_state_json,
      to_state_json: action.to_state_json,
      applied_at: action.applied_at,
    })
    .from(action)
    .where(eq(action.id, input.action_id))
    .limit(1);

  return rows[0] ?? null;
}

// §7.3's bulk-undo-by-rule: every action a policy ever took, newest-first. The ORDER BY is what makes
// `limit` take the NEWEST batch_size rows rather than an arbitrary slice — undo re-sorts what it is given,
// so this ordering decides which rows are in the batch, not the order they are replayed in.
async function loadUndoableActionsByPolicy(input: {
  mailbox_id: string;
  sender_policy_id: string;
  batch_size: number;
}): Promise<UndoableActionRow[]> {
  if (input.mailbox_id.length === 0 || input.sender_policy_id.length === 0) {
    throw new Error(
      "loadUndoableActionsByPolicy needs both a mailbox id and a policy id: an unscoped undo would reverse unrelated actions.",
    );
  }
  if (!Number.isInteger(input.batch_size) || input.batch_size < 1) {
    throw new Error(
      `loadUndoableActionsByPolicy needs a positive batch size, got ${input.batch_size}. The caller bounds how much mail one run may mutate.`,
    );
  }

  const rows = await db
    .select(undoable_columns)
    .from(action)
    .where(
      and(eq(action.status, APPLIED_STATUS), eq(action.mailbox_id, input.mailbox_id), eq(action.sender_policy_id, input.sender_policy_id)),
    )
    .orderBy(desc(action.applied_at), desc(action.id))
    .limit(input.batch_size);

  return rows.flatMap(toUndoableRow);
}

// `status` is NOT touched. A reversal that did not land leaves the action applied, because that is what is
// still true of the message; stamping it `failed` would make §9's journal report a broken action next to a
// message sitting exactly where that action put it, and would lock the row out of every loader above so
// the retry could never reach it. The reason rides in `error`, alongside markDeferred's — which is why any
// surface reading a non-null `error` as a failure is wrong for both.
//
// `to_state_json` is rewritten only when the sequence got part of the way: the message is then at an
// address the old value does not name, and a retry starting from a dead address could only fail again.
// The status guard keeps this from touching a row some other run has already advanced.
async function recordUndoFailure(entries: UndoFailureEntry[]): Promise<void> {
  for (const entry of entries) {
    const now = new Date();
    const fields =
      entry.to_state_json === undefined
        ? { error: entry.error, updatedAt: now }
        : { error: entry.error, to_state_json: entry.to_state_json, updatedAt: now };
    await db
      .update(action)
      .set(fields)
      .where(and(eq(action.id, entry.action_id), eq(action.status, APPLIED_STATUS)));
  }
}

// An UPDATE, never a DELETE: §9's journal is the trust surface, and a row that vanished is worse than one
// that was reversed. from_state_json and to_state_json are left standing so the reversal stays auditable.
async function markUndone(entries: UndoneEntry[]): Promise<void> {
  for (const entry of entries) {
    const now = new Date();
    await db.update(action).set({ status: UNDONE_STATUS, error: null, updatedAt: now }).where(eq(action.id, entry.action_id));
  }
}

export function createDatabaseJournal(): ActionJournal {
  return {
    loadPendingActions,
    recordFromState,
    markApplied,
    markFailed,
    markDeferred,
    loadActionForUndo,
    loadUndoableActionsByPolicy,
    markUndone,
    recordUndoFailure,
  };
}
