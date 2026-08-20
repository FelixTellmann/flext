import { describe, expect, test } from "bun:test";
import type { AutonomyPort, AutoPolicyRow, PromoteAutoPoliciesInput } from "@server/mail/actions/autonomy";
import { promoteAutoPolicies } from "@server/mail/actions/autonomy";
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

    // Mirrors journal.ts's `WHERE status = 'shadow'` guard: only a row still at "shadow" moves.
    promoteShadowActions: async (entries) => {
      input.events.push(`promote ${entries.map((entry) => entry.action_id).join(",")}`);
      for (const entry of entries) {
        const row = rows.get(entry.action_id);
        if (row === undefined) {
          throw new Error(`fixture asked to promote unknown action ${entry.action_id}`);
        }
        if (row.status === "shadow") {
          row.status = "pending";
        }
      }
    },

    loadPendingActions: async () => unsupported("loadPendingActions"),
    recordFromState: async () => unsupported("recordFromState"),
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
});
