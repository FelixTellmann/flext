import { describe, expect, test } from "bun:test";
import {
  DESTRUCTIVE_KINDS as SERVER_DESTRUCTIVE_KINDS,
  ORGANISATIONAL_KINDS as SERVER_ORGANISATIONAL_KINDS,
} from "@server/mail/query/shadow";
import { classifyKind, DESTRUCTIVE_KINDS, ORGANISATIONAL_KINDS, selectApprovalCategory } from "./-shadow-kinds";

// The admin routes carry their own copy of the split because query/shadow.ts holds the db handle (see
// -shadow-kinds.ts). This is the only thing keeping the two spellings honest, and what it protects is the
// approval ceremony: shadow.tsx asks for a typed confirmation before a destructive bulk approval and a
// checkbox before an organisational one, so a kind that drifts between the lists is a deletion approved
// with the gate meant for a folder move.
describe("the destructive/organisational split the routes classify with", () => {
  test("the destructive list matches the server's, member for member", () => {
    expect([...DESTRUCTIVE_KINDS].sort()).toEqual([...SERVER_DESTRUCTIVE_KINDS].sort());
  });

  test("the organisational list matches the server's, member for member", () => {
    expect([...ORGANISATIONAL_KINDS].sort()).toEqual([...SERVER_ORGANISATIONAL_KINDS].sort());
  });

  // Equal lists are not enough on their own: what the screen actually calls is classifyKind, so every kind
  // the server counts as destructive has to come back "destructive" through the function the gate reads.
  test("every kind the server counts as destructive classifies as destructive", () => {
    for (const kind of SERVER_DESTRUCTIVE_KINDS) {
      expect(classifyKind(kind)).toBe("destructive");
    }
  });

  test("every kind the server counts as organisational classifies as organisational", () => {
    for (const kind of SERVER_ORGANISATIONAL_KINDS) {
      expect(classifyKind(kind)).toBe("organisational");
    }
  });

  // A kind in both lists would take whichever branch runs first, which is how a destructive kind acquires
  // an organisational gate without either list looking wrong on its own.
  test("no kind is in both lists", () => {
    expect(DESTRUCTIVE_KINDS.filter((kind) => ORGANISATIONAL_KINDS.includes(kind))).toEqual([]);
  });

  // Anything the two lists do not name is left in place, and "unknown" must land there rather than in a
  // category that implies the mailbox changes.
  test("a kind on neither list is retained, including one no rule can emit yet", () => {
    expect(classifyKind("keep_inbox")).toBe("retained");
    expect(classifyKind("needs_action")).toBe("retained");
    expect(classifyKind("something_a_later_phase_adds")).toBe("retained");
  });
});

// A policy's action is editable after the shadow pass that used it, but its decisions are not rewritten —
// so the two can disagree, and the batch the button promotes is described by the run, not by the policy.
describe("the ceremony a bulk approval demands", () => {
  test("a run that recorded deletions demands the destructive ceremony even after the policy was edited to archive", () => {
    expect(selectApprovalCategory({ destructive_count: 412, policy_action: "archive" })).toBe("destructive");
    expect(selectApprovalCategory({ destructive_count: 1, policy_action: "keep_inbox" })).toBe("destructive");
  });

  test("a run with no deletions falls back to what the policy would do next", () => {
    expect(selectApprovalCategory({ destructive_count: 0, policy_action: "archive" })).toBe("organisational");
    expect(selectApprovalCategory({ destructive_count: 0, policy_action: "keep_inbox" })).toBe("retained");
  });

  test("a policy that deletes keeps the destructive ceremony before it has decided anything", () => {
    expect(selectApprovalCategory({ destructive_count: 0, policy_action: "auto_trash" })).toBe("destructive");
  });
});
