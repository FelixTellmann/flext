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
const GMAIL_ARCHIVE = "[Gmail]/All Mail";
const GMAIL_TRASH = "[Gmail]/Trash";

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
    return { source_folder: from_state.folder, archive_folder: GMAIL_ARCHIVE, trash_folder: GMAIL_TRASH };
  }
  return { source_folder: from_state.folder, archive_folder: GENERIC_ARCHIVE, trash_folder: GENERIC_TRASH };
}

const flavors: MailboxFlavor[] = ["gmail", "generic"];

// The load-bearing property, over every kind x flavor x state rather than a few hand-picked examples:
// perform the action against the state the journal recorded, then perform the inverse against the result,
// and land back on exactly the state we started from. This is the only thing that makes undo correct, and
// it is asserted rather than assumed because a plan and its inverse disagreeing is silent — the mailbox
// simply ends up somewhere else and no test fails.
describe("every action round-trips through its inverse", () => {
  for (const kind of EXECUTABLE_ACTION_KINDS) {
    for (const flavor of flavors) {
      for (const [index, from_state] of statesFor(flavor).entries()) {
        test(`${flavor} ${kind} on state ${index} restores the original state`, () => {
          const plan = planFor(kind, flavor, contextFor(flavor, from_state));

          if (plan.outcome === "deferred") {
            expect(kind).toBe("file");
            return;
          }

          const to_state = applyToState(plan.mutation, from_state);
          const restored = applyToState(inverseOf(plan, from_state), to_state);

          expect(restored).toEqual(from_state);
        });
      }
    }
  }

  test("the property covered at least one planned action per flavor", () => {
    const planned = flavors.flatMap((flavor) =>
      statesFor(flavor).flatMap((from_state) =>
        EXECUTABLE_ACTION_KINDS.map((kind) => planFor(kind, flavor, contextFor(flavor, from_state))).filter(
          (plan) => plan.outcome === "planned",
        ),
      ),
    );
    expect(planned.length).toBe((gmail_states.length + generic_states.length) * 2);
  });
});

describe("archive means one thing per flavor", () => {
  test("Gmail archive drops the \\Inbox label and is never a move", () => {
    const plan = planFor("archive", "gmail", contextFor("gmail", gmail_states[0]));
    expect(plan.outcome).toBe("planned");
    if (plan.outcome !== "planned") {
      return;
    }
    expect(plan.mutation).toEqual({ verb: "set_labels", add_labels: [], remove_labels: [GMAIL_INBOX_LABEL] });
  });

  test("Gmail archive leaves the folder and the UID-bearing location untouched", () => {
    const from_state = gmail_states[1];
    const plan = planFor("archive", "gmail", contextFor("gmail", from_state));
    if (plan.outcome !== "planned") {
      throw new Error("expected a planned action");
    }
    const to_state = applyToState(plan.mutation, from_state);
    expect(to_state.folder).toBe(from_state.folder);
    // Code-unit order, so a backslash-prefixed system label sorts after a plain one.
    expect(to_state.labels).toEqual(["Work", "\\Important"]);
  });

  test("generic archive moves to the folder the caller resolved, not to a name this module invented", () => {
    const plan = planFor("archive", "generic", contextFor("generic", generic_states[0]));
    expect(plan).toEqual({
      outcome: "planned",
      kind: "archive",
      flavor: "generic",
      mutation: { verb: "move", source_folder: "INBOX", target_folder: GENERIC_ARCHIVE },
    });
  });

  test("the inverse of a generic archive moves back to the folder from_state recorded, not to the plan's source", () => {
    const plan = planFor("archive", "generic", { source_folder: "INBOX", archive_folder: GENERIC_ARCHIVE, trash_folder: null });
    if (plan.outcome !== "planned") {
      throw new Error("expected a planned action");
    }
    const recorded = state("INBOX/Clients", [], null);
    expect(inverseOf(plan, recorded)).toEqual({ verb: "move", source_folder: GENERIC_ARCHIVE, target_folder: "INBOX/Clients" });
  });

  test("the inverse of a Gmail archive never adds \\Inbox to a message that did not carry it", () => {
    const from_state = gmail_states[3];
    const plan = planFor("archive", "gmail", contextFor("gmail", from_state));
    if (plan.outcome !== "planned") {
      throw new Error("expected a planned action");
    }
    expect(inverseOf(plan, from_state)).toEqual({ verb: "set_labels", add_labels: [], remove_labels: [] });
  });
});

describe("auto_trash moves on both flavors and stays reversible", () => {
  for (const flavor of flavors) {
    test(`${flavor} auto_trash is a move to the caller's Trash whose inverse moves back`, () => {
      const from_state = statesFor(flavor)[0];
      const plan = planFor("auto_trash", flavor, contextFor(flavor, from_state));
      if (plan.outcome !== "planned") {
        throw new Error("expected a planned action");
      }
      const expected_trash = flavor === "gmail" ? GMAIL_TRASH : GENERIC_TRASH;
      expect(plan.mutation).toEqual({ verb: "move", source_folder: from_state.folder, target_folder: expected_trash });
      expect(inverseOf(plan, from_state)).toEqual({ verb: "move", source_folder: expected_trash, target_folder: from_state.folder });
    });
  }
});

describe("file is deferred to Phase 5 rather than executed or thrown", () => {
  for (const flavor of flavors) {
    test(`${flavor} file returns a deferred plan the executor can skip and report`, () => {
      const plan = planFor("file", flavor, contextFor(flavor, statesFor(flavor)[0]));
      expect(plan.outcome).toBe("deferred");
      if (plan.outcome !== "deferred") {
        return;
      }
      expect(plan.kind).toBe("file");
      expect(plan.reason).toContain("Phase 5");
    });
  }

  test("file is still deferred when a folder is available, so no target can be silently assumed", () => {
    const plan = planFor("file", "generic", { source_folder: "INBOX", archive_folder: GENERIC_ARCHIVE, trash_folder: GENERIC_TRASH });
    expect(plan.outcome).toBe("deferred");
  });
});

describe("a missing target folder is rejected, never guessed", () => {
  test("generic archive without an \\Archive folder throws and names SPECIAL-USE", () => {
    expect(() => planFor("archive", "generic", { source_folder: "INBOX", archive_folder: null, trash_folder: GENERIC_TRASH })).toThrow(
      /SPECIAL-USE/,
    );
  });

  test("an empty string is treated as no folder at all", () => {
    expect(() => planFor("archive", "generic", { source_folder: "INBOX", archive_folder: "", trash_folder: null })).toThrow(/SPECIAL-USE/);
  });

  for (const flavor of flavors) {
    test(`${flavor} auto_trash without a \\Trash folder throws`, () => {
      expect(() => planFor("auto_trash", flavor, { source_folder: "INBOX", archive_folder: GENERIC_ARCHIVE, trash_folder: null })).toThrow(
        /SPECIAL-USE/,
      );
    });
  }
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
    const plan = planFor("archive", "gmail", contextFor("gmail", gmail_states[0]));
    if (plan.outcome !== "planned") {
      throw new Error("expected a planned action");
    }
    expect(() => applyToState(plan.mutation, state("INBOX", [], null))).toThrow(/label/);
    expect(() => inverseOf(plan, state("INBOX", [], null))).toThrow(/label/);
  });

  test("a move applied to a message that is not in its source folder throws", () => {
    expect(() => applyToState({ verb: "move", source_folder: "INBOX", target_folder: GENERIC_TRASH }, state("Sent", [], null))).toThrow(
      /unrelated messages/,
    );
  });

  test("no action touches flags", () => {
    const flagged = state(GMAIL_CANONICAL_FOLDER, ["\\Seen", "\\Flagged"], [GMAIL_INBOX_LABEL]);
    for (const kind of EXECUTABLE_ACTION_KINDS) {
      const plan = planFor(kind, "gmail", contextFor("gmail", flagged));
      if (plan.outcome !== "planned") {
        continue;
      }
      expect(applyToState(plan.mutation, flagged).flags).toEqual(flagged.flags);
    }
  });

  test("a request kind narrows to exactly the executable set plus the two non-actions", () => {
    const every_kind: PlanRequestKind[] = ["keep_inbox", "archive", "file", "auto_trash", "needs_action"];
    expect(every_kind.filter(isExecutableActionKind)).toEqual(["archive", "file", "auto_trash"]);
  });
});
