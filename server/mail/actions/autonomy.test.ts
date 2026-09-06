import { describe, expect, test } from "bun:test";
import type {
  AutonomyPort,
  AutoPolicyRow,
  PolicyForGate,
  PromoteAutoInput,
  PromotionPort,
  SourceAutonomyRow,
} from "@server/mail/actions/autonomy";
import {
  demotePolicyAutonomy,
  eligibleScheduledSources,
  promoteAutoDecisions,
  promoteAutoPolicies,
  promoteAutoSources,
  promotePolicyAutonomy,
  promotePolicyAutonomyBatch,
} from "@server/mail/actions/autonomy";
import type { ActionJournal, ActionPromotionLookup } from "@server/mail/actions/executor";

const MAILBOX_ID = "mailbox-1";
const BATCH_SIZE = 100;

type FakeActionRow = {
  action_id: string;
  mailbox_id: string;
  sender_policy_id: string | null;
  status: string;
  source: string;
  kind: string;
  decided_at: Date | null;
  internal_date: Date;
};

type FakePolicyRow = {
  sender_policy_id: string;
  autonomy: "shadow" | "auto";
  suspended_at: Date | null;
};

const SWITCHED_ON = new Date("2026-09-06T12:00:00Z");
const BEFORE_SWITCH = new Date("2026-09-01T12:00:00Z");
const AFTER_SWITCH = new Date("2026-09-07T12:00:00Z");

function shadowRow(action_id: string, sender_policy_id: string, overrides: Partial<FakeActionRow> = {}): FakeActionRow {
  return {
    action_id,
    mailbox_id: MAILBOX_ID,
    sender_policy_id,
    status: "shadow",
    source: "address_policy",
    kind: "archive",
    decided_at: AFTER_SWITCH,
    internal_date: AFTER_SWITCH,
    ...overrides,
  };
}

// A row a scheduled source wrote: no policy id, which is exactly what keeps loadShadowActionsByPolicy
// from ever reaching it.
function sourceRow(action_id: string, source: string, kind: string, overrides: Partial<FakeActionRow> = {}): FakeActionRow {
  return {
    action_id,
    mailbox_id: MAILBOX_ID,
    sender_policy_id: null,
    status: "shadow",
    source,
    kind,
    decided_at: AFTER_SWITCH,
    internal_date: AFTER_SWITCH,
    ...overrides,
  };
}

function autonomyRow(overrides: Partial<SourceAutonomyRow> = {}): SourceAutonomyRow {
  return {
    first_contact_autonomy: "shadow",
    first_contact_autonomy_set_at: null,
    first_contact_suspended_at: null,
    settled_sweep_autonomy: "shadow",
    declined_sweep_autonomy: "shadow",
    dwell_suspended_at: null,
    ...overrides,
  };
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

    // Mirrors journal.ts's loadShadowActionsBySource: status, mailbox, source AND kind, and a strict
    // `Message.internalDate > arrived_after` when a cutoff is set; decided_at only orders.
    loadShadowActionsBySource: async (query) => {
      input.events.push(`load_shadow_by_source ${query.source} ${query.kind} limit ${query.batch_size}`);
      const matches: ActionPromotionLookup[] = [];
      for (const row of [...rows.values()].sort((a, b) => (a.decided_at?.getTime() ?? 0) - (b.decided_at?.getTime() ?? 0))) {
        if (row.status !== "shadow" || row.mailbox_id !== query.mailbox_id || row.source !== query.source || row.kind !== query.kind) {
          continue;
        }
        if (query.arrived_after !== null && row.internal_date.getTime() <= query.arrived_after.getTime()) {
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
function createFakePort(input: { events: string[]; policies: FakePolicyRow[]; source_autonomy?: SourceAutonomyRow | null }): AutonomyPort {
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
    loadSourceAutonomy: async () => {
      input.events.push("load_source_autonomy");
      return input.source_autonomy === undefined ? autonomyRow() : input.source_autonomy;
    },
  };
}

function promoteInput(overrides: Partial<PromoteAutoInput> = {}): Omit<PromoteAutoInput, "port" | "journal"> {
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

// docs/decisions/2026-09-06-scheduled-source-autonomy-per-mailbox.md: which of the three policy-less
// sources a mailbox row lets the tick promote.
describe("eligibleScheduledSources", () => {
  test("every switch at shadow: nothing", () => {
    expect(eligibleScheduledSources(autonomyRow())).toEqual([]);
  });

  test("first contact at auto: quarantine rows that arrived after the switch was set", () => {
    const eligible = eligibleScheduledSources(autonomyRow({ first_contact_autonomy: "auto", first_contact_autonomy_set_at: SWITCHED_ON }));

    expect(eligible).toEqual([{ source: "first_contact", kind: "quarantine", arrived_after: SWITCHED_ON }]);
  });

  test("first contact at auto with no set-at time is refused rather than promoted without a cutoff", () => {
    expect(eligibleScheduledSources(autonomyRow({ first_contact_autonomy: "auto" }))).toEqual([]);
  });

  test("a suspended first contact is not eligible, whatever the switch says", () => {
    const row = autonomyRow({
      first_contact_autonomy: "auto",
      first_contact_autonomy_set_at: SWITCHED_ON,
      first_contact_suspended_at: AFTER_SWITCH,
    });

    expect(eligibleScheduledSources(row)).toEqual([]);
  });

  test("the sweeps at auto: archive rows with no cutoff", () => {
    const eligible = eligibleScheduledSources(autonomyRow({ settled_sweep_autonomy: "auto", declined_sweep_autonomy: "auto" }));

    expect(eligible).toEqual([
      { source: "sweep_settled", kind: "archive", arrived_after: null },
      { source: "sweep_declined", kind: "archive", arrived_after: null },
    ]);
  });

  test("a dwell suspension takes both sweeps out and leaves first contact alone", () => {
    const row = autonomyRow({
      first_contact_autonomy: "auto",
      first_contact_autonomy_set_at: SWITCHED_ON,
      settled_sweep_autonomy: "auto",
      declined_sweep_autonomy: "auto",
      dwell_suspended_at: AFTER_SWITCH,
    });

    expect(eligibleScheduledSources(row).map((eligible) => eligible.source)).toEqual(["first_contact"]);
  });

  test("first contact is spent before the sweeps", () => {
    const row = autonomyRow({
      first_contact_autonomy: "auto",
      first_contact_autonomy_set_at: SWITCHED_ON,
      settled_sweep_autonomy: "auto",
      declined_sweep_autonomy: "auto",
    });

    expect(eligibleScheduledSources(row).map((eligible) => eligible.source)).toEqual(["first_contact", "sweep_settled", "sweep_declined"]);
  });
});

describe("promoteAutoSources", () => {
  const first_contact_on = autonomyRow({ first_contact_autonomy: "auto", first_contact_autonomy_set_at: SWITCHED_ON });

  test("first-contact quarantine rows that arrived after the switch are promoted; the backlog before it stays", async () => {
    const events: string[] = [];
    const journal = createFakeJournal({
      events,
      seed: [
        sourceRow("fc-old", "first_contact", "quarantine", { decided_at: BEFORE_SWITCH, internal_date: BEFORE_SWITCH }),
        sourceRow("fc-at", "first_contact", "quarantine", { decided_at: SWITCHED_ON, internal_date: SWITCHED_ON }),
        sourceRow("fc-new", "first_contact", "quarantine"),
      ],
    });
    const port = createFakePort({ events, policies: [], source_autonomy: first_contact_on });

    const promoted = await promoteAutoSources({ ...promoteInput(), port, journal });

    expect(promoted).toEqual(["fc-new"]);
    expect(journal.rows.get("fc-old")?.status).toBe("shadow");
    expect(journal.rows.get("fc-at")?.status).toBe("shadow");
  });

  // /admin/shadow's Run-pass re-journals the whole mailbox with decided_at = now. A cutoff on decided_at
  // would let one click move every old first contact; the cutoff reads the message's arrival instead.
  test("a backlog row re-decided after the switch stays a proposal: the cutoff is arrival, not decision time", async () => {
    const events: string[] = [];
    const journal = createFakeJournal({
      events,
      seed: [sourceRow("fc-rejudged", "first_contact", "quarantine", { decided_at: AFTER_SWITCH, internal_date: BEFORE_SWITCH })],
    });
    const port = createFakePort({ events, policies: [], source_autonomy: first_contact_on });

    const promoted = await promoteAutoSources({ ...promoteInput(), port, journal });

    expect(promoted).toEqual([]);
    expect(journal.rows.get("fc-rejudged")?.status).toBe("shadow");
  });

  // A guard-suppressed first contact is journaled as keep_inbox under the same source, and planFor throws
  // on keep_inbox. Reading by source alone would hand the executor a row it cannot plan.
  test("a guard-suppressed row sharing the source is never promoted", async () => {
    const events: string[] = [];
    const journal = createFakeJournal({
      events,
      seed: [sourceRow("fc-kept", "first_contact", "keep_inbox"), sourceRow("fc-human", "first_contact_human", "keep_inbox")],
    });
    const port = createFakePort({ events, policies: [], source_autonomy: first_contact_on });

    const promoted = await promoteAutoSources({ ...promoteInput(), port, journal });

    expect(promoted).toEqual([]);
    expect(journal.rows.get("fc-kept")?.status).toBe("shadow");
    expect(journal.rows.get("fc-human")?.status).toBe("shadow");
  });

  test("the sweeps drain their backlog: no cutoff", async () => {
    const events: string[] = [];
    const journal = createFakeJournal({
      events,
      seed: [
        sourceRow("s-old", "sweep_settled", "archive", { decided_at: BEFORE_SWITCH }),
        sourceRow("d-old", "sweep_declined", "archive", { decided_at: BEFORE_SWITCH }),
        sourceRow("d-kept", "sweep_declined", "keep_inbox", { decided_at: BEFORE_SWITCH }),
      ],
    });
    const port = createFakePort({
      events,
      policies: [],
      source_autonomy: autonomyRow({ settled_sweep_autonomy: "auto", declined_sweep_autonomy: "auto" }),
    });

    const promoted = await promoteAutoSources({ ...promoteInput(), port, journal });

    expect(promoted.slice().sort()).toEqual(["d-old", "s-old"]);
    expect(journal.rows.get("d-kept")?.status).toBe("shadow");
  });

  test("a mailbox with every switch at shadow reads nothing from the journal", async () => {
    const events: string[] = [];
    const journal = createFakeJournal({ events, seed: [sourceRow("fc-new", "first_contact", "quarantine")] });
    const port = createFakePort({ events, policies: [] });

    const promoted = await promoteAutoSources({ ...promoteInput(), port, journal });

    expect(promoted).toEqual([]);
    expect(events).toEqual(["load_source_autonomy"]);
  });

  test("an unknown mailbox promotes nothing", async () => {
    const events: string[] = [];
    const journal = createFakeJournal({ events, seed: [sourceRow("fc-new", "first_contact", "quarantine")] });
    const port = createFakePort({ events, policies: [], source_autonomy: null });

    expect(await promoteAutoSources({ ...promoteInput(), port, journal })).toEqual([]);
  });

  test("the budget is a TOTAL across sources, first contact first", async () => {
    const events: string[] = [];
    const journal = createFakeJournal({
      events,
      seed: [
        sourceRow("fc-1", "first_contact", "quarantine"),
        sourceRow("fc-2", "first_contact", "quarantine"),
        sourceRow("s-1", "sweep_settled", "archive"),
        sourceRow("s-2", "sweep_settled", "archive"),
      ],
    });
    const port = createFakePort({
      events,
      policies: [],
      source_autonomy: { ...first_contact_on, settled_sweep_autonomy: "auto" },
    });

    const promoted = await promoteAutoSources({ ...promoteInput({ batch_size: 3 }), port, journal });

    expect(promoted).toEqual(["fc-1", "fc-2", "s-1"]);
    expect(journal.rows.get("s-2")?.status).toBe("shadow");
  });

  test("two concurrent promotions return disjoint id sets and claim every row exactly once", async () => {
    const events: string[] = [];
    const journal = createFakeJournal({
      events,
      seed: [sourceRow("fc-1", "first_contact", "quarantine"), sourceRow("fc-2", "first_contact", "quarantine")],
    });
    const port = createFakePort({ events, policies: [], source_autonomy: first_contact_on });

    const [first, second] = await Promise.all([
      promoteAutoSources({ ...promoteInput(), port, journal }),
      promoteAutoSources({ ...promoteInput(), port, journal }),
    ]);

    expect(first.filter((id) => second.includes(id))).toEqual([]);
    expect([...first, ...second].sort()).toEqual(["fc-1", "fc-2"]);
  });
});

describe("promoteAutoDecisions", () => {
  test("policies are spent first, sources get what is left, and the executor sees one list", async () => {
    const events: string[] = [];
    const journal = createFakeJournal({
      events,
      seed: [
        shadowRow("p-1", "policy-auto"),
        shadowRow("p-2", "policy-auto"),
        sourceRow("fc-1", "first_contact", "quarantine"),
        sourceRow("fc-2", "first_contact", "quarantine"),
      ],
    });
    const port = createFakePort({
      events,
      policies: [{ sender_policy_id: "policy-auto", autonomy: "auto", suspended_at: null }],
      source_autonomy: autonomyRow({ first_contact_autonomy: "auto", first_contact_autonomy_set_at: SWITCHED_ON }),
    });

    const promoted = await promoteAutoDecisions({ ...promoteInput({ batch_size: 3 }), port, journal });

    expect(promoted).toEqual(["p-1", "p-2", "fc-1"]);
    expect(journal.rows.get("fc-2")?.status).toBe("shadow");
  });

  test("a budget the policies exhaust never reads the source switches", async () => {
    const events: string[] = [];
    const journal = createFakeJournal({
      events,
      seed: [shadowRow("p-1", "policy-auto"), sourceRow("fc-1", "first_contact", "quarantine")],
    });
    const port = createFakePort({
      events,
      policies: [{ sender_policy_id: "policy-auto", autonomy: "auto", suspended_at: null }],
      source_autonomy: autonomyRow({ first_contact_autonomy: "auto", first_contact_autonomy_set_at: SWITCHED_ON }),
    });

    const promoted = await promoteAutoDecisions({ ...promoteInput({ batch_size: 1 }), port, journal });

    expect(promoted).toEqual(["p-1"]);
    expect(events).not.toContain("load_source_autonomy");
  });

  test("with nothing at auto anywhere, nothing is written", async () => {
    const events: string[] = [];
    const journal = createFakeJournal({
      events,
      seed: [shadowRow("p-1", "policy-shadow"), sourceRow("fc-1", "first_contact", "quarantine")],
    });
    const port = createFakePort({ events, policies: [{ sender_policy_id: "policy-shadow", autonomy: "shadow", suspended_at: null }] });

    expect(await promoteAutoDecisions({ ...promoteInput(), port, journal })).toEqual([]);
    expect(events).toEqual(["load_auto_policies", "load_source_autonomy"]);
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

// The review sheet's write half. Not a bypass: it calls promotePolicyAutonomy per policy with the same
// assertion the operator made, so every gate still runs. These cases pin that, and pin that one refusal
// does not discard the rest of the batch.
describe("promotePolicyAutonomyBatch", () => {
  function createMultiPolicyPort(input: {
    events: string[];
    policies: Record<string, PolicyForGate>;
    written: Map<string, FakePromotedPolicy>;
  }): PromotionPort {
    return {
      loadPolicy: async (sender_policy_id) => {
        input.events.push(`load_policy ${sender_policy_id}`);
        return input.policies[sender_policy_id] ?? null;
      },
      countDecisionsSince: async () => 0,
      countRescuesSince: async () => 0,
      mailboxesMissingTrashRetention: async () => [],
      promoteToAuto: async ({ sender_policy_id, promoted_at }) => {
        input.events.push(`promote_to_auto ${sender_policy_id}`);
        input.written.set(sender_policy_id, { autonomy: "auto", autonomy_promoted_at: promoted_at });
      },
      demoteToShadow: async () => undefined,
    };
  }

  test("promotes every reviewed policy in the sheet", async () => {
    const events: string[] = [];
    const written = new Map<string, FakePromotedPolicy>();
    const port = createMultiPolicyPort({
      events,
      written,
      policies: {
        "policy-a": { id: "policy-a", action: "archive", autonomy_promoted_at: null },
        "policy-b": { id: "policy-b", action: "file", autonomy_promoted_at: null },
      },
    });

    const result = await promotePolicyAutonomyBatch({
      sender_policy_ids: ["policy-a", "policy-b"],
      reviewed_shadow_record: true,
      port,
    });

    expect(result.promoted).toBe(2);
    expect(result.refused).toBe(0);
    expect(written.get("policy-a")?.autonomy).toBe("auto");
    expect(written.get("policy-b")?.autonomy).toBe("auto");
  });

  test("one refusal does not discard the rest of the batch", async () => {
    // A sheet is a list the operator ticked. Stopping at the first policy that cannot be promoted would
    // throw away every decision they made after it, and give no clue which one was the problem.
    const events: string[] = [];
    const written = new Map<string, FakePromotedPolicy>();
    const port = createMultiPolicyPort({
      events,
      written,
      policies: {
        "policy-a": { id: "policy-a", action: "archive", autonomy_promoted_at: null },
        "policy-purge": { id: "policy-purge", action: "purge", autonomy_promoted_at: null },
        "policy-c": { id: "policy-c", action: "file", autonomy_promoted_at: null },
      },
    });

    const result = await promotePolicyAutonomyBatch({
      sender_policy_ids: ["policy-a", "policy-purge", "policy-c"],
      reviewed_shadow_record: true,
      port,
    });

    expect(result.promoted).toBe(2);
    expect(result.refused).toBe(1);
    expect(written.has("policy-purge")).toBe(false);

    // And it names WHICH one refused and why. "2 of 3 promoted" with no names is a worse answer.
    const refusal = result.results.find((entry) => entry.outcome === "refused");
    expect(refusal?.sender_policy_id).toBe("policy-purge");
    expect(refusal?.outcome === "refused" && refusal.gate).toBe("purge_not_allowed");
  });

  test("without the review assertion nothing is promoted at all", async () => {
    const events: string[] = [];
    const written = new Map<string, FakePromotedPolicy>();
    const port = createMultiPolicyPort({
      events,
      written,
      policies: {
        "policy-a": { id: "policy-a", action: "archive", autonomy_promoted_at: null },
        "policy-b": { id: "policy-b", action: "file", autonomy_promoted_at: null },
      },
    });

    const result = await promotePolicyAutonomyBatch({
      sender_policy_ids: ["policy-a", "policy-b"],
      reviewed_shadow_record: false,
      port,
    });

    expect(result.promoted).toBe(0);
    expect(result.refused).toBe(2);
    expect(written.size).toBe(0);
    expect(result.results.every((entry) => entry.outcome === "refused" && entry.gate === "shadow_review")).toBe(true);
  });

  test("a policy that no longer exists is refused, not skipped silently", async () => {
    const events: string[] = [];
    const written = new Map<string, FakePromotedPolicy>();
    const port = createMultiPolicyPort({ events, written, policies: {} });

    const result = await promotePolicyAutonomyBatch({ sender_policy_ids: ["gone"], reviewed_shadow_record: true, port });

    expect(result.refused).toBe(1);
    expect(result.results[0]?.outcome === "refused" && result.results[0].gate).toBe("missing");
  });
});

// The gate's own precondition, which was unrecordable until trashRetentionConfirmedAt existed. §1.7
// accepts a retention value OR a confirmed null; the column alone could only say "some number" or
// "nothing", and the second was read as unknown.
describe("the trash retention gate", () => {
  test("refuses while any mailbox is unchecked, and names it", async () => {
    const events: string[] = [];
    const written = new Map<string, FakePromotedPolicy>();
    const port = createFakePromotionPort({
      events,
      written,
      policy: { id: "policy-trash", action: "auto_trash", autonomy_promoted_at: null },
      mailboxes_missing_retention: ["felix@tellmann.co.za"],
    });

    const result = await promotePolicyAutonomy({ sender_policy_id: "policy-trash", reviewed_shadow_record: true, port });

    expect(result.outcome).toBe("refused");
    expect(result.outcome === "refused" && result.gate).toBe("trash_retention");
    // Naming the mailbox is the difference between a check the operator can clear and one they can only
    // route around.
    expect(result.outcome === "refused" && result.detail).toContain("felix@tellmann.co.za");
    expect(written.size).toBe(0);
  });

  test("once every mailbox is answered, the shadow cycle becomes the remaining obstacle", async () => {
    // Not promoted: an auto_trash policy still has to run a full cycle first. This asserts the gate moves
    // on to that rather than passing outright, which is what proves retention was the only thing cleared.
    const events: string[] = [];
    const written = new Map<string, FakePromotedPolicy>();
    const port = createFakePromotionPort({
      events,
      written,
      policy: { id: "policy-trash", action: "auto_trash", autonomy_promoted_at: null },
      mailboxes_missing_retention: [],
    });

    const result = await promotePolicyAutonomy({ sender_policy_id: "policy-trash", reviewed_shadow_record: true, port });

    expect(result.outcome).toBe("refused");
    expect(result.outcome === "refused" && result.gate).toBe("shadow_cycle");
    expect(written.size).toBe(0);
  });
});
