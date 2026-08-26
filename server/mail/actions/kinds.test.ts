import { describe, expect, test } from "bun:test";
import {
  applyToState,
  EXECUTABLE_ACTION_KINDS,
  GMAIL_INBOX_LABEL,
  inverseOf,
  isExecutableActionKind,
  type MailboxState,
  NON_ACTION_KINDS,
  type PlanContext,
  type PlannedAction,
  type PlanRequestKind,
  planFor,
} from "@server/mail/actions/kinds";
import { POLICY_ACTIONS } from "@server/mail/classify/rules";
import type { MailboxFlavor } from "@server/mail/types";
import { GMAIL_CANONICAL_FOLDER } from "@server/mail/types";

// Folder names live in the test, never in the module: the caller resolves them from SPECIAL-USE, so the
// module must work with whatever a server calls its Archive and Trash. Deliberately not "Archive".
const GENERIC_ARCHIVE = "Archives/2026";
const GENERIC_TRASH = "Deleted Items";
const GENERIC_FILE = "Clients/Acme";
const GENERIC_QUARANTINE = "INBOX.Quarantine";
const GMAIL_ARCHIVE = "[Gmail]/All Mail";
const GMAIL_TRASH = "[Gmail]/Trash";
// Deliberately not "Clients/Acme": gmail_states[3] already carries that label, and a fixture that
// collides with an existing label would make the round trip for that state a no-op instead of a real
// add-then-remove.
const GMAIL_FILE = "Clients/Beta";
const GMAIL_QUARANTINE = "Quarantine";

// Sorts and de-duplicates independently of the module, so a fixture is already in the canonical form
// applyToState returns and a round trip can be compared with plain deep equality.
function state(folder: string, flags: string[], labels: string[] | null): MailboxState {
  return { folder, flags, labels: labels === null ? null : [...new Set(labels)].sort() };
}

const gmail_states: MailboxState[] = [
  state(GMAIL_CANONICAL_FOLDER, ["\\Seen"], [GMAIL_INBOX_LABEL]),
  state(GMAIL_CANONICAL_FOLDER, [], [GMAIL_INBOX_LABEL, "\\Important", "Work"]),
  state(GMAIL_CANONICAL_FOLDER, ["\\Seen", "\\Flagged"], []),
  state(GMAIL_CANONICAL_FOLDER, [], ["Work", "Clients/Acme"]),
];

const generic_states: MailboxState[] = [
  state("INBOX", ["\\Seen"], null),
  state("INBOX", [], null),
  state("INBOX/Clients", ["\\Answered"], null),
];

function statesFor(flavor: MailboxFlavor): MailboxState[] {
  return flavor === "gmail" ? gmail_states : generic_states;
}

function contextFor(flavor: MailboxFlavor, from_state: MailboxState): PlanContext {
  if (flavor === "gmail") {
    return {
      source_folder: from_state.folder,
      archive_folder: GMAIL_ARCHIVE,
      trash_folder: GMAIL_TRASH,
      file_folder: GMAIL_FILE,
      quarantine_folder: GMAIL_QUARANTINE,
    };
  }
  return {
    source_folder: from_state.folder,
    archive_folder: GENERIC_ARCHIVE,
    trash_folder: GENERIC_TRASH,
    file_folder: GENERIC_FILE,
    quarantine_folder: GENERIC_QUARANTINE,
  };
}

function plannedFor(kind: "archive" | "auto_trash" | "file", flavor: MailboxFlavor, from_state: MailboxState): PlannedAction {
  return planFor(kind, flavor, contextFor(flavor, from_state));
}

// The whole returned sequence, folded in order — never just its first element. Undoing a Gmail trash takes
// a move followed by a label restore, so a helper that applied one mutation would pass while losing every
// label on three of the four mailboxes.
function undo(plan: PlannedAction, from_state: MailboxState, to_state: MailboxState): MailboxState {
  return inverseOf(plan, from_state).reduce((current_state, mutation) => applyToState(mutation, current_state), to_state);
}

const flavors: MailboxFlavor[] = ["gmail", "generic"];

// The load-bearing property, over every kind x flavor x state rather than a few hand-picked examples:
// perform the action against the state the journal recorded, then perform the whole inverse sequence
// against the result, and land back on exactly the state we started from — folder, flags and labels. This
// is the only thing that makes undo correct, and it is asserted rather than assumed because a plan and its
// inverse disagreeing is silent: the mailbox simply ends up somewhere else and no test fails.
describe("every action round-trips through its inverse", () => {
  for (const kind of EXECUTABLE_ACTION_KINDS) {
    for (const flavor of flavors) {
      for (const [index, from_state] of statesFor(flavor).entries()) {
        test(`${flavor} ${kind} on state ${index} restores the original state`, () => {
          const plan = planFor(kind, flavor, contextFor(flavor, from_state));
          const to_state = applyToState(plan.mutation, from_state);

          expect(undo(plan, from_state, to_state)).toEqual(from_state);
        });
      }
    }
  }

  // Guards against the loop above going vacuous: planFor refuses a kind it cannot plan by throwing, so a
  // combination it stops handling disappears from the property silently unless the count is asserted.
  test("planFor produces a plan for every kind x flavor x state the property covers", () => {
    const planned = flavors.flatMap((flavor) =>
      statesFor(flavor).flatMap((from_state) =>
        EXECUTABLE_ACTION_KINDS.map((kind) => planFor(kind, flavor, contextFor(flavor, from_state))),
      ),
    );
    expect(planned.length).toBe((gmail_states.length + generic_states.length) * EXECUTABLE_ACTION_KINDS.length);
  });
});

describe("a Gmail trash loses its labels, so its inverse restores them", () => {
  const from_state = gmail_states[1];
  const plan = plannedFor("auto_trash", "gmail", from_state);
  const to_state = applyToState(plan.mutation, from_state);

  test("the move into Trash drops every user label, the way Gmail does", () => {
    expect(to_state.folder).toBe(GMAIL_TRASH);
    expect(to_state.labels).toEqual([]);
  });

  test("the inverse is a move back followed by a label restore, in that order", () => {
    expect(inverseOf(plan, from_state)).toEqual([
      { verb: "move", source_folder: GMAIL_TRASH, target_folder: GMAIL_CANONICAL_FOLDER },
      { verb: "set_labels", add_labels: from_state.labels ?? [], remove_labels: [] },
    ]);
  });

  // The mutation this ruling exists for. If the restore were dropped, this assertion is what fails.
  test("the move back alone would silently lose the labels", () => {
    const [move_back] = inverseOf(plan, from_state);
    expect(applyToState(move_back, to_state).labels).toEqual([]);
    expect(undo(plan, from_state, to_state).labels).toEqual(from_state.labels);
  });

  test("the restore removes nothing, because the move out of Trash already discards what the move in attached", () => {
    const [, restore] = inverseOf(plan, from_state);
    if (restore.verb !== "set_labels") {
      throw new Error("expected the second mutation to be a label restore");
    }
    expect(restore.remove_labels).toEqual([]);
  });

  test("a Gmail message with no labels needs no restore, and none is invented", () => {
    const unlabelled = gmail_states[2];
    expect(inverseOf(plannedFor("auto_trash", "gmail", unlabelled), unlabelled)).toEqual([
      { verb: "move", source_folder: GMAIL_TRASH, target_folder: GMAIL_CANONICAL_FOLDER },
    ]);
  });

  for (const flavor of flavors) {
    test(`${flavor} auto_trash is a move to the Trash folder the caller resolved`, () => {
      const from_state = statesFor(flavor)[0];
      const expected_trash = flavor === "gmail" ? GMAIL_TRASH : GENERIC_TRASH;
      expect(plannedFor("auto_trash", flavor, from_state).mutation).toEqual({
        verb: "move",
        source_folder: from_state.folder,
        target_folder: expected_trash,
      });
    });
  }

  test("a generic trash inverts with a single move, since a folder server keeps no labels to lose", () => {
    const from_generic = generic_states[0];
    expect(inverseOf(plannedFor("auto_trash", "generic", from_generic), from_generic)).toEqual([
      { verb: "move", source_folder: GENERIC_TRASH, target_folder: "INBOX" },
    ]);
  });
});

describe("archive means one thing per flavor", () => {
  test("Gmail archive drops the \\Inbox label and is never a move", () => {
    const plan = plannedFor("archive", "gmail", gmail_states[0]);
    expect(plan.mutation).toEqual({ verb: "set_labels", add_labels: [], remove_labels: [GMAIL_INBOX_LABEL] });
  });

  test("Gmail archive leaves the folder and the rest of the label set untouched", () => {
    const from_state = gmail_states[1];
    const to_state = applyToState(plannedFor("archive", "gmail", from_state).mutation, from_state);
    expect(to_state.folder).toBe(from_state.folder);
    // Code-unit order, so a backslash-prefixed system label sorts after a plain one.
    expect(to_state.labels).toEqual(["Work", "\\Important"]);
  });

  test("the inverse of a Gmail archive is the single label add that puts \\Inbox back", () => {
    const from_state = gmail_states[0];
    expect(inverseOf(plannedFor("archive", "gmail", from_state), from_state)).toEqual([
      { verb: "set_labels", add_labels: [GMAIL_INBOX_LABEL], remove_labels: [] },
    ]);
  });

  test("generic archive moves to the folder the caller resolved, not to a name this module invented", () => {
    expect(planFor("archive", "generic", contextFor("generic", generic_states[0]))).toEqual({
      outcome: "planned",
      pre_mutations: [],
      kind: "archive",
      flavor: "generic",
      mutation: { verb: "move", source_folder: "INBOX", target_folder: GENERIC_ARCHIVE },
    });
  });

  test("the inverse of a generic archive moves back to the folder from_state recorded, not to the plan's source", () => {
    const plan = planFor("archive", "generic", {
      source_folder: "INBOX",
      archive_folder: GENERIC_ARCHIVE,
      trash_folder: null,
      file_folder: null,
      quarantine_folder: null,
    });
    const recorded = state("INBOX/Clients", [], null);
    expect(inverseOf(plan, recorded)).toEqual([{ verb: "move", source_folder: GENERIC_ARCHIVE, target_folder: "INBOX/Clients" }]);
  });

  test("an archive that removed a label the message never had inverts to nothing at all", () => {
    const from_state = gmail_states[3];
    expect(inverseOf(plannedFor("archive", "gmail", from_state), from_state)).toEqual([]);
  });
});

describe("file means one thing per flavor", () => {
  test("Gmail file adds the destination label and drops \\Inbox, and is never a move", () => {
    const plan = plannedFor("file", "gmail", gmail_states[0]);
    expect(plan.mutation).toEqual({ verb: "set_labels", add_labels: [GMAIL_FILE], remove_labels: [GMAIL_INBOX_LABEL] });
  });

  test("generic file moves from the source folder to the destination the caller resolved", () => {
    expect(planFor("file", "generic", contextFor("generic", generic_states[0]))).toEqual({
      outcome: "planned",
      pre_mutations: [],
      kind: "file",
      flavor: "generic",
      mutation: { verb: "move", source_folder: "INBOX", target_folder: GENERIC_FILE },
    });
  });

  test("a Gmail file round-trips: the inverse restores the label set the message had before filing", () => {
    const from_state = gmail_states[1];
    const plan = plannedFor("file", "gmail", from_state);
    const to_state = applyToState(plan.mutation, from_state);
    expect(undo(plan, from_state, to_state)).toEqual(from_state);
  });

  test("a generic file round-trips: the inverse moves the message back to its source folder", () => {
    const from_state = generic_states[0];
    const plan = plannedFor("file", "generic", from_state);
    const to_state = applyToState(plan.mutation, from_state);
    expect(undo(plan, from_state, to_state)).toEqual(from_state);
  });
});

describe("a missing target folder is rejected, never guessed", () => {
  test("generic archive without an \\Archive folder throws and names SPECIAL-USE", () => {
    expect(() =>
      planFor("archive", "generic", {
        source_folder: "INBOX",
        archive_folder: null,
        trash_folder: GENERIC_TRASH,
        file_folder: null,
        quarantine_folder: null,
      }),
    ).toThrow(/SPECIAL-USE/);
  });

  test("an empty string is treated as no folder at all", () => {
    expect(() =>
      planFor("archive", "generic", {
        source_folder: "INBOX",
        archive_folder: "",
        trash_folder: null,
        file_folder: null,
        quarantine_folder: null,
      }),
    ).toThrow(/SPECIAL-USE/);
  });

  for (const flavor of flavors) {
    test(`${flavor} auto_trash without a \\Trash folder throws`, () => {
      expect(() =>
        planFor("auto_trash", flavor, {
          source_folder: "INBOX",
          archive_folder: GENERIC_ARCHIVE,
          trash_folder: null,
          file_folder: null,
          quarantine_folder: null,
        }),
      ).toThrow(/SPECIAL-USE/);
    });
  }

  for (const flavor of flavors) {
    test(`${flavor} file without a destination folder throws`, () => {
      expect(() =>
        planFor("file", flavor, {
          source_folder: "INBOX",
          archive_folder: GENERIC_ARCHIVE,
          trash_folder: GENERIC_TRASH,
          file_folder: null,
          quarantine_folder: null,
        }),
      ).toThrow(/SPECIAL-USE/);
    });
  }

  test("an inverse is refused the same blank folder the forward plan refuses", () => {
    const from_state = state("INBOX", ["\\Seen"], null);
    const plan = plannedFor("auto_trash", "generic", from_state);

    expect(() => inverseOf(plan, { ...from_state, folder: "" })).toThrow(/no address to be restored to/);
  });
});

describe("keep_inbox and needs_action are not actions", () => {
  for (const kind of NON_ACTION_KINDS) {
    for (const flavor of flavors) {
      test(`${flavor} ${kind} throws rather than returning a no-op plan`, () => {
        expect(() => planFor(kind, flavor, contextFor(flavor, statesFor(flavor)[0]))).toThrow(/caller error/);
      });
    }
  }

  test("neither is reported as executable", () => {
    for (const kind of NON_ACTION_KINDS) {
      expect(isExecutableActionKind(kind)).toBe(false);
    }
  });
});

describe("the kind set cannot drift from the rules engine", () => {
  test("every action a policy can emit is either executable here or an explicit non-action", () => {
    for (const action of POLICY_ACTIONS) {
      const known: readonly string[] = [...EXECUTABLE_ACTION_KINDS, ...NON_ACTION_KINDS];
      expect(known).toContain(action);
    }
  });

  test("purge appears nowhere in the module — §1.7 keeps the irreversible sweep out of this path entirely", async () => {
    const executable: readonly string[] = EXECUTABLE_ACTION_KINDS;
    const non_actions: readonly string[] = NON_ACTION_KINDS;
    expect(executable).not.toContain("purge");
    expect(non_actions).not.toContain("purge");

    const source = await Bun.file(`${import.meta.dir}/kinds.ts`).text();
    const mentions = source.split("purge").length - 1;
    // The one permitted mention is the header comment saying why no plan for it exists.
    expect(mentions).toBe(1);
  });

  test("isExecutableActionKind rejects a kind the Action.kind varchar should never hold", () => {
    expect(isExecutableActionKind("purge")).toBe(false);
    expect(isExecutableActionKind("")).toBe(false);
    expect(isExecutableActionKind("archive")).toBe(true);
  });
});

describe("state model guards", () => {
  test("a label mutation against a server with no label store throws rather than inventing an empty set", () => {
    const plan = plannedFor("archive", "gmail", gmail_states[0]);
    expect(() => applyToState(plan.mutation, state("INBOX", [], null))).toThrow(/label/);
    expect(() => inverseOf(plan, state("INBOX", [], null))).toThrow(/label/);
  });

  test("a move applied to a message that is not in its source folder throws", () => {
    expect(() => applyToState({ verb: "move", source_folder: "INBOX", target_folder: GENERIC_TRASH }, state("Sent", [], null))).toThrow(
      /unrelated messages/,
    );
  });

  test("a move leaves a folder server's null label set null rather than turning it into an empty one", () => {
    const moved = applyToState({ verb: "move", source_folder: "INBOX", target_folder: GENERIC_TRASH }, generic_states[0]);
    expect(moved.labels).toBeNull();
  });

  test("no action touches flags", () => {
    const flagged = state(GMAIL_CANONICAL_FOLDER, ["\\Seen", "\\Flagged"], [GMAIL_INBOX_LABEL]);
    for (const kind of EXECUTABLE_ACTION_KINDS) {
      const plan = planFor(kind, "gmail", contextFor("gmail", flagged));
      const to_state = applyToState(plan.mutation, flagged);
      expect(to_state.flags).toEqual(flagged.flags);
      expect(undo(plan, flagged, to_state).flags).toEqual(flagged.flags);
    }
  });

  test("a request kind narrows to exactly the executable set plus the two non-actions", () => {
    const every_kind: PlanRequestKind[] = ["keep_inbox", "archive", "file", "auto_trash", "needs_action"];
    expect(every_kind.filter(isExecutableActionKind)).toEqual(["archive", "file", "auto_trash"]);
  });
});

describe("quarantine", () => {
  test("generic quarantine moves to the review folder", () => {
    const plan = planFor("quarantine", "generic", {
      source_folder: "INBOX",
      archive_folder: GENERIC_ARCHIVE,
      trash_folder: GENERIC_TRASH,
      file_folder: null,
      quarantine_folder: GENERIC_QUARANTINE,
    });
    expect(plan.mutation).toEqual({ verb: "move", source_folder: "INBOX", target_folder: GENERIC_QUARANTINE });
  });

  // Label swap, not a move — the same reasoning as filing. A move would change the UID and orphan the row.
  test("gmail quarantine swaps labels and keeps the UID", () => {
    const plan = planFor("quarantine", "gmail", {
      source_folder: GMAIL_ARCHIVE,
      archive_folder: GMAIL_ARCHIVE,
      trash_folder: GMAIL_TRASH,
      file_folder: null,
      quarantine_folder: GMAIL_QUARANTINE,
    });
    expect(plan.mutation).toEqual({ verb: "set_labels", add_labels: [GMAIL_QUARANTINE], remove_labels: [GMAIL_INBOX_LABEL] });
  });

  // §D2: a quarantine with no destination must refuse, never fall back to Trash or Junk. Falling back is
  // the one outcome that would turn "reviewable" into "deleted without telling anyone".
  for (const flavor of flavors) {
    test(`${flavor} quarantine without a destination throws rather than guessing`, () => {
      expect(() =>
        planFor("quarantine", flavor, {
          source_folder: "INBOX",
          archive_folder: GENERIC_ARCHIVE,
          trash_folder: GENERIC_TRASH,
          file_folder: null,
          quarantine_folder: null,
        }),
      ).toThrow(/quarantine destination/);
    });
  }
});

describe("set_flags", () => {
  const SEEN = "\\Seen";
  const FLAGGED = "\\Flagged";

  test("adds and removes against the state's own flag set, canonically ordered", () => {
    const before = state("INBOX", [FLAGGED], null);
    const after = applyToState({ verb: "set_flags", add_flags: [SEEN], remove_flags: [] }, before);

    expect(after.flags).toEqual([FLAGGED, SEEN]);
    // Address-preserving by construction: nothing about where the message lives may change.
    expect(after.folder).toBe("INBOX");
    expect(after.labels).toBeNull();
  });

  test("removing a flag the message does not carry is a no-op rather than an error", () => {
    const before = state("INBOX", [SEEN], null);
    const after = applyToState({ verb: "set_flags", add_flags: [], remove_flags: [FLAGGED] }, before);

    expect(after.flags).toEqual([SEEN]);
  });

  test("the inverse of marking an ALREADY-read message read is empty, never 'mark it unread'", () => {
    // The case that matters most for inbox-dwell 1.7: quarantine adds \Seen to every message it moves,
    // including ones the operator had already read. Inverting the instruction rather than the observed
    // change would mark his read mail unread on undo — a visible, wrong mutation on real mail.
    const from_state = state("INBOX", [SEEN], null);
    const plan: PlannedAction = {
      outcome: "planned",
      pre_mutations: [{ verb: "set_flags", add_flags: [SEEN], remove_flags: [] }],
      kind: "quarantine",
      flavor: "generic",
      mutation: { verb: "move", source_folder: "INBOX", target_folder: "INBOX.Quarantine" },
    };

    expect(inverseOf(plan, from_state)).toEqual([{ verb: "move", source_folder: "INBOX.Quarantine", target_folder: "INBOX" }]);
  });

  test("a prefixed plan round-trips folder AND flags together", () => {
    const from_state = state("INBOX", [FLAGGED], null);
    const plan: PlannedAction = {
      outcome: "planned",
      pre_mutations: [{ verb: "set_flags", add_flags: [SEEN], remove_flags: [] }],
      kind: "quarantine",
      flavor: "generic",
      mutation: { verb: "move", source_folder: "INBOX", target_folder: "INBOX.Quarantine" },
    };

    const executed = [...plan.pre_mutations, plan.mutation].reduce(
      (current_state, mutation) => applyToState(mutation, current_state),
      from_state,
    );
    expect(executed).toEqual(state("INBOX.Quarantine", [FLAGGED, SEEN], null));

    expect(undo(plan, from_state, executed)).toEqual(from_state);
  });

  test("the primary mutation's inverse comes first, so the flag restore addresses the restored message", () => {
    const from_state = state("INBOX", [], null);
    const plan: PlannedAction = {
      outcome: "planned",
      pre_mutations: [{ verb: "set_flags", add_flags: [SEEN], remove_flags: [] }],
      kind: "quarantine",
      flavor: "generic",
      mutation: { verb: "move", source_folder: "INBOX", target_folder: "INBOX.Quarantine" },
    };

    expect(inverseOf(plan, from_state)).toEqual([
      { verb: "move", source_folder: "INBOX.Quarantine", target_folder: "INBOX" },
      { verb: "set_flags", add_flags: [], remove_flags: [SEEN] },
    ]);
  });

  test("a move in the prefix is refused — it would invalidate the UIDs addressing the primary mutation", () => {
    const from_state = state("INBOX", [], null);
    const plan: PlannedAction = {
      outcome: "planned",
      pre_mutations: [{ verb: "move", source_folder: "INBOX", target_folder: "Elsewhere" }],
      kind: "archive",
      flavor: "generic",
      mutation: { verb: "move", source_folder: "INBOX", target_folder: "Archive" },
    };

    expect(() => inverseOf(plan, from_state)).toThrow(/a move appeared in PlannedAction.pre_mutations/);
  });

  test("every plan planFor builds today carries an empty prefix", () => {
    for (const flavor of ["gmail", "generic"] as const) {
      for (const from_state of statesFor(flavor)) {
        for (const kind of ["archive", "auto_trash", "file"] as const) {
          expect(plannedFor(kind, flavor, from_state).pre_mutations).toEqual([]);
        }
      }
    }
  });
});
