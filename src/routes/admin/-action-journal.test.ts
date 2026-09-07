import { describe, expect, test } from "bun:test";
import { parseActionState, serializeActionState } from "@server/mail/actions/state";
import { ACTION_STATUS_MEANINGS, ACTION_STATUSES, classifyActionError } from "@server/mail/actions/status";
import type { StateSnapshot } from "./-action-journal";
import {
  changedValues,
  error_meaning_detail,
  error_meaning_headline,
  error_meaning_style,
  journal_status_filters,
  status_label,
  status_meaning,
  status_style,
} from "./-action-journal";

// The screen's honesty depends on two things a typecheck cannot see: that a row with no post-state is not
// rendered as a row that lost everything, and that the status prose still says what the server says.

const inbox_state: StateSnapshot = {
  folder: "INBOX",
  uid: 4211,
  uid_validity: "17",
  flags: ["\\Seen"],
  labels: ["Inbox", "Receipts"],
};

const archive_state: StateSnapshot = {
  folder: "[Gmail]/All Mail",
  uid: 991,
  uid_validity: "17",
  flags: ["\\Seen"],
  labels: ["Receipts"],
};

describe("changedValues", () => {
  // A pending row is journaled BEFORE the mutation, so it has a pre-state and no post-state. Reading that
  // absence as a diff paints every flag and label as removed, on the one status whose whole point is that
  // nothing is known yet.
  test("a pending row — pre-state recorded, no post-state — reports nothing as removed", () => {
    expect(changedValues(inbox_state, null, "flags")).toEqual(new Set<string>());
    expect(changedValues(inbox_state, null, "labels")).toEqual(new Set<string>());
  });

  // markFailed writes no to_state_json either, and the row's own note says the message should still be at
  // the recorded pre-state — so painting that state red as deleted would contradict the row beside it.
  test("a failed row reports nothing as removed", () => {
    expect(changedValues(inbox_state, null, "flags")).toEqual(new Set<string>());
    expect(changedValues(inbox_state, null, "labels")).toEqual(new Set<string>());
  });

  test("a row with no pre-state reports nothing as added", () => {
    expect(changedValues(null, archive_state, "flags")).toEqual(new Set<string>());
    expect(changedValues(null, archive_state, "labels")).toEqual(new Set<string>());
  });

  test("an applied row reports only what actually moved", () => {
    expect(changedValues(inbox_state, archive_state, "labels")).toEqual(new Set(["Inbox"]));
    expect(changedValues(archive_state, inbox_state, "labels")).toEqual(new Set<string>());
    expect(changedValues(inbox_state, archive_state, "flags")).toEqual(new Set<string>());
  });

  test("added flags are reported from the post-state's side", () => {
    const flagged: StateSnapshot = { ...archive_state, flags: ["\\Seen", "\\Flagged"] };
    expect(changedValues(flagged, inbox_state, "flags")).toEqual(new Set(["\\Flagged"]));
    expect(changedValues(inbox_state, flagged, "flags")).toEqual(new Set<string>());
  });

  // Null labels mean the provider has no label concept, not that the labels were cleared.
  test("a provider without labels is not read as having lost them", () => {
    const unlabelled: StateSnapshot = { ...archive_state, labels: null };
    expect(changedValues(unlabelled, inbox_state, "labels")).toEqual(new Set<string>());
    expect(changedValues(inbox_state, unlabelled, "labels")).toEqual(new Set(["Inbox", "Receipts"]));
  });
});

describe("rows whose states came through the real serializer", () => {
  // Hand-built snapshots could drift from what the executor actually writes, so these two go through
  // serializeActionState -> parseActionState, the exact path listActionJournal's rows take.
  const round_trip = (state: StateSnapshot): StateSnapshot => {
    const parsed = parseActionState(serializeActionState(state));
    if (parsed === null) {
      throw new Error("the serializer produced a snapshot its own parser rejects");
    }
    return parsed;
  };

  test("a failed row keeps its recorded flags and labels unmarked", () => {
    const from_state = round_trip(inbox_state);
    // markFailed writes an error and no to_state_json, so the journal row carries null here.
    const to_state = parseActionState(null);
    expect(to_state).toBeNull();
    expect(changedValues(from_state, to_state, "flags")).toEqual(new Set<string>());
    expect(changedValues(from_state, to_state, "labels")).toEqual(new Set<string>());
    expect(from_state.labels).toEqual(["Inbox", "Receipts"]);
  });

  test("an applied row marks exactly the label the move dropped", () => {
    const from_state = round_trip(inbox_state);
    const to_state = round_trip(archive_state);
    expect(changedValues(from_state, to_state, "labels")).toEqual(new Set(["Inbox"]));
    expect(changedValues(to_state, from_state, "labels")).toEqual(new Set<string>());
  });
});

describe("the status vocabulary the screen renders", () => {
  // status.ts is DB-free but reaches the status constants through executor/promote/undo, so importing it
  // into a route would pull the execution stack into the client bundle. The copy is therefore pinned here
  // instead: an edit to either side fails this test rather than leaving two spellings of one meaning.
  test("every meaning matches the server's, verbatim", () => {
    expect(status_meaning).toEqual(ACTION_STATUS_MEANINGS);
  });

  test("every status has a label and a style", () => {
    expect(Object.keys(status_label).sort()).toEqual([...ACTION_STATUSES].sort());
    expect(Object.keys(status_style).sort()).toEqual([...ACTION_STATUSES].sort());
  });

  // Order matters here, not just membership: the tuple is the filter row as rendered, so it is pinned
  // against the server's spelling unsorted.
  test("the filter row is 'all' followed by every status, in the server's order", () => {
    expect([...journal_status_filters]).toEqual(["all", ...ACTION_STATUSES]);
  });

  // Every meaning classifyActionError can emit has to have a presentation, or an error note would render
  // with an undefined headline — the one thing worse than a miscoloured note.
  test("every meaning classifyActionError emits has a headline, a detail and a style", () => {
    const emitted = new Set(
      ["failed", "deferred", "applied", "pending"].map((status) => {
        const note = classifyActionError({ status, error: "boom" });
        if (note === null) {
          throw new Error(`classifyActionError returned null for status ${status}`);
        }
        return note.meaning;
      }),
    );
    expect(emitted).toEqual(new Set(["failed", "deferred", "undo_failed", "unknown"]));
    for (const meaning of emitted) {
      expect(error_meaning_headline[meaning]).toBeString();
      expect(error_meaning_detail[meaning]).toBeString();
      expect(error_meaning_style[meaning]).toBeString();
    }
  });
});
