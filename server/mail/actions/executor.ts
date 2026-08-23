import type { ExecutableActionKind, MailboxMutation, MailboxState, PlannedAction } from "@server/mail/actions/kinds";
import { applyToState, FILE_KIND, planFor, QUARANTINE_KIND, QUARANTINE_LOGICAL_PATH } from "@server/mail/actions/kinds";
import type { ActionStateSnapshot } from "@server/mail/actions/state";
import { captureFolderStates, resolveActionFolders, serializeActionState } from "@server/mail/actions/state";
import type { PolicyScope } from "@server/mail/classify/rules";
import { classifyMailboxError } from "@server/mail/errors";
// Type-only, deliberately: bindings.ts opens the drizzle connection at import time, and the executor is
// exercised over a fake journal. The rows arrive through the port instead.
import type { FilingBindingRow } from "@server/mail/filing/bindings";
import { filingDecisionFor, filingQueueReason } from "@server/mail/filing/paths";
import { createFilingResolver } from "@server/mail/filing/resolver";
import type { MailboxProvider } from "@server/mail/providers/types";
import type { MailboxFlavor } from "@server/mail/types";

// §7.1's ordering is the whole module:
//
//   1. read the current state from the server
//   2. write the Action row with from_state_json, status "pending"
//   3. perform the IMAP mutation
//   4. record to_state_json and mark "applied" — or "failed" with the error
//
// Mutate-then-journal loses the pre-state on any crash and makes undo permanently impossible for those
// messages. A crash between 3 and 4 leaves a "pending" row still holding the exact pre-state, which is
// what lets the next run reconcile by comparing real server state against from_state / to_state. Nothing
// below may reorder those four steps, and executor.test.ts asserts the order by killing the run between
// them.
//
// Creating a filing folder is the one mailbox write that sits OUTSIDE those four steps, and deliberately:
// it happens once per run, before any row is journalled. It is sound because it touches no message — a
// CREATE has no pre-state to lose and nothing for undo to reverse — and because it is idempotent, so a
// crash straight after it leaves an empty folder the next run reuses rather than a message whose location
// no row records. The four steps govern anything that moves or relabels mail; this does neither.

export const PENDING_STATUS = "pending" as const;
export const APPLIED_STATUS = "applied" as const;
export const FAILED_STATUS = "failed" as const;
export const DEFERRED_STATUS = "deferred" as const;

export type PendingActionRow = {
  action_id: string;
  message_id: string;
  kind: ExecutableActionKind;
  run_id: string;
  folder: string;
  uid: number;
  // The four inputs §6's filing gate needs, carried on the row rather than fetched per message: the
  // proposal (Action.targetPath), the scope of the policy that made it, the message's DKIM state, and
  // whether a human confirmed the destination out of the filing queue.
  // Joined in loadPendingActions so the gate stays one pure function over data the executor already has.
  target_path: string | null;
  policy_scope: PolicyScope | null;
  dkim_aligned: boolean | null;
  filing_confirmed_at: Date | null;
};

// An applied row, read back so server/mail/actions/undo.ts can issue its inverse. `applied_at` rides
// along because §7.3 replays inverses newest-first and undo sorts on it rather than trusting the query's
// ORDER BY. Declared here, next to the other journal DTOs, because the port is defined here.
export type UndoableActionRow = {
  action_id: string;
  message_id: string;
  kind: ExecutableActionKind;
  from_state_json: string | null;
  to_state_json: string | null;
  applied_at: Date;
  // The logical path the `file` action was executed against. Undo re-resolves it rather than reading the
  // destination out of to_state_json, so there is one definition of where a logical path lives; a binding
  // edited since the action then produces a plan matching no recorded state, and undo refuses.
  target_path: string | null;
};

// One `Action` row read by id alone, with nothing filtered away, so undo can tell "no such action" from
// "another mailbox's action" from "already undone" from "never applied". `kind` and `applied_at` arrive
// unnarrowed for the same reason: a row that cannot be addressed must be reportable, not invisible.
export type ActionUndoLookup = {
  action_id: string;
  message_id: string;
  mailbox_id: string | null;
  status: string;
  kind: string;
  from_state_json: string | null;
  to_state_json: string | null;
  applied_at: Date | null;
  target_path: string | null;
};

export type FromStateEntry = { action_id: string; from_state_json: string };
export type AppliedEntry = { action_id: string; to_state_json: string };
export type FailedEntry = { action_id: string; error: string };
export type DeferredEntry = { action_id: string; reason: string };
export type UndoneEntry = { action_id: string };
// A failed undo does NOT change `status`. `to_state_json` is present only when the sequence got part of
// the way and the row must resume from a new address; absent leaves the column alone.
export type UndoFailureEntry = { action_id: string; error: string; to_state_json?: string };

// One `Action` row read by id alone, unfiltered, so server/mail/actions/promote.ts can tell "no such
// action" from "another mailbox's action" from "not a shadow row" — the same reason ActionUndoLookup
// withholds nothing.
export type ActionPromotionLookup = { action_id: string; mailbox_id: string | null; status: string };
export type PromotedEntry = { action_id: string };

// Carries no `status`: journal.ts writes `pending` and nothing else can be expressed here. That is the
// same shape PromotedEntry uses, and for the same reason — a status the caller could name is a status the
// caller could get wrong.
export type FilingResolutionEntry = { action_id: string; target_path: string };

// The database sits behind a port so the executor can be exercised over a fake: every DATABASE_URL variant
// points at the same production MySQL, so a test that reached a real implementation would mutate ~29,000
// live Action rows. server/mail/actions/journal.ts holds the only drizzle-backed implementation.
export type ActionJournal = {
  // `action_ids`, when present, narrows the batch to exactly those rows and NOTHING else. It is how the
  // scheduled sync executes only what it promoted itself: `pending` is also what operator approval
  // produces, so a run that loaded the whole pending set would apply, on a timer, decisions the operator
  // approved intending to review before pressing Apply. Absent means the full pending set, which is what
  // the operator-driven applyPending procedure asks for.
  loadPendingActions: (input: { mailbox_id: string; batch_size: number; action_ids?: string[] }) => Promise<PendingActionRow[]>;
  // Writes from_state_json ONLY where the row has none. A crashed run leaves a pending row holding the
  // correct pre-state, and the next run re-captures a post-mutation one; the first capture is the truth,
  // and journal.ts enforces that in the UPDATE's WHERE clause rather than trusting a caller to check.
  recordFromState: (entries: FromStateEntry[]) => Promise<void>;
  // Behind the port for the same reason every other read is: a test that reached a real implementation
  // would open a connection to the production database.
  loadFilingBindings: (input: { mailbox_id: string }) => Promise<FilingBindingRow[]>;
  markApplied: (entries: AppliedEntry[]) => Promise<void>;
  markFailed: (entries: FailedEntry[]) => Promise<void>;
  markDeferred: (entries: DeferredEntry[]) => Promise<void>;
  // Undo's reads and its two writes, on the same port rather than a second seam: one journal type, one
  // drizzle-backed implementation, and a test that reaches neither.
  loadActionForUndo: (input: { action_id: string }) => Promise<ActionUndoLookup | null>;
  loadUndoableActionsByPolicy: (input: {
    mailbox_id: string;
    sender_policy_id: string;
    batch_size: number;
  }) => Promise<UndoableActionRow[]>;
  markUndone: (entries: UndoneEntry[]) => Promise<void>;
  // Records why a reversal did not land WITHOUT touching `status`: the action is still applied, which is
  // what §9's journal must keep saying, and what keeps the row reachable for a retry.
  recordUndoFailure: (entries: UndoFailureEntry[]) => Promise<void>;
  // Promotion's read and its one write, on the same port for the same reason undo's are: one journal
  // type, one drizzle-backed implementation, and a test that reaches neither.
  loadActionForPromotion: (input: { action_id: string }) => Promise<ActionPromotionLookup | null>;
  loadShadowActionsByPolicy: (input: {
    mailbox_id: string;
    sender_policy_id: string;
    batch_size: number;
  }) => Promise<ActionPromotionLookup[]>;
  // Writes status "pending" and NOTHING else — no from_state_json, to_state_json, or applied_at. Those
  // belong to the executor's own steps 1-4; promotion only approves a shadow decision for the executor to
  // pick up, and journal.ts's UPDATE is guarded on `WHERE status = 'shadow'` so this can never move a row
  // that is not one, applied included.
  //
  // Returns the ids it actually flipped — the subset of `entries` whose guarded UPDATE matched. The
  // scheduled sync executes against that list and nothing else, so "read them" and "moved them" must not
  // be confused: two concurrent syncs read the same rows, and only one of them moves each.
  promoteShadowActions: (entries: PromotedEntry[]) => Promise<string[]>;
  // Moves ONE deferred filing row to `pending` with the operator's confirmed destination. Guarded in the
  // UPDATE's WHERE clause on both status and kind, not in the caller: a check the caller performs is a
  // check a second caller can skip, and this is the only transition that can un-defer a row.
  resolveFilingActions: (entries: FilingResolutionEntry[]) => Promise<void>;
};

export type ExecuteActionsInput = {
  mailbox_id: string;
  flavor: MailboxFlavor;
  provider: MailboxProvider;
  journal: ActionJournal;
  batch_size: number;
  // Mailbox.hierarchyDelimiter, populated at sync time from the LIST response. An empty one fails inside
  // renderFolderPath, which is the correct place: it means this mailbox was never synced.
  hierarchy_delimiter: string;
  // Passed straight through to loadPendingActions — see the note on the port. Omitted by the
  // operator-driven path, supplied by the scheduled one.
  action_ids?: string[];
};

export type ExecuteActionsResult = {
  examined: number;
  applied: number;
  failed: number;
  deferred: number;
};

type ExecutionGroup = {
  folder: string;
  mutation: MailboxMutation;
  rows: PendingActionRow[];
};

// The destination address a mutation confirmed for one source UID. `uid_validity` is null when the
// mutation cannot have changed it — a label write leaves the message exactly where it was.
type ConfirmedAddress = { uid: number; uid_validity: string | null };

type MutationOutcome = { confirmed: Map<number, ConfirmedAddress> };

type GroupOutcome = { applied: number; failed: number };

// Records the reason, not drizzle's query dump: classifyMailboxError unwraps DrizzleQueryError and reads
// sqlMessage, so `Action.error` gets ER_DATA_TOO_LONG rather than 53KB of SQL and bound parameters.
function toRecordedError(error: unknown): string {
  return classifyMailboxError(error).message;
}

// §7.3's grouping key. Rows sharing a folder and a target become one command over a UID set, so archiving
// 400 newsletters is one UID MOVE rather than 400 round trips. Label writes join the key on their exact
// add/remove sets, because two different label edits cannot ride one STORE.
function groupKeyFor(folder: string, mutation: MailboxMutation): string {
  if (mutation.verb === "move") {
    return ["move", folder, mutation.target_folder].join(" | ");
  }
  return ["set_labels", folder, [...mutation.add_labels].sort().join(","), [...mutation.remove_labels].sort().join(",")].join(" | ");
}

// Every wanted path either resolved or had its rows queued, and pass two skips the queued ones — so a
// miss here is a bug in that pairing rather than a destination the planner should guess at.
function requireResolvedFolder(resolved_folders: Map<string, string>, logical_path: string): string {
  const folder = resolved_folders.get(logical_path);
  if (folder === undefined) {
    throw new Error(`no resolved folder for logical path ${logical_path}; a row reaches the planner only after its path resolves.`);
  }
  return folder;
}

function requireState(states: Map<string, ActionStateSnapshot>, action_id: string): ActionStateSnapshot {
  const state = states.get(action_id);
  if (state === undefined) {
    throw new Error(`no captured state for action ${action_id}; a row reaches the mutation only after its state is captured.`);
  }
  return state;
}

async function performMutation(
  provider: MailboxProvider,
  folder: string,
  uids: number[],
  mutation: MailboxMutation,
): Promise<MutationOutcome> {
  if (mutation.verb === "move") {
    const result = await provider.moveMessages(folder, uids, mutation.target_folder);
    // A confirmed pair proves the destination copy exists at that UID. It does not prove the source copy
    // is gone: on a server without MOVE the provider finishes a COPY with UID EXPUNGE, and imapflow does
    // not check the result of the STORE (\Deleted) that precedes it, so a rejected flag store still
    // reports success. The failure direction is a duplicate left behind, never a deletion, and the next
    // sync resolves it against real server state — nothing here may assert the source UID is gone.
    //
    // What failed is derived from the absence of a pair rather than read out of `unconfirmed_uids`, so a
    // UID the server never addressed fails even if the two ever disagreed. The field stays the provider's
    // way of saying this is not an error, which is why nothing below throws on it.
    const confirmed = new Map<number, ConfirmedAddress>();
    for (const pair of result.pairs) {
      confirmed.set(pair.source_uid, { uid: pair.destination_uid, uid_validity: result.destination_uid_validity });
    }
    return { confirmed };
  }

  const result = await provider.setLabels(folder, uids, { add_labels: mutation.add_labels, remove_labels: mutation.remove_labels });
  return { confirmed: new Map(result.uids.map((uid) => [uid, { uid, uid_validity: null }])) };
}

async function executeGroup(input: { group: ExecutionGroup; provider: MailboxProvider; journal: ActionJournal }): Promise<GroupOutcome> {
  const { group, provider, journal } = input;

  // Step 1: read the current state from the server.
  let captured: Map<number, ActionStateSnapshot>;
  try {
    captured = await captureFolderStates({ provider, folder: group.folder, uids: group.rows.map((row) => row.uid) });
  } catch (error) {
    const message = toRecordedError(error);
    await journal.markFailed(group.rows.map((row) => ({ action_id: row.action_id, error: message })));
    return { applied: 0, failed: group.rows.length };
  }

  const live_rows: PendingActionRow[] = [];
  const from_states = new Map<string, ActionStateSnapshot>();
  const projected_states = new Map<string, MailboxState>();
  const pre_mutation_failures: FailedEntry[] = [];

  for (const row of group.rows) {
    const from_state = captured.get(row.uid);
    if (from_state === undefined) {
      pre_mutation_failures.push({
        action_id: row.action_id,
        error: `UID ${row.uid} is no longer in ${group.folder}. The mailbox is the source of truth, so the message was moved or removed after this row was journalled and nothing was mutated; the next sync re-reads it.`,
      });
      continue;
    }

    // Projected here rather than after the mutation on purpose: applyToState refuses a label write against
    // a state with no label set, and finding that out afterwards would mean a mutated mailbox with a row
    // marked failed. Everything predictable fails before step 3.
    try {
      projected_states.set(row.action_id, applyToState(group.mutation, from_state));
    } catch (error) {
      pre_mutation_failures.push({ action_id: row.action_id, error: toRecordedError(error) });
      continue;
    }

    live_rows.push(row);
    from_states.set(row.action_id, from_state);
  }

  if (pre_mutation_failures.length > 0) {
    await journal.markFailed(pre_mutation_failures);
  }
  if (live_rows.length === 0) {
    return { applied: 0, failed: pre_mutation_failures.length };
  }

  // Step 2: journal from_state at status "pending", before anything is mutated.
  // A throw here aborts the run with the mailbox untouched, and is deliberately not caught: marking these
  // rows failed would be another write to the journal that just refused one, and leaving them pending
  // without a pre-state is the one outcome undo cannot recover from.
  //
  // A row that already carries a pre-state keeps it — this is a re-run of a crashed one, and what was
  // captured just now is the state that crash left behind, not the state to restore. The port enforces it.
  await journal.recordFromState(
    live_rows.map((row) => ({
      action_id: row.action_id,
      from_state_json: serializeActionState(requireState(from_states, row.action_id)),
    })),
  );

  // Step 3: one command over the whole UID set.
  const uids = live_rows.map((row) => row.uid);
  let outcome: MutationOutcome;
  try {
    outcome = await performMutation(provider, group.folder, uids, group.mutation);
  } catch (error) {
    // Every row keeps its pre-state and becomes failed rather than applied. Nothing re-runs a failed row —
    // loadPendingActions selects only pending ones — so the pre-state stands for reconciliation and for the
    // operator, not for a retry. A move that succeeded server-side and threw on the way back lands here
    // too, which is why this status is a report of what we observed rather than a fact about the mailbox.
    const message = toRecordedError(error);
    await journal.markFailed(live_rows.map((row) => ({ action_id: row.action_id, error: message })));
    return { applied: 0, failed: pre_mutation_failures.length + live_rows.length };
  }

  // Step 4: record to_state and mark applied, or failed.
  const applied_entries: AppliedEntry[] = [];
  const unconfirmed_failures: FailedEntry[] = [];

  for (const row of live_rows) {
    const address = outcome.confirmed.get(row.uid);
    if (address === undefined) {
      // §11: mark only the unconfirmed UIDs failed. After a partial UID MOVE this message's state is
      // genuinely unknown — moved but unreported, or not moved — and a blind retry would move an already
      // moved message a second time. Nothing is retried and nothing is guessed; the next sync resolves it.
      unconfirmed_failures.push({
        action_id: row.action_id,
        error: `the server confirmed no destination for UID ${row.uid} in ${group.folder}, so its state is unknown: it may have been relocated without being reported, or not relocated at all. Not retried — the next sync re-reads the mailbox and reconciles against from_state.`,
      });
      continue;
    }

    const from_state = requireState(from_states, row.action_id);
    const projected = projected_states.get(row.action_id);
    if (projected === undefined) {
      throw new Error(`no projected state for action ${row.action_id}; every live row is projected before the mutation is issued.`);
    }

    applied_entries.push({
      action_id: row.action_id,
      to_state_json: serializeActionState({
        ...projected,
        uid: address.uid,
        uid_validity: address.uid_validity ?? from_state.uid_validity,
      }),
    });
  }

  if (unconfirmed_failures.length > 0) {
    await journal.markFailed(unconfirmed_failures);
  }
  if (applied_entries.length > 0) {
    await journal.markApplied(applied_entries);
  }

  return {
    applied: applied_entries.length,
    failed: pre_mutation_failures.length + unconfirmed_failures.length,
  };
}

export async function executeActions(input: ExecuteActionsInput): Promise<ExecuteActionsResult> {
  const rows = await input.journal.loadPendingActions({
    mailbox_id: input.mailbox_id,
    batch_size: input.batch_size,
    action_ids: input.action_ids,
  });
  const result: ExecuteActionsResult = { examined: rows.length, applied: 0, failed: 0, deferred: 0 };
  if (rows.length === 0) {
    return result;
  }

  const folders = await resolveActionFolders(input.provider);

  const deferred: DeferredEntry[] = [];
  const unplannable: FailedEntry[] = [];

  // Pass one: classify, and collect the DISTINCT logical paths the batch wants. No resolution happens
  // per row — filing 400 messages into one client folder must issue one CREATE, not 400 resolutions.
  type ClassifiedRow = { row: PendingActionRow; logical_path: string | null };
  const classified: ClassifiedRow[] = [];
  const wanted_paths = new Set<string>();

  for (const row of rows) {
    // Quarantine wants one folder for the whole batch and needs none of filing's gating — there is no
    // policy to check a scope on and no DKIM question to ask, because the defining fact about a first
    // contact is that nothing is known about the sender.
    if (row.kind === QUARANTINE_KIND) {
      wanted_paths.add(QUARANTINE_LOGICAL_PATH);
      classified.push({ row, logical_path: QUARANTINE_LOGICAL_PATH });
      continue;
    }

    if (row.kind !== FILE_KIND) {
      classified.push({ row, logical_path: null });
      continue;
    }

    const decision = filingDecisionFor({
      logical_path: row.target_path,
      policy_scope: row.policy_scope,
      dkim_aligned: row.dkim_aligned,
      filing_confirmed_at: row.filing_confirmed_at,
    });
    if (decision.outcome === "queue") {
      // §6's filing queue: kind `file` at status `deferred`, with the reason in `error`. Nothing was sent
      // to the mailbox, and a deferred row's `error` is an explanation rather than a failure. Resolution
      // moves the row back to `pending` and it re-enters this function unchanged.
      deferred.push({ action_id: row.action_id, reason: filingQueueReason(decision.reason, decision.detail) });
      continue;
    }

    wanted_paths.add(decision.logical_path);
    classified.push({ row, logical_path: decision.logical_path });
  }

  // One resolution round for the distinct paths, before any plan is built. A path that cannot be resolved
  // QUEUES every row wanting it rather than failing them: nothing was mutated, the operator can bind the
  // path to a folder that already exists, and the row is then retryable — which is what `deferred` means
  // and `failed` does not.
  const resolved_folders = new Map<string, string>();
  if (wanted_paths.size > 0) {
    const resolver = await createFilingResolver({
      provider: input.provider,
      bindings: await input.journal.loadFilingBindings({ mailbox_id: input.mailbox_id }),
      delimiter: input.hierarchy_delimiter,
    });
    for (const logical_path of wanted_paths) {
      try {
        resolved_folders.set(logical_path, await resolver.resolve(logical_path));
      } catch (error) {
        const detail = toRecordedError(error);
        for (const entry of classified) {
          if (entry.logical_path === logical_path) {
            deferred.push({ action_id: entry.row.action_id, reason: filingQueueReason("unresolvable_folder", detail) });
          }
        }
      }
    }
  }

  // Pass two: build the plans, now that every destination this batch needs is a real folder name.
  const groups = new Map<string, ExecutionGroup>();

  for (const entry of classified) {
    const { row } = entry;
    if (entry.logical_path !== null && !resolved_folders.has(entry.logical_path)) {
      continue; // already queued by the resolution round above
    }

    let plan: PlannedAction;
    try {
      // Both destinations are gated on the row's own kind rather than merely on a resolved path being
      // present. A quarantine row and a file row both carry a logical path by this point, and handing
      // each other's destination to planFor would type-check perfectly while filing a message into
      // Quarantine.
      const resolved_path = entry.logical_path === null ? null : requireResolvedFolder(resolved_folders, entry.logical_path);
      plan = planFor(row.kind, input.flavor, {
        source_folder: row.folder,
        archive_folder: folders.archive_folder,
        trash_folder: folders.trash_folder,
        file_folder: row.kind === FILE_KIND ? resolved_path : null,
        quarantine_folder: row.kind === QUARANTINE_KIND ? resolved_path : null,
      });
    } catch (error) {
      // Ruling 2: a missing SPECIAL-USE folder is a hard failure. planFor refuses rather than guessing a
      // name, and the refusal is recorded against the row instead of being turned into a default target.
      unplannable.push({ action_id: row.action_id, error: toRecordedError(error) });
      continue;
    }

    const key = groupKeyFor(row.folder, plan.mutation);
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, { folder: row.folder, mutation: plan.mutation, rows: [row] });
      continue;
    }
    group.rows.push(row);
  }

  // Both are settled before a single command is issued, so a run that dies mid-sweep has already parked
  // the rows it was never going to touch.
  if (deferred.length > 0) {
    await input.journal.markDeferred(deferred);
  }
  if (unplannable.length > 0) {
    await input.journal.markFailed(unplannable);
  }
  result.deferred = deferred.length;
  result.failed = unplannable.length;

  for (const group of groups.values()) {
    const outcome = await executeGroup({ group, provider: input.provider, journal: input.journal });
    result.applied += outcome.applied;
    result.failed += outcome.failed;
  }

  return result;
}
