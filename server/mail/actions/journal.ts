import { db } from "@server/db/drizzle";
import { action, message, senderPolicy } from "@server/db/schema";
import type {
  ActionJournal,
  ActionPromotionLookup,
  ActionUndoLookup,
  AppliedEntry,
  DeferredEntry,
  FailedEntry,
  FilingResolutionEntry,
  FromStateEntry,
  PendingActionRow,
  PromotedEntry,
  UndoableActionRow,
  UndoFailureEntry,
  UndoneEntry,
} from "@server/mail/actions/executor";
import { APPLIED_STATUS, DEFERRED_STATUS, FAILED_STATUS, PENDING_STATUS } from "@server/mail/actions/executor";
import { FILE_KIND, isExecutableActionKind } from "@server/mail/actions/kinds";
import { SHADOW_STATUS } from "@server/mail/actions/promote";
import { UNDONE_STATUS } from "@server/mail/actions/undo";
import type { PolicyScope } from "@server/mail/classify/rules";
import { loadFilingBindings } from "@server/mail/filing/bindings";
import { and, asc, desc, eq, isNull, or } from "drizzle-orm";

// The only drizzle-backed implementation of the executor's journal port, kept out of executor.ts so a test
// importing the executor cannot reach a real connection: every DATABASE_URL variant points at the same
// production MySQL.

// SenderPolicy.scope is a varchar, so it narrows here rather than in a cast, and loadPendingActions' left
// join makes it null for a row whose policy is gone. Anything else is null too: rules.ts matches a policy only
// on "address" or "domain", so a policy carrying any other scope never fired and cannot be behind a
// `file` row — and §6's gate reads null as "no policy chose this path".
function toPolicyScope(raw: string | null): PolicyScope | null {
  return raw === "address" || raw === "domain" ? raw : null;
}

async function loadPendingActions(input: { mailbox_id: string; batch_size: number }): Promise<PendingActionRow[]> {
  if (input.mailbox_id.length === 0) {
    throw new Error("loadPendingActions needs a mailbox id: an unscoped sweep would execute pending actions across every mailbox at once.");
  }
  if (!Number.isInteger(input.batch_size) || input.batch_size < 1) {
    throw new Error(
      `loadPendingActions needs a positive batch size, got ${input.batch_size}. The caller bounds how much mail one run may mutate.`,
    );
  }

  // A LEFT join to SenderPolicy, not an inner one: a row whose policy was deleted must still load and
  // still be reportable, and an inner join would silently drop it out of the pending set instead. The
  // existing join to Message already supplies dkim_aligned.
  const rows = await db
    .select({
      action_id: action.id,
      message_id: action.message_id,
      kind: action.kind,
      run_id: action.run_id,
      folder: message.folder,
      uid: message.uid,
      target_path: action.target_path,
      policy_scope: senderPolicy.scope,
      dkim_aligned: message.dkim_aligned,
      filing_confirmed_at: action.filing_confirmed_at,
    })
    .from(action)
    .innerJoin(message, eq(message.id, action.message_id))
    .leftJoin(senderPolicy, eq(senderPolicy.id, action.sender_policy_id))
    .where(and(eq(action.status, PENDING_STATUS), eq(action.mailbox_id, input.mailbox_id), isNull(message.disappeared_at)))
    .orderBy(asc(action.decided_at), asc(action.id))
    .limit(input.batch_size);

  // `kind` is a varchar, so the narrowing happens here rather than in a cast. A pending row carrying
  // keep_inbox or needs_action would be a Task 8 promotion bug — planFor throws on both — and dropping it
  // leaves it pending and visible rather than turning it into a mutation.
  return rows.flatMap((row) =>
    isExecutableActionKind(row.kind)
      ? [
          {
            action_id: row.action_id,
            message_id: row.message_id,
            kind: row.kind,
            run_id: row.run_id,
            folder: row.folder,
            uid: row.uid,
            target_path: row.target_path,
            policy_scope: toPolicyScope(row.policy_scope),
            dkim_aligned: row.dkim_aligned,
            filing_confirmed_at: row.filing_confirmed_at,
          },
        ]
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
  target_path: string | null;
};

const undoable_columns = {
  action_id: action.id,
  message_id: action.message_id,
  kind: action.kind,
  from_state_json: action.from_state_json,
  to_state_json: action.to_state_json,
  applied_at: action.applied_at,
  // Undo re-resolves this to a folder rather than reading the destination out of to_state_json, so
  // there is one definition of where a logical path lives on this server.
  target_path: action.target_path,
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
      target_path: row.target_path,
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
      target_path: action.target_path,
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

// Deliberately unfiltered beyond the primary key, matching loadActionForUndo: promote.ts classifies status
// and mailbox itself so it can tell the operator WHY a row was refused instead of collapsing "no such
// action", "another mailbox's action" and "not a shadow row" into one null.
async function loadActionForPromotion(input: { action_id: string }): Promise<ActionPromotionLookup | null> {
  if (input.action_id.length === 0) {
    throw new Error("loadActionForPromotion needs an action id.");
  }

  const rows = await db
    .select({ action_id: action.id, mailbox_id: action.mailbox_id, status: action.status })
    .from(action)
    .where(eq(action.id, input.action_id))
    .limit(1);

  return rows[0] ?? null;
}

// Scoped to one mailbox and one policy, matching loadUndoableActionsByPolicy: an unscoped read here is
// exactly what would let a stray call promote every shadow decision in the mailbox, or across mailboxes.
async function loadShadowActionsByPolicy(input: {
  mailbox_id: string;
  sender_policy_id: string;
  batch_size: number;
}): Promise<ActionPromotionLookup[]> {
  if (input.mailbox_id.length === 0 || input.sender_policy_id.length === 0) {
    throw new Error(
      "loadShadowActionsByPolicy needs both a mailbox id and a policy id: an unscoped promote would approve every shadow decision in this mailbox.",
    );
  }
  if (!Number.isInteger(input.batch_size) || input.batch_size < 1) {
    throw new Error(
      `loadShadowActionsByPolicy needs a positive batch size, got ${input.batch_size}. The caller bounds how many decisions one approval may promote.`,
    );
  }

  const rows = await db
    .select({ action_id: action.id, mailbox_id: action.mailbox_id, status: action.status })
    .from(action)
    .where(
      and(eq(action.status, SHADOW_STATUS), eq(action.mailbox_id, input.mailbox_id), eq(action.sender_policy_id, input.sender_policy_id)),
    )
    .orderBy(asc(action.decided_at), asc(action.id))
    .limit(input.batch_size);

  return rows;
}

// Writes status "pending" and NOTHING else. The `WHERE status = 'shadow'` guard is the enforcement point
// for Ruling 1: no row this statement touches can have been "applied" (or undone, deferred, or already
// pending) a moment before, because any of those fails the guard and the row is left exactly as it was.
async function promoteShadowActions(entries: PromotedEntry[]): Promise<void> {
  for (const entry of entries) {
    const now = new Date();
    await db
      .update(action)
      .set({ status: PENDING_STATUS, updatedAt: now })
      .where(and(eq(action.id, entry.action_id), eq(action.status, SHADOW_STATUS)));
  }
}

// Moves one queued filing row back to `pending` with the operator-confirmed destination. Guarded on BOTH
// `status = 'deferred'` and `kind = FILE_KIND` in the WHERE clause, not in the caller: the status half is
// FIRST WRITE WINS against a row some other run has already advanced, and the kind half is what stops this
// from ever un-deferring an `auto_trash` row — §1.7 keeps destruction behind a policy a human created.
//
// `error: null` clears the queue reason: it explained why the row could not proceed, and status.ts reads a
// non-null `error` on a `pending` row as an explanation that is no longer true once resolution runs.
//
// `filingConfirmedAt` is what stops the row coming straight back. The executor re-runs §6's gate over
// every pending `file` row, and the policy scope and DKIM state it reads are unchanged by resolution — so
// without a record that a HUMAN chose this destination the gate fires again and re-queues the row, with
// the operator seeing a green "resolved" banner each time. filingDecisionFor reads this column and skips
// the DKIM branch on it.
async function resolveFilingActions(entries: FilingResolutionEntry[]): Promise<void> {
  for (const entry of entries) {
    const now = new Date();
    await db
      .update(action)
      .set({ status: PENDING_STATUS, target_path: entry.target_path, filing_confirmed_at: now, error: null, updatedAt: now })
      .where(and(eq(action.id, entry.action_id), eq(action.status, DEFERRED_STATUS), eq(action.kind, FILE_KIND)));
  }
}

export function createDatabaseJournal(): ActionJournal {
  return {
    loadPendingActions,
    recordFromState,
    loadFilingBindings,
    markApplied,
    markFailed,
    markDeferred,
    loadActionForUndo,
    loadUndoableActionsByPolicy,
    markUndone,
    recordUndoFailure,
    loadActionForPromotion,
    loadShadowActionsByPolicy,
    promoteShadowActions,
    resolveFilingActions,
  };
}
