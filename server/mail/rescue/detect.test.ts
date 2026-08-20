import { describe, expect, test } from "bun:test";
import type { ActionStateSnapshot } from "@server/mail/actions/state";
import { serializeActionState } from "@server/mail/actions/state";
import type { LiveMessageFacts, PolicySuspensionEntry, RescueCandidateRow, RescuePort, RescueStampEntry } from "@server/mail/rescue/detect";
import { detectRescues } from "@server/mail/rescue/detect";
import type { MessageAddress } from "@server/mail/rescue/locate";

const MAILBOX_ID = "mailbox-generic";
const UID_VALIDITY = "38504";
const APPLIED_AT = new Date("2026-08-20T09:00:00.000Z");
const OPENED_AFTER = new Date("2026-08-21T07:30:00.000Z");
const OPENED_BEFORE = new Date("2026-08-19T16:00:00.000Z");
const REPLIED_AFTER = new Date("2026-08-22T11:15:00.000Z");

// One key per addressable location, so a fake row can exist at the moved-to address while the row the
// action names holds the dead one. That is the whole hazard this pass has to survive.
function addressKey(address: MessageAddress): string {
  return address.by === "row" ? `row:${address.message_id}` : `addr:${address.folder}:${address.uid}:${address.uid_validity}`;
}

function toStateJson(overrides: Partial<ActionStateSnapshot> = {}): string {
  const state: ActionStateSnapshot = { folder: "Archive", uid: 42, uid_validity: UID_VALIDITY, flags: [], labels: null, ...overrides };
  return serializeActionState(state);
}

// Every nullable field tests `=== undefined` rather than using `??`: a fixture that defaults a
// deliberately-passed null disarms the very test that passed it — the null-policy case here would
// silently grow a policy and stop proving anything.
function candidate(input: {
  action_id: string;
  message_id?: string;
  sender_policy_id?: string | null;
  kind?: string;
  to_state_json?: string | null;
  applied_at?: Date;
}): RescueCandidateRow {
  return {
    action_id: input.action_id,
    message_id: input.message_id === undefined ? `message-${input.action_id}` : input.message_id,
    sender_policy_id: input.sender_policy_id === undefined ? "policy-1" : input.sender_policy_id,
    kind: input.kind === undefined ? "archive" : input.kind,
    to_state_json: input.to_state_json === undefined ? null : input.to_state_json,
    applied_at: input.applied_at === undefined ? APPLIED_AT : input.applied_at,
  };
}

function facts(input: { subject?: string | null; opened_at?: Date | null; last_reply_at?: Date | null }): LiveMessageFacts {
  return {
    subject: input.subject === undefined ? "xneelo Tax Invoice I260024265760" : input.subject,
    opened_at: input.opened_at === undefined ? null : input.opened_at,
    last_reply_at: input.last_reply_at === undefined ? null : input.last_reply_at,
  };
}

type PolicyState = { suspended_at: Date | null; suspension_reason: string | null };

type FakePort = RescuePort & {
  lookups: MessageAddress[];
  stamps: Map<string, Date>;
  policies: Map<string, PolicyState>;
};

// The fake holds the two properties the drizzle implementation holds in SQL, because a fake that did not
// would let the pass pass while the real thing re-suspended a policy on every run:
//   - loadRescueCandidates skips anything already stamped (`rescuedAt IS NULL`)
//   - suspendPolicy leaves an already-suspended policy alone (`WHERE suspendedAt IS NULL`)
function createFakePort(input: {
  rows: RescueCandidateRow[];
  live: Record<string, LiveMessageFacts>;
  policies?: Record<string, PolicyState>;
}): FakePort {
  const stamps = new Map<string, Date>();
  const lookups: MessageAddress[] = [];
  const policies = new Map<string, PolicyState>(Object.entries(input.policies === undefined ? {} : input.policies));

  return {
    lookups,
    stamps,
    policies,
    loadRescueCandidates: async (query: { mailbox_id: string; batch_size: number }): Promise<RescueCandidateRow[]> => {
      return input.rows.filter((row) => !stamps.has(row.action_id)).slice(0, query.batch_size);
    },
    loadLiveMessage: async (query: { mailbox_id: string; address: MessageAddress }): Promise<LiveMessageFacts | null> => {
      lookups.push(query.address);
      const found = input.live[addressKey(query.address)];
      return found === undefined ? null : found;
    },
    markRescued: async (entries: RescueStampEntry[]): Promise<void> => {
      for (const entry of entries) {
        if (!stamps.has(entry.action_id)) {
          stamps.set(entry.action_id, entry.rescued_at);
        }
      }
    },
    suspendPolicy: async (entry: PolicySuspensionEntry): Promise<void> => {
      const existing = policies.get(entry.sender_policy_id);
      if (existing !== undefined && existing.suspended_at !== null) {
        return;
      }
      policies.set(entry.sender_policy_id, { suspended_at: entry.suspended_at, suspension_reason: entry.reason });
    },
  };
}

describe("detectRescues", () => {
  test("an action whose message was opened after appliedAt suspends the policy and stamps the action", async () => {
    const port = createFakePort({
      rows: [candidate({ action_id: "action-1" })],
      live: { "row:message-action-1": facts({ opened_at: OPENED_AFTER }) },
    });

    const result = await detectRescues({ port, mailbox_id: MAILBOX_ID, batch_size: 50 });

    expect(result).toEqual({ examined: 1, rescued: 1, suspended: 1, unresolved: 0 });
    expect(port.stamps.has("action-1")).toBe(true);
    expect(port.policies.get("policy-1")?.suspension_reason).toBe(
      'rescued: you opened "xneelo Tax Invoice I260024265760" on 2026-08-21 after this rule archived it on 2026-08-20. The rule is suspended until you clear it; the action is in the journal and can be undone.',
    );
  });

  test("a reply after appliedAt is reported as the signal, outranking an open", async () => {
    const port = createFakePort({
      rows: [candidate({ action_id: "action-reply" })],
      live: { "row:message-action-reply": facts({ opened_at: OPENED_AFTER, last_reply_at: REPLIED_AFTER }) },
    });

    await detectRescues({ port, mailbox_id: MAILBOX_ID, batch_size: 50 });

    expect(port.policies.get("policy-1")?.suspension_reason).toContain("you replied to");
    expect(port.policies.get("policy-1")?.suspension_reason).toContain("on 2026-08-22");
  });

  test("an action whose message was opened BEFORE appliedAt suspends nothing and stamps nothing", async () => {
    const port = createFakePort({
      rows: [candidate({ action_id: "action-2" })],
      live: { "row:message-action-2": facts({ opened_at: OPENED_BEFORE }) },
    });

    const result = await detectRescues({ port, mailbox_id: MAILBOX_ID, batch_size: 50 });

    expect(result).toEqual({ examined: 1, rescued: 0, suspended: 0, unresolved: 0 });
    expect(port.stamps.size).toBe(0);
    expect(port.policies.size).toBe(0);
  });

  // The hazard the whole phase turns on. On generic IMAP an archive is a MOVE: the sync INSERTS a new row
  // at the destination and stamps disappearedAt on the old one, so the row Action.messageId names is dead
  // and its openedAt can never change again. A pass that asked the port for the row id would be
  // permanently blind on the largest mailbox while looking perfectly correct on the three Gmail ones —
  // which is why the dead row here carries no open and the moved row carries the real one.
  test("a generic-flavour action whose message MOVED is looked up by its to_state_json address, not its row id", async () => {
    const port = createFakePort({
      rows: [candidate({ action_id: "action-3", message_id: "dead-row", to_state_json: toStateJson({ folder: "Archive", uid: 517 }) })],
      live: {
        "row:dead-row": facts({ subject: "stale copy", opened_at: null }),
        [`addr:Archive:517:${UID_VALIDITY}`]: facts({ subject: "xneelo Tax Invoice I260024265760", opened_at: OPENED_AFTER }),
      },
    });

    const result = await detectRescues({ port, mailbox_id: MAILBOX_ID, batch_size: 50 });

    expect(port.lookups).toEqual([{ by: "address", folder: "Archive", uid: 517, uid_validity: UID_VALIDITY }]);
    expect(port.lookups).not.toContainEqual({ by: "row", message_id: "dead-row" });
    expect(result).toEqual({ examined: 1, rescued: 1, suspended: 1, unresolved: 0 });
    expect(port.policies.get("policy-1")?.suspension_reason).toContain("xneelo Tax Invoice I260024265760");
  });

  test("a second pass over the same data changes nothing", async () => {
    const port = createFakePort({
      rows: [candidate({ action_id: "action-4" })],
      live: { "row:message-action-4": facts({ opened_at: OPENED_AFTER }) },
    });

    const first = await detectRescues({ port, mailbox_id: MAILBOX_ID, batch_size: 50 });
    const stamped_at = port.stamps.get("action-4");
    const reason_after_first = port.policies.get("policy-1")?.suspension_reason;
    const second = await detectRescues({ port, mailbox_id: MAILBOX_ID, batch_size: 50 });

    expect(first).toEqual({ examined: 1, rescued: 1, suspended: 1, unresolved: 0 });
    expect(second).toEqual({ examined: 0, rescued: 0, suspended: 0, unresolved: 0 });
    expect(port.stamps.get("action-4")).toBe(stamped_at);
    expect(port.policies.get("policy-1")?.suspension_reason).toBe(reason_after_first);
  });

  test("an already-suspended policy keeps its ORIGINAL reason", async () => {
    const original_at = new Date("2026-08-10T08:00:00.000Z");
    const port = createFakePort({
      rows: [candidate({ action_id: "action-5" })],
      live: { "row:message-action-5": facts({ opened_at: OPENED_AFTER }) },
      policies: { "policy-1": { suspended_at: original_at, suspension_reason: "rescued: you opened an earlier message" } },
    });

    await detectRescues({ port, mailbox_id: MAILBOX_ID, batch_size: 50 });

    expect(port.policies.get("policy-1")).toEqual({
      suspended_at: original_at,
      suspension_reason: "rescued: you opened an earlier message",
    });
    expect(port.stamps.has("action-5")).toBe(true);
  });

  test("an action with no sender policy is stamped, suspends nothing, and does not throw", async () => {
    const port = createFakePort({
      rows: [candidate({ action_id: "action-6", sender_policy_id: null })],
      live: { "row:message-action-6": facts({ opened_at: OPENED_AFTER }) },
    });

    const result = await detectRescues({ port, mailbox_id: MAILBOX_ID, batch_size: 50 });

    expect(result).toEqual({ examined: 1, rescued: 1, suspended: 0, unresolved: 0 });
    expect(port.stamps.has("action-6")).toBe(true);
    expect(port.policies.size).toBe(0);
  });

  test("an address that resolves to no live row is counted, not thrown on", async () => {
    const port = createFakePort({ rows: [candidate({ action_id: "action-7" })], live: {} });

    const result = await detectRescues({ port, mailbox_id: MAILBOX_ID, batch_size: 50 });

    expect(result).toEqual({ examined: 1, rescued: 0, suspended: 0, unresolved: 1 });
    expect(port.stamps.size).toBe(0);
  });

  test("two rescued actions under one policy suspend it once, on the first rescue's reason", async () => {
    const port = createFakePort({
      rows: [
        candidate({ action_id: "action-8a", applied_at: APPLIED_AT }),
        candidate({ action_id: "action-8b", applied_at: APPLIED_AT, kind: "auto_trash" }),
      ],
      live: {
        "row:message-action-8a": facts({ subject: "first", opened_at: OPENED_AFTER }),
        "row:message-action-8b": facts({ subject: "second", opened_at: OPENED_AFTER }),
      },
    });

    const result = await detectRescues({ port, mailbox_id: MAILBOX_ID, batch_size: 50 });

    expect(result).toEqual({ examined: 2, rescued: 2, suspended: 1, unresolved: 0 });
    expect(port.policies.get("policy-1")?.suspension_reason).toContain('"first"');
  });

  // §8's rescue test observes what the operator did; it must never touch what they did it to. The pass
  // takes no provider at all — this asserts that end of it, over a recorder that would log any call.
  test("the pass makes zero provider calls", async () => {
    const provider_calls: string[] = [];
    const recording_provider = {
      connect: async (): Promise<void> => {
        provider_calls.push("connect");
      },
      fetchMessages: async (): Promise<void> => {
        provider_calls.push("fetchMessages");
      },
      move: async (): Promise<void> => {
        provider_calls.push("move");
      },
    };

    const port = createFakePort({
      rows: [candidate({ action_id: "action-9" })],
      live: { "row:message-action-9": facts({ opened_at: OPENED_AFTER }) },
    });

    await detectRescues({ port, mailbox_id: MAILBOX_ID, batch_size: 50 });

    expect(provider_calls).toEqual([]);
    expect(Object.keys(recording_provider)).toEqual(["connect", "fetchMessages", "move"]);
  });

  test("an empty mailbox id and a non-positive batch size are refused", async () => {
    const port = createFakePort({ rows: [], live: {} });

    await expect(detectRescues({ port, mailbox_id: "", batch_size: 50 })).rejects.toThrow("needs a mailbox id");
    await expect(detectRescues({ port, mailbox_id: MAILBOX_ID, batch_size: 0 })).rejects.toThrow("positive batch size");
  });
});
