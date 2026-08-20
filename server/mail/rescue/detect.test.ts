import { describe, expect, test } from "bun:test";
import type { ActionStateSnapshot } from "@server/mail/actions/state";
import { serializeActionState } from "@server/mail/actions/state";
import type { LiveMessageFacts, PolicySuspensionEntry, RescueCandidateRow, RescuePort, RescueStampEntry } from "@server/mail/rescue/detect";
import { detectRescues, messageAddressKey } from "@server/mail/rescue/detect";
import type { MessageAddress } from "@server/mail/rescue/locate";

const MAILBOX_ID = "mailbox-generic";
const UID_VALIDITY = "38504";
const APPLIED_AT = new Date("2026-08-20T09:00:00.000Z");
const OPENED_AFTER = new Date("2026-08-21T07:30:00.000Z");
const OPENED_BEFORE = new Date("2026-08-19T16:00:00.000Z");
const REPLIED_AFTER = new Date("2026-08-22T11:15:00.000Z");

// The fixtures key their live rows with the production key function, so a fake row can exist at the
// moved-to address while the row the action names holds the dead one — the whole hazard this pass has to
// survive — and so a change to the key spelling cannot pass here while breaking the drizzle side.
function rowKey(message_id: string): string {
  return messageAddressKey({ by: "row", message_id });
}

function movedKey(folder: string, uid: number): string {
  return messageAddressKey({ by: "address", folder, uid, uid_validity: UID_VALIDITY });
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
  // How many times the batch loader was called. The point of the set-based port is that this stays at one
  // however many candidates a pass judges.
  batchCount: () => number;
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
  let batches = 0;
  const policies = new Map<string, PolicyState>(Object.entries(input.policies === undefined ? {} : input.policies));

  return {
    lookups,
    stamps,
    policies,
    batchCount: (): number => batches,
    loadRescueCandidates: async (query: { mailbox_id: string; batch_size: number }): Promise<RescueCandidateRow[]> => {
      return input.rows.filter((row) => !stamps.has(row.action_id)).slice(0, query.batch_size);
    },
    loadLiveMessages: async (query: { mailbox_id: string; addresses: MessageAddress[] }): Promise<Map<string, LiveMessageFacts>> => {
      batches += 1;
      lookups.push(...query.addresses);

      const found = new Map<string, LiveMessageFacts>();
      for (const address of query.addresses) {
        const facts = input.live[messageAddressKey(address)];
        if (facts !== undefined) {
          found.set(messageAddressKey(address), facts);
        }
      }
      return found;
    },
    markRescued: async (entries: RescueStampEntry[]): Promise<void> => {
      for (const entry of entries) {
        if (!stamps.has(entry.action_id)) {
          stamps.set(entry.action_id, entry.rescued_at);
        }
      }
    },
    suspendPolicy: async (entry: PolicySuspensionEntry): Promise<boolean> => {
      const existing = policies.get(entry.sender_policy_id);
      if (existing !== undefined && existing.suspended_at !== null) {
        return false;
      }
      policies.set(entry.sender_policy_id, { suspended_at: entry.suspended_at, suspension_reason: entry.reason });
      return true;
    },
  };
}

describe("detectRescues", () => {
  test("an action whose message was opened after appliedAt suspends the policy and stamps the action", async () => {
    const port = createFakePort({
      rows: [candidate({ action_id: "action-1" })],
      live: { [rowKey("message-action-1")]: facts({ opened_at: OPENED_AFTER }) },
    });

    const result = await detectRescues({ port, mailbox_id: MAILBOX_ID, batch_size: 50 });

    expect(result).toEqual({ examined: 1, rescued: 1, suspended: 1, unresolved: 0 });
    expect(port.stamps.has("action-1")).toBe(true);
    expect(port.policies.get("policy-1")?.suspension_reason).toBe(
      'rescued: you opened "xneelo Tax Invoice I260024265760" on 2026-08-21 07:30 UTC after this rule archived it on 2026-08-20 09:00 UTC. The rule is suspended until you clear it; the action is in the journal and can be undone.',
    );
  });

  test("a reply after appliedAt is reported as the signal, outranking an open", async () => {
    const port = createFakePort({
      rows: [candidate({ action_id: "action-reply" })],
      live: { [rowKey("message-action-reply")]: facts({ opened_at: OPENED_AFTER, last_reply_at: REPLIED_AFTER }) },
    });

    await detectRescues({ port, mailbox_id: MAILBOX_ID, batch_size: 50 });

    expect(port.policies.get("policy-1")?.suspension_reason).toContain("you replied to");
    expect(port.policies.get("policy-1")?.suspension_reason).toContain("on 2026-08-22");
  });

  test("an action whose message was opened BEFORE appliedAt suspends nothing and stamps nothing", async () => {
    const port = createFakePort({
      rows: [candidate({ action_id: "action-2" })],
      live: { [rowKey("message-action-2")]: facts({ opened_at: OPENED_BEFORE }) },
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
        [rowKey("dead-row")]: facts({ subject: "stale copy", opened_at: null }),
        [movedKey("Archive", 517)]: facts({ subject: "xneelo Tax Invoice I260024265760", opened_at: OPENED_AFTER }),
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
      live: { [rowKey("message-action-4")]: facts({ opened_at: OPENED_AFTER }) },
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
      live: { [rowKey("message-action-5")]: facts({ opened_at: OPENED_AFTER }) },
      policies: { "policy-1": { suspended_at: original_at, suspension_reason: "rescued: you opened an earlier message" } },
    });

    const result = await detectRescues({ port, mailbox_id: MAILBOX_ID, batch_size: 50 });

    expect(port.policies.get("policy-1")).toEqual({
      suspended_at: original_at,
      suspension_reason: "rescued: you opened an earlier message",
    });
    expect(port.stamps.has("action-5")).toBe(true);
    // A real rescue, so it is stamped — but NOT a new suspension. The count reports what the guard did,
    // not what the pass attempted.
    expect(result).toEqual({ examined: 1, rescued: 1, suspended: 0, unresolved: 0 });
  });

  test("an action with no sender policy is stamped, suspends nothing, and does not throw", async () => {
    const port = createFakePort({
      rows: [candidate({ action_id: "action-6", sender_policy_id: null })],
      live: { [rowKey("message-action-6")]: facts({ opened_at: OPENED_AFTER }) },
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
        [rowKey("message-action-8a")]: facts({ subject: "first", opened_at: OPENED_AFTER }),
        [rowKey("message-action-8b")]: facts({ subject: "second", opened_at: OPENED_AFTER }),
      },
    });

    const result = await detectRescues({ port, mailbox_id: MAILBOX_ID, batch_size: 50 });

    expect(result).toEqual({ examined: 2, rescued: 2, suspended: 1, unresolved: 0 });
    expect(port.policies.get("policy-1")?.suspension_reason).toContain('"first"');
  });

  // §8's rescue test observes what the operator did; it must never touch what they did it to. That
  // guarantee is STRUCTURAL, not behavioural — the pass takes no provider, so no runtime assertion over a
  // recorder could ever fail — and this is where it is pinned: PORT_OPERATIONS is an exhaustive record
  // over `keyof RescuePort`, so the day someone widens the port with a provider, an IMAP client or any
  // other mailbox reach, tsc fails on the missing key and this test names the four operations the pass is
  // allowed to perform. The earlier version of this test ran a recorder that was never passed anywhere
  // and asserted it stayed empty, which could not fail and hid the real invariant.
  test("the port exposes exactly four database operations and no way to reach a mailbox", async () => {
    const PORT_OPERATIONS: Record<keyof RescuePort, true> = {
      loadRescueCandidates: true,
      loadLiveMessages: true,
      markRescued: true,
      suspendPolicy: true,
    };

    const port = createFakePort({
      rows: [candidate({ action_id: "action-9" })],
      live: { [rowKey("message-action-9")]: facts({ opened_at: OPENED_AFTER }) },
    });
    const result = await detectRescues({ port, mailbox_id: MAILBOX_ID, batch_size: 50 });

    expect(Object.keys(PORT_OPERATIONS).sort()).toEqual(["loadLiveMessages", "loadRescueCandidates", "markRescued", "suspendPolicy"]);
    expect(result.rescued).toBe(1);
  });

  // The set-based port earns its shape here: the thread half of these facts costs a scan of the mailbox,
  // so one call per candidate was ~7,900 scans of ~30,000 rows every sync on the largest mailbox.
  test("the whole batch is resolved in ONE call to the port, whatever the candidate count", async () => {
    const port = createFakePort({
      rows: [candidate({ action_id: "action-10a" }), candidate({ action_id: "action-10b" }), candidate({ action_id: "action-10c" })],
      live: {
        [rowKey("message-action-10a")]: facts({ opened_at: OPENED_AFTER }),
        [rowKey("message-action-10b")]: facts({ opened_at: OPENED_BEFORE }),
        [rowKey("message-action-10c")]: facts({ opened_at: OPENED_AFTER }),
      },
    });

    const result = await detectRescues({ port, mailbox_id: MAILBOX_ID, batch_size: 50 });

    expect(port.batchCount()).toBe(1);
    expect(port.lookups).toHaveLength(3);
    expect(result).toEqual({ examined: 3, rescued: 2, suspended: 1, unresolved: 0 });
  });

  test("an empty candidate set touches the port once and asks for no messages at all", async () => {
    const port = createFakePort({ rows: [], live: {} });

    const result = await detectRescues({ port, mailbox_id: MAILBOX_ID, batch_size: 50 });

    expect(port.batchCount()).toBe(0);
    expect(result).toEqual({ examined: 0, rescued: 0, suspended: 0, unresolved: 0 });
  });

  test("an empty mailbox id and a non-positive batch size are refused", async () => {
    const port = createFakePort({ rows: [], live: {} });

    await expect(detectRescues({ port, mailbox_id: "", batch_size: 50 })).rejects.toThrow("needs a mailbox id");
    await expect(detectRescues({ port, mailbox_id: MAILBOX_ID, batch_size: 0 })).rejects.toThrow("positive batch size");
  });
});
