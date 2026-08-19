import type { ActionJournal, UndoableActionRow } from "@server/mail/actions/executor";
import type { MailboxMutation, MailboxState, PlannedAction } from "@server/mail/actions/kinds";
import { applyToState, inverseOf, planFor } from "@server/mail/actions/kinds";
import type { ActionFolders, ActionStateSnapshot } from "@server/mail/actions/state";
import { parseActionState, resolveActionFolders } from "@server/mail/actions/state";
import { classifyMailboxError } from "@server/mail/errors";
import type { MailboxProvider } from "@server/mail/providers/types";
import type { MailboxFlavor } from "@server/mail/types";

// §7.3: undo reads from_state_json and issues the inverse. Nothing here decides what the opposite of an
// action is — `planFor` rebuilds the same plan the executor ran and `inverseOf` turns it into a sequence,
// both from kinds.ts. A local notion of "the opposite of archive" is exactly the drift kinds.ts exists to
// prevent, and a drifted inverse restores the wrong thing with every test still green.
//
// An undone row becomes `undone`; it is never deleted. §9's journal is the trust surface, and a row that
// vanished is worse than one that was reversed — the reversal is itself part of the record.

export const UNDONE_STATUS = "undone" as const;

export type UndoResult = {
  examined: number;
  undone: number;
  failed: number;
};

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

type RowOutcome = { outcome: "undone"; address: LiveAddress } | { outcome: "failed"; error: string };

type MutationOutcome = { outcome: "issued"; address: LiveAddress } | { outcome: "failed"; error: string };

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
// purely for determinism; that tie is genuinely ambiguous and no column in `Action` resolves it.
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
// between a freshly projected state and a stored one cannot fail on ordering alone.
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

// The one check that catches a rebuilt plan disagreeing with what actually ran. planFor resolves its
// targets from the server's SPECIAL-USE attributes live, so a mailbox that renamed or re-flagged its
// Archive folder since the action would yield a plan whose inverse moves the message out of a folder it
// was never in. Comparing the plan's projected result against the recorded to_state turns that into a
// refusal instead of a mutation against an unrelated message.
function requireAgreementWithRecordedResult(plan: PlannedAction, from_state: ActionStateSnapshot, to_state: ActionStateSnapshot): void {
  const projected = applyToState(plan.mutation, from_state);
  if (canonicalState(projected) === canonicalState(to_state)) {
    return;
  }
  throw new Error(
    `the plan rebuilt for this action does not produce the state the executor recorded: expected ${canonicalState(to_state)}, rebuilt ${canonicalState(projected)}. The mailbox's folder layout most likely changed since the action ran, so the inverse would address the wrong folder. Nothing was mutated.`,
  );
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
      // An unconfirmed UID is not an error the provider throws on (§11) and this is not retried: after a
      // partial move the message is either relocated without being reported or not relocated at all, and
      // a blind retry would move an already-moved message a second time.
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

async function undoRow(input: {
  row: UndoableActionRow;
  flavor: MailboxFlavor;
  provider: MailboxProvider;
  folders: ActionFolders;
  live_address: LiveAddress | undefined;
  validities: Map<string, string>;
}): Promise<RowOutcome> {
  const { row } = input;

  const from_state = parseActionState(row.from_state_json);
  if (from_state === null) {
    return {
      outcome: "failed",
      error: `action ${row.action_id} has no usable from_state_json, so there is no recorded state to restore. Undo restores what was captured before the mutation and never reconstructs it from later sync data.`,
    };
  }

  const to_state = parseActionState(row.to_state_json);
  if (to_state === null) {
    return {
      outcome: "failed",
      error: `action ${row.action_id} has no usable to_state_json, so the message the executor moved has no recorded address. §7.2: without COPYUID's destination there is nowhere for undo to write until the next full sync.`,
    };
  }

  let inverse: MailboxMutation[];
  try {
    const plan = requirePlan(row, input.flavor, input.folders, from_state);
    requireAgreementWithRecordedResult(plan, from_state, to_state);
    inverse = inverseOf(plan, from_state);
  } catch (error) {
    return { outcome: "failed", error: toRecordedError(error) };
  }

  // The action changed nothing, so its inverse is empty. That is a successful undo with no command to
  // issue, not a failure: the row is already in the state it is being restored to.
  let address: LiveAddress = input.live_address ?? { folder: to_state.folder, uid: to_state.uid, uid_validity: to_state.uid_validity };
  if (inverse.length === 0) {
    return { outcome: "undone", address };
  }

  try {
    await requireUidValidity({ provider: input.provider, validities: input.validities, address });
  } catch (error) {
    return { outcome: "failed", error: toRecordedError(error) };
  }

  // In order, stopping on the first failure. A Gmail trash undo is a move back followed by a label
  // restore; a succeeded move with a failed restore leaves the message correctly filed but unlabelled, so
  // the row stays `failed` with from_state_json intact and a retry can finish the restore.
  for (const mutation of inverse) {
    let outcome: MutationOutcome;
    try {
      outcome = await issueMutation({ provider: input.provider, address, mutation });
    } catch (error) {
      return { outcome: "failed", error: toRecordedError(error) };
    }
    if (outcome.outcome === "failed") {
      return { outcome: "failed", error: outcome.error };
    }
    address = outcome.address;
  }

  return { outcome: "undone", address };
}

async function undoRows(input: {
  rows: UndoableActionRow[];
  flavor: MailboxFlavor;
  provider: MailboxProvider;
  journal: ActionJournal;
}): Promise<UndoResult> {
  const result: UndoResult = { examined: input.rows.length, undone: 0, failed: 0 };
  if (input.rows.length === 0) {
    return result;
  }

  const folders = await resolveActionFolders(input.provider);
  const validities = new Map<string, string>();
  // Keyed by message, not by action: consecutive undos of a chain walk the same message backwards, and
  // each move leaves it at an address no journal row knows about.
  const live_addresses = new Map<string, LiveAddress>();
  const blocked_messages = new Set<string>();

  for (const row of newestFirst(input.rows)) {
    if (blocked_messages.has(row.message_id)) {
      // Skipped rather than attempted. A newer action on this message is still standing, so restoring
      // this older one would produce a state the message was never in.
      await input.journal.markFailed([
        {
          action_id: row.action_id,
          error:
            "a later action on this message could not be undone, so this one was not attempted. Undoing it now would restore an intermediate state rather than the original; retry once the later action is reversed.",
        },
      ]);
      result.failed += 1;
      continue;
    }

    const outcome = await undoRow({
      row,
      flavor: input.flavor,
      provider: input.provider,
      folders,
      live_address: live_addresses.get(row.message_id),
      validities,
    });

    if (outcome.outcome === "failed") {
      await input.journal.markFailed([{ action_id: row.action_id, error: outcome.error }]);
      blocked_messages.add(row.message_id);
      result.failed += 1;
      continue;
    }

    live_addresses.set(row.message_id, outcome.address);
    // Written per row, immediately after its inverse lands, rather than batched at the end: a crash
    // mid-replay must not leave an already-reversed row looking replayable.
    await input.journal.markUndone([{ action_id: row.action_id }]);
    result.undone += 1;
  }

  return result;
}

export async function undoAction(input: UndoActionInput): Promise<UndoResult> {
  if (input.action_id.length === 0) {
    throw new Error("undoAction needs an action id.");
  }
  if (input.mailbox_id.length === 0) {
    throw new Error("undoAction needs a mailbox id: the provider is connected to one server, and undo must reach the server it mutated.");
  }

  const row = await input.journal.loadUndoableAction({ mailbox_id: input.mailbox_id, action_id: input.action_id });
  if (row === null) {
    return { examined: 0, undone: 0, failed: 0 };
  }
  return undoRows({ rows: [row], flavor: input.flavor, provider: input.provider, journal: input.journal });
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
  return undoRows({ rows, flavor: input.flavor, provider: input.provider, journal: input.journal });
}
