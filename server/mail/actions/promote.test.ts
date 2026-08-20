import { describe, expect, test } from "bun:test";
import type { ActionJournal, ActionPromotionLookup } from "@server/mail/actions/executor";
import type { PromoteActionResult, PromotePolicyActionsResult } from "@server/mail/actions/promote";
import { promoteAction, promotePolicyActions } from "@server/mail/actions/promote";

const MAILBOX_ID = "mailbox-1";
const OTHER_MAILBOX_ID = "mailbox-2";
const POLICY_ID = "policy-1";
const OTHER_POLICY_ID = "policy-2";

type FakeRow = {
  action_id: string;
  mailbox_id: string | null;
  sender_policy_id: string | null;
  status: string;
  from_state_json: string | null;
  to_state_json: string | null;
  applied_at: string | null;
};

type FakeJournal = ActionJournal & { rows: Map<string, FakeRow> };

function shadowRow(action_id: string, overrides: Partial<FakeRow> = {}): FakeRow {
  return {
    action_id,
    mailbox_id: MAILBOX_ID,
    sender_policy_id: POLICY_ID,
    status: "shadow",
    from_state_json: null,
    to_state_json: null,
    applied_at: null,
    ...overrides,
  };
}

function createFakeJournal(input: { events: string[]; seed: FakeRow[] }): FakeJournal {
  const rows = new Map(input.seed.map((row) => [row.action_id, { ...row }]));

  function unsupported(name: string): never {
    throw new Error(`${name} is not part of this fixture`);
  }

  return {
    rows,

    loadActionForPromotion: async (query) => {
      input.events.push(`load_for_promotion ${query.action_id}`);
      const row = rows.get(query.action_id);
      return row === undefined ? null : { action_id: row.action_id, mailbox_id: row.mailbox_id, status: row.status };
    },

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

    // Mirrors journal.ts's `WHERE status = 'shadow'` guard: only a row still at "shadow" moves, and
    // nothing but `status` changes.
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
  };
}

describe("promoteAction — one decision (Task 8)", () => {
  test("promotes a shadow row to pending", async () => {
    const events: string[] = [];
    const journal = createFakeJournal({ events, seed: [shadowRow("action-1")] });

    const result = await promoteAction({ action_id: "action-1", mailbox_id: MAILBOX_ID, journal });

    expect(result).toEqual({ outcome: "promoted" } satisfies PromoteActionResult);
    expect(journal.rows.get("action-1")?.status).toBe("pending");
    expect(events).toEqual(["load_for_promotion action-1", "promote action-1"]);
  });

  test("leaves from_state_json, to_state_json, and applied_at untouched — the executor's steps 1-4 own those", async () => {
    const events: string[] = [];
    const journal = createFakeJournal({ events, seed: [shadowRow("action-1")] });

    await promoteAction({ action_id: "action-1", mailbox_id: MAILBOX_ID, journal });

    const row = journal.rows.get("action-1");
    expect(row?.from_state_json).toBeNull();
    expect(row?.to_state_json).toBeNull();
    expect(row?.applied_at).toBeNull();
  });

  test("refuses an unknown action id", async () => {
    const events: string[] = [];
    const journal = createFakeJournal({ events, seed: [] });

    const result = await promoteAction({ action_id: "missing-action", mailbox_id: MAILBOX_ID, journal });

    expect(result).toEqual({
      outcome: "not_promotable",
      reason: "missing",
      detail: "no action with that id exists.",
    } satisfies PromoteActionResult);
    expect(events).toEqual(["load_for_promotion missing-action"]);
  });

  test("refuses an action belonging to another mailbox, without promoting it", async () => {
    const events: string[] = [];
    const journal = createFakeJournal({ events, seed: [shadowRow("action-1", { mailbox_id: OTHER_MAILBOX_ID })] });

    const result = await promoteAction({ action_id: "action-1", mailbox_id: MAILBOX_ID, journal });

    expect(result).toEqual({
      outcome: "not_promotable",
      reason: "other_mailbox",
      detail: `that action belongs to mailbox ${OTHER_MAILBOX_ID}, and approval must reach the mailbox it will execute against.`,
    } satisfies PromoteActionResult);
    expect(journal.rows.get("action-1")?.status).toBe("shadow");
    expect(events).not.toContain("promote action-1");
  });

  // Ruling 1: pending is the only status a human click may create, so a guard must refuse any attempt to
  // promote a row straight to applied. Promoting an action already applied must be rejected, not silently
  // ignored, and the row must be left exactly as it was.
  test("guard: refuses to promote an action that is already applied, and does not touch it", async () => {
    const events: string[] = [];
    const journal = createFakeJournal({ events, seed: [shadowRow("action-1", { status: "applied", applied_at: "2026-08-19T10:00:00Z" })] });

    const result = await promoteAction({ action_id: "action-1", mailbox_id: MAILBOX_ID, journal });

    expect(result).toEqual({
      outcome: "not_promotable",
      reason: "not_shadow",
      detail:
        'that action has status "applied", so it is not a reviewed shadow decision. Only a shadow row may be promoted, and only to "pending" — never straight to "applied".',
    } satisfies PromoteActionResult);
    expect(journal.rows.get("action-1")?.status).toBe("applied");
    expect(events).not.toContain("promote action-1");
  });

  test.each(["undone", "deferred", "pending"] as const)("guard: refuses to promote a row already %s", async (status) => {
    const events: string[] = [];
    const journal = createFakeJournal({ events, seed: [shadowRow("action-1", { status })] });

    const result = await promoteAction({ action_id: "action-1", mailbox_id: MAILBOX_ID, journal });

    expect(result).toEqual({ outcome: "not_promotable", reason: "not_shadow", detail: expect.stringContaining(status) });
    expect(journal.rows.get("action-1")?.status).toBe(status);
    expect(events).not.toContain("promote action-1");
  });

  test("rejects an empty action id", async () => {
    const journal = createFakeJournal({ events: [], seed: [] });
    await expect(promoteAction({ action_id: "", mailbox_id: MAILBOX_ID, journal })).rejects.toThrow(/needs an action id/);
  });

  test("rejects an empty mailbox id", async () => {
    const journal = createFakeJournal({ events: [], seed: [] });
    await expect(promoteAction({ action_id: "action-1", mailbox_id: "", journal })).rejects.toThrow(/needs a mailbox id/);
  });
});

describe("promotePolicyActions — all decisions for one policy (Task 8)", () => {
  test("promotes every shadow row for the mailbox and policy, and nothing else", async () => {
    const events: string[] = [];
    const journal = createFakeJournal({
      events,
      seed: [
        shadowRow("action-1"),
        shadowRow("action-2"),
        shadowRow("action-3", { sender_policy_id: OTHER_POLICY_ID }),
        shadowRow("action-4", { mailbox_id: OTHER_MAILBOX_ID }),
        shadowRow("action-5", { status: "applied" }),
      ],
    });

    const result = await promotePolicyActions({ sender_policy_id: POLICY_ID, mailbox_id: MAILBOX_ID, batch_size: 100, journal });

    expect(result).toEqual({ examined: 2, promoted: 2 } satisfies PromotePolicyActionsResult);
    expect(journal.rows.get("action-1")?.status).toBe("pending");
    expect(journal.rows.get("action-2")?.status).toBe("pending");
    expect(journal.rows.get("action-3")?.status).toBe("shadow");
    expect(journal.rows.get("action-4")?.status).toBe("shadow");
    expect(journal.rows.get("action-5")?.status).toBe("applied");
  });

  test("does nothing, and never calls the write, when no shadow rows match", async () => {
    const events: string[] = [];
    const journal = createFakeJournal({ events, seed: [shadowRow("action-1", { status: "applied" })] });

    const result = await promotePolicyActions({ sender_policy_id: POLICY_ID, mailbox_id: MAILBOX_ID, batch_size: 100, journal });

    expect(result).toEqual({ examined: 0, promoted: 0 } satisfies PromotePolicyActionsResult);
    expect(events.some((event) => event.startsWith("promote "))).toBe(false);
  });

  test("respects batch_size", async () => {
    const events: string[] = [];
    const journal = createFakeJournal({ events, seed: [shadowRow("action-1"), shadowRow("action-2"), shadowRow("action-3")] });

    const result = await promotePolicyActions({ sender_policy_id: POLICY_ID, mailbox_id: MAILBOX_ID, batch_size: 2, journal });

    expect(result).toEqual({ examined: 2, promoted: 2 } satisfies PromotePolicyActionsResult);
  });

  test("rejects an empty policy id — an unscoped promote would approve every shadow decision in the mailbox", async () => {
    const journal = createFakeJournal({ events: [], seed: [] });
    await expect(promotePolicyActions({ sender_policy_id: "", mailbox_id: MAILBOX_ID, batch_size: 10, journal })).rejects.toThrow(
      /needs a policy id/,
    );
  });

  test("rejects an empty mailbox id", async () => {
    const journal = createFakeJournal({ events: [], seed: [] });
    await expect(promotePolicyActions({ sender_policy_id: POLICY_ID, mailbox_id: "", batch_size: 10, journal })).rejects.toThrow(
      /needs a mailbox id/,
    );
  });
});
