import { describe, expect, test } from "bun:test";
import type { AutonomyPort, AutoPolicyRow, PolicyForGate, PromoteAutoPoliciesInput, PromotionPort } from "@server/mail/actions/autonomy";
import { demotePolicyAutonomy, promoteAutoPolicies, promotePolicyAutonomy } from "@server/mail/actions/autonomy";
import type { ActionJournal, ActionPromotionLookup } from "@server/mail/actions/executor";

const MAILBOX_ID = "mailbox-1";
const BATCH_SIZE = 100;

type FakeActionRow = {
  action_id: string;
  mailbox_id: string;
  sender_policy_id: string;
  status: string;
};

type FakePolicyRow = {
  sender_policy_id: string;
  autonomy: "shadow" | "auto";
  suspended_at: Date | null;
};

function shadowRow(action_id: string, sender_policy_id: string, overrides: Partial<FakeActionRow> = {}): FakeActionRow {
  return { action_id, mailbox_id: MAILBOX_ID, sender_policy_id, status: "shadow", ...overrides };
}

function unsupported(name: string): never {
  throw new Error(`${name} is not part of this fixture`);
}

function createFakeJournal(input: { events: string[]; seed: FakeActionRow[] }): ActionJournal & { rows: Map<string, FakeActionRow> } {
  const rows = new Map(input.seed.map((row) => [row.action_id, { ...row }]));

  return {
    rows,

    loadShadowActionsByPolicy: async (query) => {
      input.events.push(`load_shadow_by_policy ${query.sender_policy_id}`);
      const matches: ActionPromotionLookup[] = [];
      for (const row of rows.values()) {
        if (row.status !== "shadow" || row.mailbox_id !== query.mailbox_id || row.sender_policy_id !== query.sender_policy_id) {
          continue;
        }
        matches.push({ action_id: row.action_id, mailbox_id: row.mailbox_id, status: row.status });
      }
      return matches.slice(0, query.batch_size);
    },

    // Mirrors journal.ts's `WHERE status = 'shadow'` guard AND its return value: only a row still at
    // "shadow" moves, and only the ids that moved come back — the fixture's stand-in for affectedRows.
    promoteShadowActions: async (entries) => {
      input.events.push(`promote ${entries.map((entry) => entry.action_id).join(",")}`);
      const promoted_action_ids: string[] = [];
      for (const entry of entries) {
        const row = rows.get(entry.action_id);
        if (row === undefined) {
          throw new Error(`fixture asked to promote unknown action ${entry.action_id}`);
        }
        if (row.status === "shadow") {
          row.status = "pending";
          promoted_action_ids.push(entry.action_id);
        }
      }
      return promoted_action_ids;
    },

    loadPendingActions: async () => unsupported("loadPendingActions"),
    recordFromState: async () => unsupported("recordFromState"),
    recordSelfMarkedRead: async () => unsupported("recordSelfMarkedRead"),
    loadFilingBindings: async () => unsupported("loadFilingBindings"),
    markApplied: async () => unsupported("markApplied"),
    markFailed: async () => unsupported("markFailed"),
    markDeferred: async () => unsupported("markDeferred"),
    loadActionForUndo: async () => unsupported("loadActionForUndo"),
    loadUndoableActionsByPolicy: async () => unsupported("loadUndoableActionsByPolicy"),
    markUndone: async () => unsupported("markUndone"),
    recordUndoFailure: async () => unsupported("recordUndoFailure"),
    loadActionForPromotion: async () => unsupported("loadActionForPromotion"),
    resolveFilingActions: async () => unsupported("resolveFilingActions"),
  };
}

// Mirrors the WHERE clause createDatabaseAutonomyPort issues against SenderPolicy — `autonomy = 'auto'
// AND suspendedAt IS NULL` (server/mail/actions/autonomy.ts) — rather than reaching the real
// drizzle-backed implementation: a test that did would query production's live sender policies.
function createFakePort(input: { events: string[]; policies: FakePolicyRow[] }): AutonomyPort {
  return {
    loadAutoPolicies: async () => {
      input.events.push("load_auto_policies");
      const eligible: AutoPolicyRow[] = [];
      for (const policy of input.policies) {
        if (policy.autonomy === "auto" && policy.suspended_at === null) {
          eligible.push({ sender_policy_id: policy.sender_policy_id });
        }
      }
      return eligible;
    },
  };
}

function promoteInput(overrides: Partial<PromoteAutoPoliciesInput> = {}): Omit<PromoteAutoPoliciesInput, "port" | "journal"> {
  return { mailbox_id: MAILBOX_ID, batch_size: BATCH_SIZE, ...overrides };
}

describe("promoteAutoPolicies (Task 7)", () => {
  test("an auto policy's shadow rows are promoted and their ids returned", async () => {
    const events: string[] = [];
    const journal = createFakeJournal({
      events,
      seed: [shadowRow("action-1", "policy-auto"), shadowRow("action-2", "policy-auto")],
    });
    const port = createFakePort({ events, policies: [{ sender_policy_id: "policy-auto", autonomy: "auto", suspended_at: null }] });

    const promoted = await promoteAutoPolicies({ ...promoteInput(), port, journal });

    expect(promoted.slice().sort()).toEqual(["action-1", "action-2"]);
    expect(journal.rows.get("action-1")?.status).toBe("pending");
    expect(journal.rows.get("action-2")?.status).toBe("pending");
  });

  test("a shadow policy's rows are NOT promoted", async () => {
    const events: string[] = [];
    const journal = createFakeJournal({ events, seed: [shadowRow("action-1", "policy-shadow")] });
    const port = createFakePort({ events, policies: [{ sender_policy_id: "policy-shadow", autonomy: "shadow", suspended_at: null }] });

    const promoted = await promoteAutoPolicies({ ...promoteInput(), port, journal });

    expect(promoted).toEqual([]);
    expect(journal.rows.get("action-1")?.status).toBe("shadow");
    // The policy was never even a candidate: promotePolicyActions's guarded read was never reached for it.
    expect(events).not.toContain("load_shadow_by_policy policy-shadow");
  });

  // THE CASE THAT MATTERS. Rescue detection runs earlier in the same sync and may have just suspended this
  // policy; that suspension must take effect in this run, not the next one — the whole point of Requirement
  // 3 (the guard lives in port.loadAutoPolicies's SQL, not a filter this function applies itself).
  test("a suspended auto policy's rows are NOT promoted", async () => {
    const events: string[] = [];
    const journal = createFakeJournal({ events, seed: [shadowRow("action-1", "policy-suspended")] });
    const port = createFakePort({
      events,
      policies: [{ sender_policy_id: "policy-suspended", autonomy: "auto", suspended_at: new Date("2026-08-18T00:00:00Z") }],
    });

    const promoted = await promoteAutoPolicies({ ...promoteInput(), port, journal });

    expect(promoted).toEqual([]);
    expect(journal.rows.get("action-1")?.status).toBe("shadow");
    expect(events).not.toContain("load_shadow_by_policy policy-suspended");
  });

  test("an applied row is untouched", async () => {
    const events: string[] = [];
    const journal = createFakeJournal({ events, seed: [shadowRow("action-1", "policy-auto", { status: "applied" })] });
    const port = createFakePort({ events, policies: [{ sender_policy_id: "policy-auto", autonomy: "auto", suspended_at: null }] });

    const promoted = await promoteAutoPolicies({ ...promoteInput(), port, journal });

    expect(promoted).toEqual([]);
    expect(journal.rows.get("action-1")?.status).toBe("applied");
  });

  test("a second run promotes nothing new", async () => {
    const events: string[] = [];
    const journal = createFakeJournal({ events, seed: [shadowRow("action-1", "policy-auto")] });
    const port = createFakePort({ events, policies: [{ sender_policy_id: "policy-auto", autonomy: "auto", suspended_at: null }] });

    const first = await promoteAutoPolicies({ ...promoteInput(), port, journal });
    const second = await promoteAutoPolicies({ ...promoteInput(), port, journal });

    expect(first).toEqual(["action-1"]);
    expect(second).toEqual([]);
    expect(journal.rows.get("action-1")?.status).toBe("pending");
  });

  test("with no auto policies at all, the return is an empty array and nothing is written", async () => {
    const events: string[] = [];
    const journal = createFakeJournal({ events, seed: [shadowRow("action-1", "policy-shadow")] });
    const port = createFakePort({ events, policies: [] });

    const promoted = await promoteAutoPolicies({ ...promoteInput(), port, journal });

    expect(promoted).toEqual([]);
    expect(journal.rows.get("action-1")?.status).toBe("shadow");
    // No promotion write, and no read either: with zero eligible policies the loop over them never runs.
    expect(events).toEqual(["load_auto_policies"]);
  });

  // batch_size was spent PER POLICY while the executor spends it as a TOTAL, so two auto policies with
  // more rows between them than the batch promoted more than one run could ever execute. The surplus
  // stranded permanently: promotion reads only `shadow` rows, so a row left `pending` and unexecuted is
  // never re-promoted, never appears in a future id list, and by then looks exactly like a row the
  // operator approved by hand — which the scheduled sync must never touch.
  test("the batch is a TOTAL budget across policies, not a per-policy one", async () => {
    const events: string[] = [];
    const journal = createFakeJournal({
      events,
      seed: [shadowRow("a-1", "policy-a"), shadowRow("a-2", "policy-a"), shadowRow("b-1", "policy-b"), shadowRow("b-2", "policy-b")],
    });
    const port = createFakePort({
      events,
      policies: [
        { sender_policy_id: "policy-a", autonomy: "auto", suspended_at: null },
        { sender_policy_id: "policy-b", autonomy: "auto", suspended_at: null },
      ],
    });

    const promoted = await promoteAutoPolicies({ ...promoteInput({ batch_size: 3 }), port, journal });

    expect(promoted).toHaveLength(3);
    const still_shadow = ["a-1", "a-2", "b-1", "b-2"].filter((id) => journal.rows.get(id)?.status === "shadow");
    expect(still_shadow).toHaveLength(1);
  });

  test("a policy whose rows would exceed what is left of the budget promotes only the remainder", async () => {
    const events: string[] = [];
    const journal = createFakeJournal({
      events,
      seed: [shadowRow("a-1", "policy-a"), shadowRow("b-1", "policy-b"), shadowRow("b-2", "policy-b")],
    });
    const port = createFakePort({
      events,
      policies: [
        { sender_policy_id: "policy-a", autonomy: "auto", suspended_at: null },
        { sender_policy_id: "policy-b", autonomy: "auto", suspended_at: null },
      ],
    });

    const promoted = await promoteAutoPolicies({ ...promoteInput({ batch_size: 2 }), port, journal });

    expect(promoted).toEqual(["a-1", "b-1"]);
    expect(journal.rows.get("b-2")?.status).toBe("shadow");
  });

  // THE DOUBLE-MOVE CASE. The sync takes no lock and fires every fifteen minutes, so two runs overlap and
  // both read the same shadow rows. The returned ids are the executor's entire input, so if both runs
  // returned what they READ, both would move the same messages on a live IMAP server. Only the run whose
  // guarded UPDATE actually matched may claim a row — which is what makes these two sets disjoint.
  test("two concurrent promotions return disjoint id sets, and between them claim every row exactly once", async () => {
    const events: string[] = [];
    const journal = createFakeJournal({
      events,
      seed: [shadowRow("action-1", "policy-auto"), shadowRow("action-2", "policy-auto")],
    });
    const port = createFakePort({ events, policies: [{ sender_policy_id: "policy-auto", autonomy: "auto", suspended_at: null }] });

    const [first, second] = await Promise.all([
      promoteAutoPolicies({ ...promoteInput(), port, journal }),
      promoteAutoPolicies({ ...promoteInput(), port, journal }),
    ]);

    expect(first.filter((id) => second.includes(id))).toEqual([]);
    expect([...first, ...second].sort()).toEqual(["action-1", "action-2"]);
    expect(journal.rows.get("action-1")?.status).toBe("pending");
    expect(journal.rows.get("action-2")?.status).toBe("pending");
  });
});

// ─── Task 8: promotePolicyAutonomy / demotePolicyAutonomy ────────────────────

type FakePromotedPolicy = { autonomy: "shadow" | "auto"; autonomy_promoted_at: Date | null };

function createFakePromotionPort(input: {
  events: string[];
  policy: PolicyForGate | null;
  decisions_since?: number;
  rescues_since?: number;
  mailboxes_missing_retention?: string[];
  written: Map<string, FakePromotedPolicy>;
}): PromotionPort {
  return {
    loadPolicy: async (sender_policy_id) => {
      input.events.push(`load_policy ${sender_policy_id}`);
      return input.policy;
    },
    countDecisionsSince: async ({ sender_policy_id }) => {
      input.events.push(`count_decisions ${sender_policy_id}`);
      return input.decisions_since ?? 0;
    },
    countRescuesSince: async ({ sender_policy_id }) => {
      input.events.push(`count_rescues ${sender_policy_id}`);
      return input.rescues_since ?? 0;
    },
    mailboxesMissingTrashRetention: async () => {
      input.events.push("mailboxes_missing_retention");
      return input.mailboxes_missing_retention ?? [];
    },
    promoteToAuto: async ({ sender_policy_id, promoted_at }) => {
      input.events.push(`promote_to_auto ${sender_policy_id}`);
      input.written.set(sender_policy_id, { autonomy: "auto", autonomy_promoted_at: promoted_at });
    },
    demoteToShadow: async (sender_policy_id) => {
      input.events.push(`demote_to_shadow ${sender_policy_id}`);
      const existing = input.written.get(sender_policy_id);
      input.written.set(sender_policy_id, { autonomy: "shadow", autonomy_promoted_at: existing?.autonomy_promoted_at ?? null });
    },
  };
}

describe("promotePolicyAutonomy (Task 8)", () => {
  test("an archive policy with a reviewed shadow record promotes, and autonomyPromotedAt is set", async () => {
    const events: string[] = [];
    const written = new Map<string, FakePromotedPolicy>();
    const port = createFakePromotionPort({
      events,
      policy: { id: "policy-archive", action: "archive", autonomy_promoted_at: null },
      written,
    });

    const result = await promotePolicyAutonomy({ sender_policy_id: "policy-archive", reviewed_shadow_record: true, port });

    expect(result.outcome).toBe("promoted");
    if (result.outcome !== "promoted") {
      throw new Error("expected a promotion");
    }
    expect(result.autonomy_promoted_at).toBeInstanceOf(Date);
    expect(written.get("policy-archive")).toEqual({ autonomy: "auto", autonomy_promoted_at: result.autonomy_promoted_at });
  });

  test("an archive policy WITHOUT a reviewed shadow record is refused, naming the review gate", async () => {
    const events: string[] = [];
    const written = new Map<string, FakePromotedPolicy>();
    const port = createFakePromotionPort({
      events,
      policy: { id: "policy-archive", action: "archive", autonomy_promoted_at: null },
      written,
    });

    const result = await promotePolicyAutonomy({ sender_policy_id: "policy-archive", reviewed_shadow_record: false, port });

    expect(result).toEqual({ outcome: "refused", gate: "shadow_review", detail: expect.any(String) });
    expect(written.size).toBe(0);
  });

  test("a file policy with a reviewed shadow record promotes the same way as archive", async () => {
    const events: string[] = [];
    const written = new Map<string, FakePromotedPolicy>();
    const port = createFakePromotionPort({ events, policy: { id: "policy-file", action: "file", autonomy_promoted_at: null }, written });

    const result = await promotePolicyAutonomy({ sender_policy_id: "policy-file", reviewed_shadow_record: true, port });

    expect(result.outcome).toBe("promoted");
    expect(written.get("policy-file")?.autonomy).toBe("auto");
  });

  test("an auto_trash policy on a mailbox with NULL trashRetentionDays is refused, naming that gate", async () => {
    const events: string[] = [];
    const written = new Map<string, FakePromotedPolicy>();
    const port = createFakePromotionPort({
      events,
      policy: { id: "policy-trash", action: "auto_trash", autonomy_promoted_at: null },
      mailboxes_missing_retention: ["felix@tellmann.co.za", "felix@flext.dev"],
      written,
    });

    const result = await promotePolicyAutonomy({ sender_policy_id: "policy-trash", reviewed_shadow_record: true, port });

    expect(result.outcome).toBe("refused");
    if (result.outcome !== "refused") {
      throw new Error("expected a refusal");
    }
    expect(result.gate).toBe("trash_retention");
    expect(result.detail).toContain("felix@tellmann.co.za");
    expect(written.size).toBe(0);
    // Refused on retention alone: the shadow-cycle counts are never even queried.
    expect(events).not.toContain("count_decisions policy-trash");
  });

  test("an auto_trash policy is refused even with retention set everywhere, because it has never been promoted", async () => {
    const events: string[] = [];
    const written = new Map<string, FakePromotedPolicy>();
    const port = createFakePromotionPort({
      events,
      policy: { id: "policy-trash", action: "auto_trash", autonomy_promoted_at: null },
      mailboxes_missing_retention: [],
      written,
    });

    const result = await promotePolicyAutonomy({ sender_policy_id: "policy-trash", reviewed_shadow_record: true, port });

    expect(result).toEqual({ outcome: "refused", gate: "shadow_cycle", detail: expect.any(String) });
    expect(written.size).toBe(0);
  });

  test("purge is refused outright", async () => {
    const events: string[] = [];
    const written = new Map<string, FakePromotedPolicy>();
    const port = createFakePromotionPort({ events, policy: { id: "policy-purge", action: "purge", autonomy_promoted_at: null }, written });

    const result = await promotePolicyAutonomy({ sender_policy_id: "policy-purge", reviewed_shadow_record: true, port });

    expect(result).toEqual({ outcome: "refused", gate: "purge_not_allowed", detail: expect.any(String) });
    expect(written.size).toBe(0);
    // Refused before any DB read beyond the policy lookup itself.
    expect(events).toEqual(["load_policy policy-purge"]);
  });

  test("an unknown policy id is refused, naming the missing gate", async () => {
    const events: string[] = [];
    const written = new Map<string, FakePromotedPolicy>();
    const port = createFakePromotionPort({ events, policy: null, written });

    const result = await promotePolicyAutonomy({ sender_policy_id: "does-not-exist", reviewed_shadow_record: true, port });

    expect(result).toEqual({ outcome: "refused", gate: "missing", detail: expect.any(String) });
  });
});

describe("demotePolicyAutonomy (Task 8)", () => {
  test("demotion to shadow always succeeds, including for a suspended policy", async () => {
    const events: string[] = [];
    const written = new Map<string, FakePromotedPolicy>();
    // "suspended" lives on SenderPolicy.suspendedAt, outside this fake's shape — the point of this test is
    // that demotion never gates on ANYTHING, so a fake with no suspension concept at all still proves it:
    // demoteToShadow takes no policy row and cannot refuse.
    written.set("policy-suspended", { autonomy: "auto", autonomy_promoted_at: new Date("2026-07-01T00:00:00Z") });
    const port = createFakePromotionPort({ events, policy: null, written });

    const result = await demotePolicyAutonomy({ sender_policy_id: "policy-suspended", port });

    expect(result).toEqual({ outcome: "demoted" });
    expect(written.get("policy-suspended")?.autonomy).toBe("shadow");
    // autonomyPromotedAt survives a demotion: it is history, not cleared by stepping back to shadow.
    expect(written.get("policy-suspended")?.autonomy_promoted_at).toEqual(new Date("2026-07-01T00:00:00Z"));
  });

  test("demoting a policy id that names nothing still succeeds", async () => {
    const events: string[] = [];
    const written = new Map<string, FakePromotedPolicy>();
    const port = createFakePromotionPort({ events, policy: null, written });

    const result = await demotePolicyAutonomy({ sender_policy_id: "does-not-exist", port });

    expect(result).toEqual({ outcome: "demoted" });
  });
});
