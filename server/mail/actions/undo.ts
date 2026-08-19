import type { ActionJournal, ActionUndoLookup, UndoableActionRow } from "@server/mail/actions/executor";
import { APPLIED_STATUS } from "@server/mail/actions/executor";
import type { MailboxMutation, MailboxState, PlannedAction } from "@server/mail/actions/kinds";
import { applyToState, inverseOf, isExecutableActionKind, planFor } from "@server/mail/actions/kinds";
import type { ActionFolders, ActionStateSnapshot } from "@server/mail/actions/state";
import { parseActionState, resolveActionFolders, serializeActionState } from "@server/mail/actions/state";
import { classifyMailboxError } from "@server/mail/errors";
import type { MailboxProvider } from "@server/mail/providers/types";
import type { MailboxFlavor } from "@server/mail/types";

// §7.3: undo reads from_state_json and issues the inverse. Nothing here decides what the opposite of an
// action is — `planFor` rebuilds the same plan the executor ran and `inverseOf` turns it into a sequence,
// both from kinds.ts. A local notion of "the opposite of archive" is exactly the drift kinds.ts exists to
// prevent, and a drifted inverse restores the wrong thing with every test still green.
//
// A row is only ever advanced to `undone`, and never deleted. A FAILED undo leaves the row `applied` and
// writes the reason to `error`: `status` describes what is true of the MESSAGE, and "this action is
// applied" stays true when the reversal did not land. Stamping it `failed` would both lie on §9's trust
// surface and lock the row out of every loader here, making the retry unreachable.

export const UNDONE_STATUS = "undone" as const;

export type UndoResult = {
  examined: number;
  undone: number;
  failed: number;
  skipped: number;
};

// Why a single action did nothing, so Task 9 can tell the operator which of these it is instead of
// rendering an empty result four different ways.
export type NotUndoableReason = "missing" | "other_mailbox" | "already_undone" | "not_applied" | "unaddressable";

export type UndoActionResult =
  | { outcome: "undone" }
  | { outcome: "failed"; error: string }
  | { outcome: "not_undoable"; reason: NotUndoableReason; detail: string };

export type UndoActionInput = {
  action_id: string;
  mailbox_id: string;
  flavor: MailboxFlavor;
  provider: MailboxProvider;
  journal: ActionJournal;
};

export type UndoPolicyActionsInput = {
  sender_policy_id: string;
  mailbox_id: string;
  flavor: MailboxFlavor;
  provider: MailboxProvider;
  journal: ActionJournal;
  batch_size: number;
};

// Where the message is right now. Starts as the address the executor recorded in to_state_json and is
// replaced after every move, because a move mints a new UID under a new UIDVALIDITY and the recorded one
// stops addressing anything the moment it lands.
type LiveAddress = {
  folder: string;
  uid: number;
  uid_validity: string;
};

type RowResult =
  | { outcome: "undone"; action_id: string; address: LiveAddress }
  // `to_state_json` is present only when the sequence got part of the way and the row must resume from a
  // new address. Carried out to undoRows rather than written here, so there is exactly one place that
  // records a failure and no refusal path can forget to.
  | { outcome: "failed"; action_id: string; error: string; to_state_json?: string }
  | { outcome: "skipped"; action_id: string };

type MutationOutcome = { outcome: "issued"; address: LiveAddress } | { outcome: "failed"; error: string };

// What the row's sequence did before it stopped, so a partial one can hand back an address to resume from.
type SequenceOutcome =
  | { outcome: "issued"; address: LiveAddress }
  | { outcome: "failed"; error: string; progress: { address: LiveAddress; state: MailboxState } | null };

function toRecordedError(error: unknown): string {
  return classifyMailboxError(error).message;
}

// Newest-first, and sorted HERE rather than trusted from the query, because the ordering is the
// correctness property and a fake or a future caller that hands rows over in another order must not be
// able to produce a wrong restore. Replaying oldest-first restores an INTERMEDIATE state: for a message
// the executor moved INBOX -> Archive and later Archive -> Trash, undoing the older action first
// addresses a UID that is no longer in Archive and, if it hit anything at all, would leave the message in
// Archive — the state between the two actions, not the one before them.
//
// applied_at is millisecond-precision, so two rows written inside one tick fall back to the action id
// purely for determinism. That is a coin flip, not a chronological order — MySQL UUID() is v1 with its
// time fields reversed, so it does not sort by time.
function newestFirst(rows: UndoableActionRow[]): UndoableActionRow[] {
  return [...rows].sort((left, right) => {
    const delta = right.applied_at.getTime() - left.applied_at.getTime();
    if (delta !== 0) {
      return delta;
    }
    return right.action_id.localeCompare(left.action_id);
  });
}

// Sets, not sequences, and the executor already serializes them sorted — this exists so a comparison
// between a projected state and a stored one cannot fail on ordering alone.
function canonicalState(state: MailboxState): string {
  return JSON.stringify({
    folder: state.folder,
    flags: [...new Set(state.flags)].sort(),
    labels: state.labels === null ? null : [...new Set(state.labels)].sort(),
  });
}

function requirePlan(
  row: UndoableActionRow,
  flavor: MailboxFlavor,
  folders: ActionFolders,
  from_state: ActionStateSnapshot,
): PlannedAction {
  const plan = planFor(row.kind, flavor, {
    source_folder: from_state.folder,
    archive_folder: folders.archive_folder,
    trash_folder: folders.trash_folder,
  });
  if (plan.outcome === "deferred") {
    throw new Error(
      `action ${row.action_id} has status applied but ${row.kind} has no executable plan (${plan.reason}), so there is nothing to invert. A deferred action never reached the mailbox; the status is wrong, not the plan.`,
    );
  }
  return plan;
}

// Every state the message passes through on the way back: index 0 is what the executor's mutation
// produced, and index i is the state after the first i inverse mutations have landed. A sequence that
// stopped half way rewrites to_state_json to where it actually got to, so a retry finds itself at some
// i > 0 rather than at a dead address.
function replayStates(plan: PlannedAction, from_state: MailboxState, inverse: MailboxMutation[]): MailboxState[] {
  const states: MailboxState[] = [applyToState(plan.mutation, from_state)];
  for (const mutation of inverse) {
    states.push(applyToState(mutation, states[states.length - 1]));
  }
  return states;
}

// The resume point, and the check that the rebuilt plan agrees with what actually ran, in one step.
// planFor resolves its targets from the server's SPECIAL-USE attributes live, so a mailbox that renamed
// or re-flagged its Archive folder since the action would yield a plan whose inverse moves the message
// out of a folder it was never in — and that plan produces no state matching the recorded one, so it
// refuses instead of mutating. Index 0 is the untouched case; the last index means the sequence already
// finished and only the status write was lost.
function resumeIndexFor(states: MailboxState[], to_state: ActionStateSnapshot): number {
  const recorded = canonicalState(to_state);
  return states.findIndex((state) => canonicalState(state) === recorded);
}

// UIDs are unique for the life of a UIDVALIDITY and are never reused, so a stale UID addresses the same
// message or nothing at all — which is what makes it safe to address the recorded UID without re-reading
// the folder first. That guarantee evaporates when UIDVALIDITY changes: the same number then addresses an
// unrelated message, and undoing onto it would move somebody else's mail.
async function requireUidValidity(input: {
  provider: MailboxProvider;
  validities: Map<string, string>;
  address: LiveAddress;
}): Promise<void> {
  const cached = input.validities.get(input.address.folder);
  const current = cached ?? (await input.provider.openFolder(input.address.folder)).uid_validity;
  input.validities.set(input.address.folder, current);

  if (current !== input.address.uid_validity) {
    throw new Error(
      `${input.address.folder} now reports UIDVALIDITY ${current}, and this action was recorded against ${input.address.uid_validity}. UID ${input.address.uid} no longer addresses the message it did, so nothing was mutated — the next sync re-reads the folder.`,
    );
  }
}

async function issueMutation(input: {
  provider: MailboxProvider;
  address: LiveAddress;
  mutation: MailboxMutation;
}): Promise<MutationOutcome> {
  const { provider, address, mutation } = input;

  if (mutation.verb === "move") {
    if (mutation.source_folder !== address.folder) {
      return {
        outcome: "failed",
        error: `the inverse moves out of ${mutation.source_folder} but the message is in ${address.folder}. The UIDs in a move address one folder, so issuing it would relocate whatever else holds that UID.`,
      };
    }

    const result = await provider.moveMessages(address.folder, [address.uid], mutation.target_folder);
    const pair = result.pairs.find((candidate) => candidate.source_uid === address.uid);
    if (pair === undefined) {
      // An unconfirmed UID is not an error the provider throws on (§11) and this is not retried inside the
      // run: after a partial move the message is either relocated without being reported or not relocated
      // at all, and a blind retry would move an already-moved message a second time.
      return {
        outcome: "failed",
        error: `the server confirmed no destination for UID ${address.uid} moving out of ${address.folder}, so its state is unknown. Not retried — the next sync re-reads the mailbox and this row keeps its from_state.`,
      };
    }
    return {
      outcome: "issued",
      address: { folder: mutation.target_folder, uid: pair.destination_uid, uid_validity: result.destination_uid_validity },
    };
  }

  const result = await provider.setLabels(address.folder, [address.uid], {
    add_labels: mutation.add_labels,
    remove_labels: mutation.remove_labels,
  });
  if (!result.uids.includes(address.uid)) {
    return {
      outcome: "failed",
      error: `the server confirmed no label write for UID ${address.uid} in ${address.folder}, so the recorded labels were not restored.`,
    };
  }
  // A label write leaves the message exactly where it was, so the address is unchanged.
  return { outcome: "issued", address };
}

// In order, stopping on the first failure. A Gmail trash undo is a move back followed by a label restore;
// a succeeded move with a failed restore leaves the message correctly filed but unlabelled, which is why
// the failure carries the progress it made rather than only the error.
async function issueSequence(input: {
  provider: MailboxProvider;
  address: LiveAddress;
  mutations: MailboxMutation[];
  states: MailboxState[];
  first_index: number;
}): Promise<SequenceOutcome> {
  let address = input.address;
  let progress: { address: LiveAddress; state: MailboxState } | null = null;

  for (const [offset, mutation] of input.mutations.entries()) {
    let outcome: MutationOutcome;
    try {
      outcome = await issueMutation({ provider: input.provider, address, mutation });
    } catch (error) {
      return { outcome: "failed", error: toRecordedError(error), progress };
    }
    if (outcome.outcome === "failed") {
      return { outcome: "failed", error: outcome.error, progress };
    }
    address = outcome.address;
    progress = { address, state: input.states[input.first_index + offset + 1] };
  }

  return { outcome: "issued", address };
}

async function undoRow(input: {
  row: UndoableActionRow;
  flavor: MailboxFlavor;
  provider: MailboxProvider;
  folders: ActionFolders;
  live_address: LiveAddress | undefined;
  validities: Map<string, string>;
}): Promise<RowResult> {
  const { row } = input;

  const from_state = parseActionState(row.from_state_json);
  if (from_state === null) {
    return {
      outcome: "failed",
      action_id: row.action_id,
      error: `action ${row.action_id} has no usable from_state_json, so there is no recorded state to restore. Undo restores what was captured before the mutation and never reconstructs it from later sync data.`,
    };
  }

  const to_state = parseActionState(row.to_state_json);
  if (to_state === null) {
    return {
      outcome: "failed",
      action_id: row.action_id,
      error: `action ${row.action_id} has no usable to_state_json, so the message the executor moved has no recorded address. §7.2: without COPYUID's destination there is nowhere for undo to write until the next full sync.`,
    };
  }

  let inverse: MailboxMutation[];
  let states: MailboxState[];
  let first_index: number;
  try {
    const plan = requirePlan(row, input.flavor, input.folders, from_state);
    inverse = inverseOf(plan, from_state);
    states = replayStates(plan, from_state, inverse);
    first_index = resumeIndexFor(states, to_state);
  } catch (error) {
    return { outcome: "failed", action_id: row.action_id, error: toRecordedError(error) };
  }

  if (first_index < 0) {
    return {
      outcome: "failed",
      action_id: row.action_id,
      error: `the recorded to_state ${canonicalState(to_state)} matches no point on this action's path back from ${canonicalState(states[0])}. The mailbox's folder layout most likely changed since the action ran, so the inverse would address the wrong folder. Nothing was mutated.`,
    };
  }

  // Either the action changed nothing, or a previous attempt already issued the whole sequence and only
  // the status write was lost. Both are successful undos with no command left to issue.
  const remaining = inverse.slice(first_index);
  const address: LiveAddress = input.live_address ?? { folder: to_state.folder, uid: to_state.uid, uid_validity: to_state.uid_validity };
  if (remaining.length === 0) {
    return { outcome: "undone", action_id: row.action_id, address };
  }

  try {
    await requireUidValidity({ provider: input.provider, validities: input.validities, address });
  } catch (error) {
    return { outcome: "failed", action_id: row.action_id, error: toRecordedError(error) };
  }

  const outcome = await issueSequence({
    provider: input.provider,
    address,
    mutations: remaining,
    states,
    first_index,
  });

  if (outcome.outcome === "issued") {
    return { outcome: "undone", action_id: row.action_id, address: outcome.address };
  }

  if (outcome.progress === null) {
    return { outcome: "failed", action_id: row.action_id, error: outcome.error };
  }

  // A sequence that got part of the way leaves the message at an address to_state_json does not name, and
  // a retry starting from the old one could only fail again. Recording where it actually got to makes the
  // resume reachable: replayStates matches that state at index i > 0 and the retry issues the tail.
  const resumed = outcome.progress;
  return {
    outcome: "failed",
    action_id: row.action_id,
    error: outcome.error,
    to_state_json: serializeActionState({ ...resumed.state, uid: resumed.address.uid, uid_validity: resumed.address.uid_validity }),
  };
}

async function undoRows(input: {
  rows: UndoableActionRow[];
  flavor: MailboxFlavor;
  provider: MailboxProvider;
  journal: ActionJournal;
}): Promise<RowResult[]> {
  if (input.rows.length === 0) {
    return [];
  }

  const folders = await resolveActionFolders(input.provider);
  const validities = new Map<string, string>();
  // Keyed by message, not by action: consecutive undos of a chain walk the same message backwards, and
  // each move leaves it at an address no journal row knows about.
  const live_addresses = new Map<string, LiveAddress>();
  const blocked_messages = new Set<string>();
  const results: RowResult[] = [];

  for (const row of newestFirst(input.rows)) {
    // Skipped, not failed, and nothing is written to it. A newer action on this message is still standing,
    // so restoring this older one would produce a state the message was never in — but this row is still
    // correctly applied and its mailbox state is untouched, and stamping it would make §9's journal claim
    // something went wrong with an action that is exactly where it should be.
    if (blocked_messages.has(row.message_id)) {
      results.push({ outcome: "skipped", action_id: row.action_id });
      continue;
    }

    let result: RowResult;
    try {
      result = await undoRow({
        row,
        flavor: input.flavor,
        provider: input.provider,
        folders,
        live_address: live_addresses.get(row.message_id),
        validities,
      });
    } catch (error) {
      result = { outcome: "failed", action_id: row.action_id, error: toRecordedError(error) };
    }

    results.push(result);

    // Every failure lands here and nowhere else, so a refusal that never reached the mailbox is recorded
    // as visibly as one that half did. `status` is untouched — the action is still applied.
    if (result.outcome === "failed") {
      await input.journal.recordUndoFailure(
        result.to_state_json === undefined
          ? [{ action_id: result.action_id, error: result.error }]
          : [{ action_id: result.action_id, error: result.error, to_state_json: result.to_state_json }],
      );
      blocked_messages.add(row.message_id);
      continue;
    }
    if (result.outcome === "undone") {
      live_addresses.set(row.message_id, result.address);
      // Written per row, immediately after its inverse lands, rather than batched at the end: a crash
      // mid-replay must not leave an already-reversed row looking replayable.
      await input.journal.markUndone([{ action_id: row.action_id }]);
    }
  }

  return results;
}

// A lookup by id alone, classified here rather than filtered away in SQL, so "no such action", "that
// action belongs to another mailbox", "already undone" and "never applied" stay distinguishable. A loader
// that filtered on status and mailbox returns null for all four, and Task 9 has to tell the operator
// which one it was.
function classifyLookup(lookup: ActionUndoLookup | null, mailbox_id: string): UndoActionResult | { row: UndoableActionRow } {
  if (lookup === null) {
    return { outcome: "not_undoable", reason: "missing", detail: "no action with that id exists." };
  }
  if (lookup.mailbox_id !== mailbox_id) {
    return {
      outcome: "not_undoable",
      reason: "other_mailbox",
      detail: `that action belongs to mailbox ${lookup.mailbox_id ?? "(none recorded)"}, and undo must reach the server it mutated.`,
    };
  }
  if (lookup.status === UNDONE_STATUS) {
    return { outcome: "not_undoable", reason: "already_undone", detail: "that action has already been undone." };
  }
  if (lookup.status !== APPLIED_STATUS) {
    return {
      outcome: "not_undoable",
      reason: "not_applied",
      detail: `that action has status ${lookup.status}, so it never mutated the mailbox and there is nothing to reverse.`,
    };
  }
  if (!isExecutableActionKind(lookup.kind) || lookup.applied_at === null) {
    return {
      outcome: "not_undoable",
      reason: "unaddressable",
      detail: `that action is applied but carries kind "${lookup.kind}" and applied_at ${lookup.applied_at === null ? "NULL" : "set"}; undo needs an executable kind and a time to order it by.`,
    };
  }
  return {
    row: {
      action_id: lookup.action_id,
      message_id: lookup.message_id,
      kind: lookup.kind,
      from_state_json: lookup.from_state_json,
      to_state_json: lookup.to_state_json,
      applied_at: lookup.applied_at,
    },
  };
}

export async function undoAction(input: UndoActionInput): Promise<UndoActionResult> {
  if (input.action_id.length === 0) {
    throw new Error("undoAction needs an action id.");
  }
  if (input.mailbox_id.length === 0) {
    throw new Error("undoAction needs a mailbox id: the provider is connected to one server, and undo must reach the server it mutated.");
  }

  const classified = classifyLookup(await input.journal.loadActionForUndo({ action_id: input.action_id }), input.mailbox_id);
  if (!("row" in classified)) {
    return classified;
  }

  const results = await undoRows({ rows: [classified.row], flavor: input.flavor, provider: input.provider, journal: input.journal });
  const result = results[0];
  if (result === undefined || result.outcome === "skipped") {
    throw new Error(
      `undoAction was handed one row and got back ${result === undefined ? "none" : "a skipped one"}; a single row has no sibling to block it.`,
    );
  }
  if (result.outcome === "failed") {
    return { outcome: "failed", error: result.error };
  }
  return { outcome: "undone" };
}

// Scoped to one mailbox even though a policy is not: the caller supplies a provider connected to a single
// server, so a policy that acted across mailboxes is undone one mailbox at a time rather than by pointing
// one connection at rows it cannot address.
export async function undoPolicyActions(input: UndoPolicyActionsInput): Promise<UndoResult> {
  if (input.sender_policy_id.length === 0) {
    throw new Error("undoPolicyActions needs a policy id: an unscoped undo would reverse every action ever taken in this mailbox.");
  }
  if (input.mailbox_id.length === 0) {
    throw new Error(
      "undoPolicyActions needs a mailbox id: the provider is connected to one server, and undo must reach the server it mutated.",
    );
  }

  const rows = await input.journal.loadUndoableActionsByPolicy({
    mailbox_id: input.mailbox_id,
    sender_policy_id: input.sender_policy_id,
    batch_size: input.batch_size,
  });
  const results = await undoRows({ rows, flavor: input.flavor, provider: input.provider, journal: input.journal });

  return {
    examined: rows.length,
    undone: results.filter((result) => result.outcome === "undone").length,
    failed: results.filter((result) => result.outcome === "failed").length,
    skipped: results.filter((result) => result.outcome === "skipped").length,
  };
}
