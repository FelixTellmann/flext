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

export const FILE_DEFERRED_REASON =
  "filing is deferred to Phase 5: §6 picks the destination from the client axis with a DKIM-alignment gate, and neither exists yet";

// What a caller may ask for: PolicyAction (rules.ts, which already excludes the sweep kind) plus the `needs_action`
// outcome decide() can return. Derived from rules.ts rather than restated so a new policy action cannot
// appear there without the exhaustiveness check at the bottom of planFor failing to compile.
export type PlanRequestKind = PolicyAction | "needs_action";

export type ExecutableActionKind = Exclude<PlanRequestKind, "keep_inbox" | "needs_action">;

export const EXECUTABLE_ACTION_KINDS = ["archive", "file", "auto_trash"] as const satisfies readonly ExecutableActionKind[];

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
};

export type PlannedAction = {
  outcome: "planned";
  kind: ExecutableActionKind;
  flavor: MailboxFlavor;
  mutation: MailboxMutation;
};

// Not a thrown error and not a silent no-op: the executor has to be able to skip these rows and record
// why it skipped them.
export type DeferredAction = {
  outcome: "deferred";
  kind: ExecutableActionKind;
  flavor: MailboxFlavor;
  reason: string;
};

export type ActionPlan = PlannedAction | DeferredAction;

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

export function planFor(kind: PlanRequestKind, flavor: MailboxFlavor, context: PlanContext): ActionPlan {
  if (kind === "keep_inbox" || kind === "needs_action") {
    throw new Error(
      `planFor("${kind}") is a caller error: ${kind} means the message is left exactly where it is, so there is no mutation to plan and nothing for undo to reverse.`,
    );
  }

  if (kind === "file") {
    return { outcome: "deferred", kind, flavor, reason: FILE_DEFERRED_REASON };
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

// Takes the state recorded in from_state_json, not the plan alone, because only the recorded state knows
// which folder to move back to (§7.2) and which of the touched labels the message actually carried.
// Deferred plans are excluded at the type level: they are never executed, so they can never be undone.
export function inverseOf(plan: PlannedAction, from_state: MailboxState): MailboxMutation {
  const { mutation } = plan;

  if (mutation.verb === "move") {
    return { verb: "move", source_folder: mutation.target_folder, target_folder: from_state.folder };
  }

  const original_labels = requireLabels(from_state);
  return {
    verb: "set_labels",
    add_labels: mutation.remove_labels.filter((label) => original_labels.includes(label)),
    remove_labels: mutation.add_labels.filter((label) => !original_labels.includes(label)),
  };
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
    return { ...state, folder: mutation.target_folder };
  }

  const current_labels = requireLabels(state);
  const remaining = current_labels.filter((label) => !mutation.remove_labels.includes(label));
  return { ...state, labels: normalizeLabels([...remaining, ...mutation.add_labels]) };
}
