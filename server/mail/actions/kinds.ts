import type { PolicyAction } from "@server/mail/classify/rules";
import type { MailboxFlavor } from "@server/mail/types";

// Every action and its inverse are defined here, in one place, because Phase 3 was bitten five times by
// one semantic acquiring two spellings in two files with nothing forcing them to agree. If `archive`
// meant "drop the \Inbox label" in the executor and "move to the Archive folder" in undo, undo would
// restore the wrong thing and nothing would fail loudly. The executor, undo and the state snapshot all
// import from here rather than restating what an action does.
//
// Pure by construction: no IO, no provider, no database. Target folders are resolved by the caller from
// IMAP SPECIAL-USE (\Archive, \Trash) and handed in through PlanContext, so no folder name is ever
// hardcoded here — "Archive" and "[Gmail]/Trash" are server facts, not constants.
//
// `purge` is deliberately absent in every form: §1.7 runs the irreversible sweep as a separate scheduled
// job (Phase 8), so no plan for it may exist to be executed by accident.

// The wire form of Gmail's inbox label. Written "\\Inbox" in source, `\Inbox` on the wire, matching the
// \Sent token server/mail/query/signal-sql.ts already tests Message.labels against.
export const GMAIL_INBOX_LABEL = "\\Inbox";

// What a caller may ask for: PolicyAction (rules.ts, which already excludes the sweep kind) plus the `needs_action`
// outcome decide() can return. Derived from rules.ts rather than restated so a new policy action cannot
// appear there without the exhaustiveness check at the bottom of planFor failing to compile.
// `quarantine` is listed explicitly rather than arriving through PolicyAction, and the difference is the
// point: a policy can never name it (rules.ts excludes it), because quarantine is what happens when no
// policy names the sender at all. It is still a plannable, executable kind — just one only decide() can
// ask for.
export type PlanRequestKind = PolicyAction | "quarantine" | "needs_action";

export type ExecutableActionKind = Exclude<PlanRequestKind, "keep_inbox" | "needs_action">;

export const EXECUTABLE_ACTION_KINDS = ["archive", "file", "quarantine", "auto_trash"] as const satisfies readonly ExecutableActionKind[];

// The one spelling of the quarantine kind and of the single logical path every quarantined message goes
// to. A logical path rather than a SPECIAL-USE name because no such attribute exists for "review this":
// the folder is resolved and created by the same resolver filing uses, under the same namespace root, so
// a quarantine folder cannot land somewhere filing would not have been allowed to put one.
export const QUARANTINE_KIND = "quarantine" as const satisfies ExecutableActionKind;
export const QUARANTINE_LOGICAL_PATH = "Quarantine";

// The one spelling of the filing kind. Task 9's transition out of `deferred` is guarded on it, and a
// literal in that WHERE clause is exactly the two-spellings shape this module exists to prevent.
export const FILE_KIND = "file" as const satisfies ExecutableActionKind;

// Not "actions that happen to do nothing" — decisions to leave the message exactly where it is. Asking
// for a plan for one is a caller bug, so planFor throws rather than handing back a no-op the executor
// would journal as if a mutation had been considered.
export const NON_ACTION_KINDS = ["keep_inbox", "needs_action"] as const satisfies readonly PlanRequestKind[];

// The two verbs map one-to-one onto the mutating provider methods (moveMessages, setLabels), so the plan
// names the command the executor will issue rather than an abstraction over it.
export type MailboxMutation =
  | { verb: "move"; source_folder: string; target_folder: string }
  | { verb: "set_labels"; add_labels: string[]; remove_labels: string[] };

// The state an inverse has to restore. UID is deliberately not part of it: a move invalidates the source
// UID and the destination UID is knowable only from COPYUID, so an undo cannot restore a UID and must not
// claim to. The journal row records UIDs separately, for addressing; this is what round-trips.
// `labels` is null for a server that is not a label store, which is not the same as a message with no
// labels — a label mutation against null is a caller bug, not an empty set.
export type MailboxState = {
  folder: string;
  flags: string[];
  labels: string[] | null;
};

export type PlanContext = {
  source_folder: string;
  archive_folder: string | null;
  trash_folder: string | null;
  // The destination for `file`, already resolved to a real folder on this server by
  // server/mail/filing/resolver.ts. Null carries the same meaning the other two do: the caller could not
  // name it, so planFor refuses rather than guessing — this module never learns what a client is.
  file_folder: string | null;
  // Where a first contact goes to be reviewed. Null means the caller could not name it, and planFor then
  // refuses exactly as it does for the others — a quarantine with no destination must not fall back to
  // Trash or to Junk, which is the whole point of the spec's D2.
  quarantine_folder: string | null;
};

export type PlannedAction = {
  outcome: "planned";
  kind: ExecutableActionKind;
  flavor: MailboxFlavor;
  mutation: MailboxMutation;
};

export function isExecutableActionKind(raw: string): raw is ExecutableActionKind {
  return EXECUTABLE_ACTION_KINDS.some((kind) => kind === raw);
}

function requireTargetFolder(target: string | null, kind: ExecutableActionKind, special_use: string): string {
  if (target === null || target.length === 0) {
    throw new Error(
      `planFor("${kind}") needs the ${special_use} folder, and the caller supplied none. Resolve it from the server's SPECIAL-USE attributes and pass it in PlanContext — this module never guesses a folder name.`,
    );
  }
  return target;
}

function requireLabels(state: MailboxState): string[] {
  if (state.labels === null) {
    throw new Error(
      'a label mutation was applied to a state with no label set. Label operations belong to flavor "gmail" only; a generic IMAP server has folders, not labels.',
    );
  }
  return state.labels;
}

// A Gmail label set is a set, not a sequence, so the canonical form is sorted and de-duplicated. Without
// it a round trip that removes \Inbox and adds it back returns the same set in a different order, and
// to_state_json would differ run to run for an identical mailbox state.
function normalizeLabels(labels: string[]): string[] {
  return [...new Set(labels)].sort();
}

// Every kind this accepts is either planned or refused by a throw. There is no third outcome: Phase 4's
// deferred plan carried FILE_DEFERRED_REASON, and Phase 5 made filing real, which removed the last thing
// that could build one. Filing is now held back by §6's gate in the executor, on data about the message,
// which is not something a pure function over (kind, flavor, context) can decide.
export function planFor(kind: PlanRequestKind, flavor: MailboxFlavor, context: PlanContext): PlannedAction {
  if (kind === "keep_inbox" || kind === "needs_action") {
    throw new Error(
      `planFor("${kind}") is a caller error: ${kind} means the message is left exactly where it is, so there is no mutation to plan and nothing for undo to reverse.`,
    );
  }

  // §6: filing means the message leaves the inbox and lands in its destination. On a generic server a
  // move out of the source folder does both at once.
  //
  // On Gmail it must NOT be a move. The canonical folder is [Gmail]/All Mail, which a message cannot
  // meaningfully be moved out of, and applyToState models a Gmail move as a label rewrite that discards
  // every user label — so a move would file the message by destroying the labels the operator filed it
  // under. Adding the destination label and dropping \Inbox is the same semantic with a stable UID,
  // which matters because `message` rows and undo are keyed on folder plus UID.
  //
  // The inverse needs no new code: inverseOf's set_labels branch computes
  // add_labels = mutation.remove_labels ∩ original and remove_labels = mutation.add_labels \ original,
  // which removes the destination label and restores \Inbox exactly.
  if (kind === "file" && flavor === "gmail") {
    return {
      outcome: "planned",
      kind,
      flavor,
      mutation: {
        verb: "set_labels",
        add_labels: [requireTargetFolder(context.file_folder, kind, "filing destination")],
        remove_labels: [GMAIL_INBOX_LABEL],
      },
    };
  }

  if (kind === "file") {
    return {
      outcome: "planned",
      kind,
      flavor,
      mutation: {
        verb: "move",
        source_folder: context.source_folder,
        target_folder: requireTargetFolder(context.file_folder, kind, "filing destination"),
      },
    };
  }

  // Quarantine takes archive's shape, not trash's: on Gmail it is a label swap so the UID stays stable,
  // and on a generic server it is a move. It is deliberately NOT modelled on auto_trash — §D2 keeps it a
  // reviewable folder the operator reads, so it must round-trip through undo as cleanly as filing does.
  if (kind === "quarantine" && flavor === "gmail") {
    return {
      outcome: "planned",
      kind,
      flavor,
      mutation: {
        verb: "set_labels",
        add_labels: [requireTargetFolder(context.quarantine_folder, kind, "quarantine destination")],
        remove_labels: [GMAIL_INBOX_LABEL],
      },
    };
  }

  if (kind === "quarantine") {
    return {
      outcome: "planned",
      kind,
      flavor,
      mutation: {
        verb: "move",
        source_folder: context.source_folder,
        target_folder: requireTargetFolder(context.quarantine_folder, kind, "quarantine destination"),
      },
    };
  }

  // §7.2: on Gmail, archive is not a move. Dropping \Inbox leaves the message in [Gmail]/All Mail with a
  // stable UID, and the inverse adds the label back. Moving instead would change the UID and orphan the
  // row — which is exactly the drift this module exists to prevent.
  if (kind === "archive" && flavor === "gmail") {
    return {
      outcome: "planned",
      kind,
      flavor,
      mutation: { verb: "set_labels", add_labels: [], remove_labels: [GMAIL_INBOX_LABEL] },
    };
  }

  if (kind === "archive") {
    return {
      outcome: "planned",
      kind,
      flavor,
      mutation: {
        verb: "move",
        source_folder: context.source_folder,
        target_folder: requireTargetFolder(context.archive_folder, kind, "\\Archive"),
      },
    };
  }

  // Trash is a move on both flavors: §7.2 carves out only archive as a Gmail label operation, and §1.7
  // keeps Trash reversible for the server's retention window, which is what makes the inverse meaningful.
  if (kind === "auto_trash") {
    return {
      outcome: "planned",
      kind,
      flavor,
      mutation: {
        verb: "move",
        source_folder: context.source_folder,
        target_folder: requireTargetFolder(context.trash_folder, kind, "\\Trash"),
      },
    };
  }

  const unhandled: never = kind;
  throw new Error(`planFor received an action kind with no plan and no explicit refusal: ${String(unhandled)}`);
}

// A sequence, not a single command: undoing a Gmail trash takes two, because the move into Trash drops
// every user label server-side and moving back restores only the folder. §7.3 says undo "issues the
// inverse" without promising it is one IMAP command, §1.7 lists trash as reversible, and from_state_json
// records labels precisely so they can be put back — capturing them and then discarding them at undo time
// would make the capture pointless. Three of the four mailboxes here are Gmail, so a folder-only inverse
// would be correct on generic and silently lossy on nearly all real traffic.
//
// Takes the state recorded in from_state_json, not the plan alone, because only the recorded state knows
// which folder to move back to (§7.2) and which labels the message actually carried. A mutation that would
// change nothing is left out rather than issued as an empty command.
export function inverseOf(plan: PlannedAction, from_state: MailboxState): MailboxMutation[] {
  const { mutation } = plan;

  // Symmetric to requireTargetFolder: planFor refuses to move a message to a folder the caller could not
  // name, so undo must refuse to move it back to one either. A blank folder here would issue a move to ""
  // — a mutation this module would have rejected in the forward direction.
  if (from_state.folder.length === 0) {
    throw new Error(
      "inverseOf was given a state with an empty folder, so the message has no address to be restored to. from_state_json is written by server/mail/actions/state.ts, which refuses to record a blank folder; an empty one here means the snapshot was built somewhere else or damaged in storage.",
    );
  }

  if (mutation.verb === "move") {
    const move_back: MailboxMutation = { verb: "move", source_folder: mutation.target_folder, target_folder: from_state.folder };

    if (from_state.labels === null || from_state.labels.length === 0) {
      return [move_back];
    }

    // Order is load-bearing: put the message back where it belongs, then re-label it there. remove_labels
    // is empty because the move back out of Trash already discards whatever the server attached on the way
    // in — naming a token this module never wrote would be asserting a server fact it cannot verify.
    return [move_back, { verb: "set_labels", add_labels: [...from_state.labels], remove_labels: [] }];
  }

  const original_labels = requireLabels(from_state);
  const restore = {
    verb: "set_labels" as const,
    add_labels: mutation.remove_labels.filter((label) => original_labels.includes(label)),
    remove_labels: mutation.add_labels.filter((label) => !original_labels.includes(label)),
  };

  if (restore.add_labels.length === 0 && restore.remove_labels.length === 0) {
    return [];
  }
  return [restore];
}

// The pure model of what a mutation does to a message, so the executor can compute to_state_json and undo
// can predict the restored state from the same definition the plan came from instead of a second one.
export function applyToState(mutation: MailboxMutation, state: MailboxState): MailboxState {
  if (mutation.verb === "move") {
    // The message must actually be where the command addresses it. A batch built for one folder and run
    // against another would move whatever happens to hold those UIDs there.
    if (state.folder !== mutation.source_folder) {
      throw new Error(
        `a move out of "${mutation.source_folder}" was applied to a message in "${state.folder}". The UIDs in a move address one folder, so running it against another mutates unrelated messages.`,
      );
    }
    // On a label store a move is a label rewrite, not a relocation: the destination becomes the only thing
    // the message is filed under and every user label is gone. That is what makes a lone move-back lossy,
    // and modelling it here is what makes the restoring set_labels load-bearing in the round-trip test
    // rather than decorative. Both moves this module produces — into Trash, and undo's move back out —
    // leave a Gmail message with no user labels.
    const labels: string[] | null = state.labels === null ? null : [];
    return { ...state, folder: mutation.target_folder, labels };
  }

  const current_labels = requireLabels(state);
  const remaining = current_labels.filter((label) => !mutation.remove_labels.includes(label));
  return { ...state, labels: normalizeLabels([...remaining, ...mutation.add_labels]) };
}
