import { describe, expect, test } from "bun:test";
import type { ActionStateSnapshot } from "@server/mail/actions/state";
import { serializeActionState } from "@server/mail/actions/state";
import type {
  DwellSuspensionEntry,
  LiveMessageFacts,
  PolicySuspensionEntry,
  RescueCandidateRow,
  RescueCursor,
  RescuePort,
  RescueStampEntry,
  SuspensionClears,
} from "@server/mail/rescue/detect";
import { detectRescues, messageAddressKey, rescueWindowStart, SWEEP_RESCUE_WINDOW_DAYS } from "@server/mail/rescue/detect";
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

const UNSEEN_AT_APPLY = JSON.stringify({ folder: "INBOX", flags: [], labels: null });
const SEEN_AT_APPLY = JSON.stringify({ folder: "INBOX", flags: ["\\Seen"], labels: null });

// Every nullable field tests `=== undefined` rather than using `??`: a fixture that defaults a
// deliberately-passed null disarms the very test that passed it — the null-policy case here would
// silently grow a policy and stop proving anything.
function candidate(input: {
  action_id: string;
  message_id?: string;
  sender_policy_id?: string | null;
  kind?: string;
  source?: string;
  to_state_json?: string | null;
  from_state_json?: string | null;
  applied_at?: Date;
}): RescueCandidateRow {
  return {
    action_id: input.action_id,
    message_id: input.message_id === undefined ? `message-${input.action_id}` : input.message_id,
    sender_policy_id: input.sender_policy_id === undefined ? "policy-1" : input.sender_policy_id,
    kind: input.kind === undefined ? "archive" : input.kind,
    source: input.source === undefined ? "address_policy" : input.source,
    to_state_json: input.to_state_json === undefined ? null : input.to_state_json,
    // Unseen at apply time by default: the precondition an `opened` rescue requires, and what every
    // pre-existing case in this file is implicitly about.
    from_state_json: input.from_state_json === undefined ? UNSEEN_AT_APPLY : input.from_state_json,
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
  dwell_suspensions: DwellSuspensionEntry[];
  first_contact_suspensions: DwellSuspensionEntry[];
  // The `since` each count was asked for, so a test can pin the window the detector computed.
  count_windows: { source: "sweep" | "first_contact"; since: Date }[];
};

// The fake holds the two properties the drizzle implementation holds in SQL, because a fake that did not
// would let the pass pass while the real thing re-suspended a policy on every run:
//   - loadRescueCandidates skips anything already stamped (`rescuedAt IS NULL`)
//   - suspendPolicy leaves an already-suspended policy alone (`WHERE suspendedAt IS NULL`)
function createFakePort(input: {
  rows: RescueCandidateRow[];
  live: Record<string, LiveMessageFacts>;
  policies?: Record<string, PolicyState>;
  // What the journal already holds for 1.11's rolling window, EXCLUDING whatever this pass stamps. The
  // real port counts stamped rows, so a test that wants the threshold reached seeds the earlier ones here.
  recent_sweep_rescues?: number;
  recent_first_contact_rescues?: number;
  // The same journal facts as timestamps, counted against the `since` the detector asks for — the only
  // way a fixture can show the window floor moving. Added to the numeric shorthand above.
  sweep_rescues_at?: Date[];
  first_contact_rescues_at?: Date[];
  suspension_clears?: SuspensionClears;
}): FakePort {
  const stamps = new Map<string, Date>();
  const lookups: MessageAddress[] = [];
  let batches = 0;
  const policies = new Map<string, PolicyState>(Object.entries(input.policies === undefined ? {} : input.policies));
  const dwell_suspensions: DwellSuspensionEntry[] = [];
  const first_contact_suspensions: DwellSuspensionEntry[] = [];
  const count_windows: { source: "sweep" | "first_contact"; since: Date }[] = [];

  function countSince(seed: number, stamped_at: Date[], since: Date): number {
    return seed + stamped_at.filter((rescued_at) => rescued_at.getTime() >= since.getTime()).length;
  }

  return {
    lookups,
    stamps,
    policies,
    dwell_suspensions,
    first_contact_suspensions,
    count_windows,
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
    countRecentSweepRescues: async (query: { mailbox_id: string; since: Date }): Promise<number> => {
      count_windows.push({ source: "sweep", since: query.since });
      return countSince(input.recent_sweep_rescues ?? 0, input.sweep_rescues_at ?? [], query.since);
    },
    suspendMailboxDwell: async (entry: DwellSuspensionEntry): Promise<boolean> => {
      dwell_suspensions.push(entry);
      return true;
    },
    countRecentFirstContactRescues: async (query: { mailbox_id: string; since: Date }): Promise<number> => {
      count_windows.push({ source: "first_contact", since: query.since });
      return countSince(input.recent_first_contact_rescues ?? 0, input.first_contact_rescues_at ?? [], query.since);
    },
    suspendMailboxFirstContact: async (entry: DwellSuspensionEntry): Promise<boolean> => {
      first_contact_suspensions.push(entry);
      return true;
    },
    loadSuspensionClears: async (): Promise<SuspensionClears> =>
      input.suspension_clears ?? { first_contact_cleared_at: null, dwell_cleared_at: null },
  };
}

// A fake that actually implements keyset pagination on (appliedAt, id), the way the drizzle port in
// journal.ts does — as opposed to createFakePort above, which just slices whatever `rows` it was given
// and ignores `after` entirely. Needed to prove chunking end-to-end: a fake that already returns
// everything in one call could never show the starvation this round of tests exists to catch.
function createPaginatedFakePort(rows: RescueCandidateRow[]): RescuePort & { calls: (RescueCursor | null)[] } {
  const sorted = [...rows].sort((a, b) => a.applied_at.getTime() - b.applied_at.getTime() || a.action_id.localeCompare(b.action_id));
  const calls: (RescueCursor | null)[] = [];
  const stamps = new Set<string>();

  return {
    calls,
    loadRescueCandidates: async (query: {
      mailbox_id: string;
      batch_size: number;
      after: RescueCursor | null;
    }): Promise<RescueCandidateRow[]> => {
      calls.push(query.after);
      const start =
        query.after === null
          ? 0
          : sorted.findIndex(
              (row) =>
                query.after !== null &&
                row.applied_at.getTime() === query.after.applied_at.getTime() &&
                row.action_id === query.after.action_id,
            ) + 1;
      return sorted.slice(start, start + query.batch_size).filter((row) => !stamps.has(row.action_id));
    },
    loadLiveMessages: async (query: { mailbox_id: string; addresses: MessageAddress[] }): Promise<Map<string, LiveMessageFacts>> => {
      const found = new Map<string, LiveMessageFacts>();
      for (const address of query.addresses) {
        found.set(messageAddressKey(address), facts({ opened_at: OPENED_AFTER }));
      }
      return found;
    },
    markRescued: async (entries: RescueStampEntry[]): Promise<void> => {
      for (const entry of entries) {
        stamps.add(entry.action_id);
      }
    },
    suspendPolicy: async (): Promise<boolean> => true,
    countRecentSweepRescues: async (): Promise<number> => 0,
    suspendMailboxDwell: async (): Promise<boolean> => false,
    countRecentFirstContactRescues: async (): Promise<number> => 0,
    suspendMailboxFirstContact: async (): Promise<boolean> => false,
    loadSuspensionClears: async (): Promise<SuspensionClears> => ({ first_contact_cleared_at: null, dwell_cleared_at: null }),
  };
}

// A fake whose cursor never moves: every call returns a full chunk regardless of `after`, simulating a
// pagination bug where the cursor fails to advance. Used only to prove MAX_CHUNK_ITERATIONS actually stops
// the loop and surfaces an error, rather than spinning or silently truncating.
function createStuckFakePort(chunk_size: number): RescuePort {
  const stuck_rows: RescueCandidateRow[] = Array.from({ length: chunk_size }, (_, index) =>
    candidate({ action_id: `stuck-${index}`, sender_policy_id: null }),
  );

  return {
    loadRescueCandidates: async (): Promise<RescueCandidateRow[]> => stuck_rows,
    loadLiveMessages: async (): Promise<Map<string, LiveMessageFacts>> => new Map(),
    markRescued: async (): Promise<void> => {},
    suspendPolicy: async (): Promise<boolean> => false,
    countRecentSweepRescues: async (): Promise<number> => 0,
    suspendMailboxDwell: async (): Promise<boolean> => false,
    countRecentFirstContactRescues: async (): Promise<number> => 0,
    suspendMailboxFirstContact: async (): Promise<boolean> => false,
    loadSuspensionClears: async (): Promise<SuspensionClears> => ({ first_contact_cleared_at: null, dwell_cleared_at: null }),
  };
}

describe("detectRescues", () => {
  test("an action whose message was opened after appliedAt suspends the policy and stamps the action", async () => {
    const port = createFakePort({
      rows: [candidate({ action_id: "action-1" })],
      live: { [rowKey("message-action-1")]: facts({ opened_at: OPENED_AFTER }) },
    });

    const result = await detectRescues({ port, mailbox_id: MAILBOX_ID, batch_size: 50 });

    expect(result).toEqual({
      examined: 1,
      rescued: 1,
      suspended: 1,
      unresolved: 0,
      dwell_suspended: false,
      first_contact_suspended: false,
    });
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

    expect(result).toEqual({
      examined: 1,
      rescued: 0,
      suspended: 0,
      unresolved: 0,
      dwell_suspended: false,
      first_contact_suspended: false,
    });
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
    expect(result).toEqual({
      examined: 1,
      rescued: 1,
      suspended: 1,
      unresolved: 0,
      dwell_suspended: false,
      first_contact_suspended: false,
    });
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

    expect(first).toEqual({ examined: 1, rescued: 1, suspended: 1, unresolved: 0, dwell_suspended: false, first_contact_suspended: false });
    expect(second).toEqual({
      examined: 0,
      rescued: 0,
      suspended: 0,
      unresolved: 0,
      dwell_suspended: false,
      first_contact_suspended: false,
    });
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
    expect(result).toEqual({
      examined: 1,
      rescued: 1,
      suspended: 0,
      unresolved: 0,
      dwell_suspended: false,
      first_contact_suspended: false,
    });
  });

  test("an action with no sender policy is stamped, suspends nothing, and does not throw", async () => {
    const port = createFakePort({
      rows: [candidate({ action_id: "action-6", sender_policy_id: null })],
      live: { [rowKey("message-action-6")]: facts({ opened_at: OPENED_AFTER }) },
    });

    const result = await detectRescues({ port, mailbox_id: MAILBOX_ID, batch_size: 50 });

    expect(result).toEqual({
      examined: 1,
      rescued: 1,
      suspended: 0,
      unresolved: 0,
      dwell_suspended: false,
      first_contact_suspended: false,
    });
    expect(port.stamps.has("action-6")).toBe(true);
    expect(port.policies.size).toBe(0);
  });

  test("an address that resolves to no live row is counted, not thrown on", async () => {
    const port = createFakePort({ rows: [candidate({ action_id: "action-7" })], live: {} });

    const result = await detectRescues({ port, mailbox_id: MAILBOX_ID, batch_size: 50 });

    expect(result).toEqual({
      examined: 1,
      rescued: 0,
      suspended: 0,
      unresolved: 1,
      dwell_suspended: false,
      first_contact_suspended: false,
    });
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

    expect(result).toEqual({
      examined: 2,
      rescued: 2,
      suspended: 1,
      unresolved: 0,
      dwell_suspended: false,
      first_contact_suspended: false,
    });
    expect(port.policies.get("policy-1")?.suspension_reason).toContain('"first"');
  });

  // §8's rescue test observes what the operator did; it must never touch what they did it to. That
  // guarantee is STRUCTURAL, not behavioural — the pass takes no provider, so no runtime assertion over a
  // recorder could ever fail — and this is where it is pinned: PORT_OPERATIONS is an exhaustive record
  // over `keyof RescuePort`, so the day someone widens the port with a provider, an IMAP client or any
  // other mailbox reach, tsc fails on the missing key and this test names the four operations the pass is
  // allowed to perform. The earlier version of this test ran a recorder that was never passed anywhere
  // and asserted it stayed empty, which could not fail and hid the real invariant. loadSuspensionClears
  // reads two Mailbox columns; it is a database read, not a mailbox reach.
  test("the port exposes exactly nine database operations and no way to reach a mailbox", async () => {
    const PORT_OPERATIONS: Record<keyof RescuePort, true> = {
      loadRescueCandidates: true,
      loadLiveMessages: true,
      markRescued: true,
      suspendPolicy: true,
      countRecentSweepRescues: true,
      suspendMailboxDwell: true,
      countRecentFirstContactRescues: true,
      suspendMailboxFirstContact: true,
      loadSuspensionClears: true,
    };

    const port = createFakePort({
      rows: [candidate({ action_id: "action-9" })],
      live: { [rowKey("message-action-9")]: facts({ opened_at: OPENED_AFTER }) },
    });
    const result = await detectRescues({ port, mailbox_id: MAILBOX_ID, batch_size: 50 });

    expect(Object.keys(PORT_OPERATIONS).sort()).toEqual([
      "countRecentFirstContactRescues",
      "countRecentSweepRescues",
      "loadLiveMessages",
      "loadRescueCandidates",
      "loadSuspensionClears",
      "markRescued",
      "suspendMailboxDwell",
      "suspendMailboxFirstContact",
      "suspendPolicy",
    ]);
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
    expect(result).toEqual({
      examined: 3,
      rescued: 2,
      suspended: 1,
      unresolved: 0,
      dwell_suspended: false,
      first_contact_suspended: false,
    });
  });

  test("an empty candidate set touches the port once and asks for no messages at all", async () => {
    const port = createFakePort({ rows: [], live: {} });

    const result = await detectRescues({ port, mailbox_id: MAILBOX_ID, batch_size: 50 });

    expect(port.batchCount()).toBe(0);
    expect(result).toEqual({
      examined: 0,
      rescued: 0,
      suspended: 0,
      unresolved: 0,
      dwell_suspended: false,
      first_contact_suspended: false,
    });
  });

  test("an empty mailbox id and a non-positive batch size are refused", async () => {
    const port = createFakePort({ rows: [], live: {} });

    await expect(detectRescues({ port, mailbox_id: "", batch_size: 50 })).rejects.toThrow("needs a mailbox id");
    await expect(detectRescues({ port, mailbox_id: MAILBOX_ID, batch_size: 0 })).rejects.toThrow("positive batch size");
  });

  // The regression this round of fixes exists for: a bulk apply lands far more candidates than one chunk
  // holds, all sorted to the front of the window because they share (or nearly share) an appliedAt. Against
  // the single-batch implementation this reads batch_size=2 once, examines 2 of 5, and reports a clean
  // `examined: 2, rescued: 2` that hides the other 3 forever (until they age out of the 30-day window) —
  // this test fails on that implementation because 5 !== 2.
  test("a candidate set larger than one chunk is fully examined, across chunks", async () => {
    const port = createPaginatedFakePort([
      candidate({ action_id: "action-p1", sender_policy_id: "policy-p1" }),
      candidate({ action_id: "action-p2", sender_policy_id: "policy-p2" }),
      candidate({ action_id: "action-p3", sender_policy_id: "policy-p3" }),
      candidate({ action_id: "action-p4", sender_policy_id: "policy-p4" }),
      candidate({ action_id: "action-p5", sender_policy_id: "policy-p5" }),
    ]);

    const result = await detectRescues({ port, mailbox_id: MAILBOX_ID, batch_size: 2 });

    expect(result).toEqual({
      examined: 5,
      rescued: 5,
      suspended: 5,
      unresolved: 0,
      dwell_suspended: false,
      first_contact_suspended: false,
    });
  });

  // Same scenario, checked from the other side: not just that every row eventually gets examined, but that
  // each round trip moves the cursor past the row it just read rather than re-reading page one until the
  // set happens to look exhausted from position zero.
  test("each chunk's cursor is the previous chunk's last row, not a repeat of the first page", async () => {
    const port = createPaginatedFakePort([
      candidate({ action_id: "action-c1", sender_policy_id: "policy-c1" }),
      candidate({ action_id: "action-c2", sender_policy_id: "policy-c2" }),
      candidate({ action_id: "action-c3", sender_policy_id: "policy-c3" }),
      candidate({ action_id: "action-c4", sender_policy_id: "policy-c4" }),
      candidate({ action_id: "action-c5", sender_policy_id: "policy-c5" }),
    ]);

    await detectRescues({ port, mailbox_id: MAILBOX_ID, batch_size: 2 });

    expect(port.calls).toEqual([
      null,
      { applied_at: APPLIED_AT, action_id: "action-c2" },
      { applied_at: APPLIED_AT, action_id: "action-c4" },
    ]);
  });

  // The loop breaker: a cursor that never advances must not spin forever or quietly under-report. It
  // throws, and the throw names both the shape of the problem and the numbers involved, which is what lets
  // a caller (server/mail/sync/run.ts's runRescuePassForMailbox) surface it as a real failure instead of a
  // clean-looking summary.
  test("a cursor that never advances hits the iteration cap and throws, rather than truncating silently", async () => {
    const port = createStuckFakePort(2);

    await expect(detectRescues({ port, mailbox_id: MAILBOX_ID, batch_size: 2 })).rejects.toThrow("did not finish within 500 chunks of 2");
  });

  // The 2026-08-22 production cascade, end to end: a message the operator had read years earlier, whose
  // openedAt the post-apply sync stamped later than appliedAt. Before the guard this stamped the action
  // AND suspended the policy; 1,562 of them suspended 34 policies in one run.
  test("a message already read when the rule moved it is examined but never rescued", async () => {
    const port = createFakePort({
      rows: [candidate({ action_id: "action-seen", from_state_json: SEEN_AT_APPLY })],
      live: { [rowKey("message-action-seen")]: facts({ opened_at: OPENED_AFTER }) },
    });

    const result = await detectRescues({ port, mailbox_id: MAILBOX_ID, batch_size: 50 });

    expect(result).toEqual({
      examined: 1,
      rescued: 0,
      suspended: 0,
      unresolved: 0,
      dwell_suspended: false,
      first_contact_suspended: false,
    });
    expect(port.stamps.size).toBe(0);
    expect(port.policies.size).toBe(0);
  });

  // Unknown apply-time state must not be read as "was unseen" — that would reopen the cascade for every
  // row whose state the executor could not record.
  test("an action with no recorded apply-time state is not rescued by an open", async () => {
    const port = createFakePort({
      rows: [candidate({ action_id: "action-nostate", from_state_json: null })],
      live: { [rowKey("message-action-nostate")]: facts({ opened_at: OPENED_AFTER }) },
    });

    const result = await detectRescues({ port, mailbox_id: MAILBOX_ID, batch_size: 50 });

    expect(result).toEqual({
      examined: 1,
      rescued: 0,
      suspended: 0,
      unresolved: 0,
      dwell_suspended: false,
      first_contact_suspended: false,
    });
    expect(port.stamps.size).toBe(0);
  });
});

// Inbox-dwell 1.11. A sweep action carries no senderPolicyId, so before this the detector hit
// `sender_policy_id === null` and dropped the rescue on the floor — leaving the newest and least-proven
// rule in the system as the only one running unattended with no safety net.
describe("rescues against the settled sweep (1.11)", () => {
  function sweepRow(action_id: string): RescueCandidateRow {
    return candidate({ action_id, sender_policy_id: null, source: "sweep_settled" });
  }

  test("one rescue is stamped and surfaced, but does NOT suspend the sweep", async () => {
    // Opening week-old archived mail is ordinary behaviour, not necessarily a mistake. Suspending on the
    // first event would make the sweep unusable for exactly the mail it is best at.
    const port = createFakePort({
      rows: [sweepRow("action-s1")],
      live: { [rowKey("message-action-s1")]: facts({ opened_at: OPENED_AFTER }) },
      recent_sweep_rescues: 1,
    });

    const result = await detectRescues({ port, mailbox_id: MAILBOX_ID, batch_size: 50 });

    expect(result.rescued).toBe(1);
    expect(result.dwell_suspended).toBe(false);
    expect(port.dwell_suspensions).toEqual([]);
    // Still stamped: the evidence has to accumulate somewhere for the threshold to ever be reached.
    expect(port.stamps.has("action-s1")).toBe(true);
  });

  test("three inside the window is a pattern, and suspends the mailbox's sweeps", async () => {
    const port = createFakePort({
      rows: [sweepRow("action-s2")],
      live: { [rowKey("message-action-s2")]: facts({ opened_at: OPENED_AFTER }) },
      recent_sweep_rescues: 3,
    });

    const result = await detectRescues({ port, mailbox_id: MAILBOX_ID, batch_size: 50 });

    expect(result.dwell_suspended).toBe(true);
    expect(port.dwell_suspensions).toHaveLength(1);
    expect(port.dwell_suspensions[0]?.mailbox_id).toBe(MAILBOX_ID);
    // The operator reads this sentence to decide whether the rule was wrong, so it has to say what
    // happened and that nothing is lost.
    expect(port.dwell_suspensions[0]?.reason).toContain("settled sweep");
    expect(port.dwell_suspensions[0]?.reason).toContain("declined sweep");
    expect(port.dwell_suspensions[0]?.reason).toContain("can be undone");
  });

  // The dwell suspension takes both sweeps out, so a rescue against either has to count toward it: a
  // declined-sweep rescue that went uncounted would leave that sweep running past the same evidence.
  test("a rescue against the declined sweep counts toward the same suspension", async () => {
    const port = createFakePort({
      rows: [candidate({ action_id: "action-d1", sender_policy_id: null, source: "sweep_declined" })],
      live: { [rowKey("message-action-d1")]: facts({ opened_at: OPENED_AFTER }) },
      recent_sweep_rescues: 3,
    });

    const result = await detectRescues({ port, mailbox_id: MAILBOX_ID, batch_size: 50 });

    expect(result.rescued).toBe(1);
    expect(result.dwell_suspended).toBe(true);
    expect(port.dwell_suspensions).toHaveLength(1);
    expect(port.stamps.has("action-d1")).toBe(true);
  });

  test("a rescue against a POLICY never touches the mailbox's dwell suspension", async () => {
    const port = createFakePort({
      rows: [candidate({ action_id: "action-p1" })],
      live: { [rowKey("message-action-p1")]: facts({ opened_at: OPENED_AFTER }) },
      recent_sweep_rescues: 99,
    });

    const result = await detectRescues({ port, mailbox_id: MAILBOX_ID, batch_size: 50 });

    // The policy is suspended, the sweep is untouched, and the window is never even consulted — a pass
    // with no sweep rescues must not spend a query asking about them.
    expect(result.suspended).toBe(1);
    expect(result.dwell_suspended).toBe(false);
    expect(port.dwell_suspensions).toEqual([]);
  });

  test("a rescue against the sweep never touches the first-contact suspension", async () => {
    const port = createFakePort({
      rows: [sweepRow("action-s3")],
      live: { [rowKey("message-action-s3")]: facts({ opened_at: OPENED_AFTER }) },
      recent_sweep_rescues: 3,
      recent_first_contact_rescues: 99,
    });

    const result = await detectRescues({ port, mailbox_id: MAILBOX_ID, batch_size: 50 });

    expect(result.dwell_suspended).toBe(true);
    expect(result.first_contact_suspended).toBe(false);
    expect(port.first_contact_suspensions).toEqual([]);
  });

  test("an action with no policy and no sweep source is still simply skipped", async () => {
    const port = createFakePort({
      rows: [candidate({ action_id: "action-n1", sender_policy_id: null, source: "derived" })],
      live: { [rowKey("message-action-n1")]: facts({ opened_at: OPENED_AFTER }) },
      recent_sweep_rescues: 99,
    });

    const result = await detectRescues({ port, mailbox_id: MAILBOX_ID, batch_size: 50 });

    expect(result.rescued).toBe(1);
    expect(result.dwell_suspended).toBe(false);
  });
});

// docs/decisions/2026-09-06-scheduled-source-autonomy-per-mailbox.md: a quarantined first contact carries
// no policy either, so its rescues get 1.11's treatment on the mailbox's own first-contact columns.
describe("rescues against first-contact quarantine", () => {
  function firstContactRow(action_id: string): RescueCandidateRow {
    return candidate({ action_id, sender_policy_id: null, source: "first_contact", kind: "quarantine" });
  }

  test("one rescue is stamped and surfaced, but does NOT suspend the switch", async () => {
    const port = createFakePort({
      rows: [firstContactRow("action-f1")],
      live: { [rowKey("message-action-f1")]: facts({ opened_at: OPENED_AFTER }) },
      recent_first_contact_rescues: 1,
    });

    const result = await detectRescues({ port, mailbox_id: MAILBOX_ID, batch_size: 50 });

    expect(result.rescued).toBe(1);
    expect(result.first_contact_suspended).toBe(false);
    expect(port.first_contact_suspensions).toEqual([]);
    expect(port.stamps.has("action-f1")).toBe(true);
  });

  test("three inside the window suspends the mailbox's first-contact quarantine, and only that", async () => {
    const port = createFakePort({
      rows: [firstContactRow("action-f2")],
      live: { [rowKey("message-action-f2")]: facts({ opened_at: OPENED_AFTER }) },
      recent_first_contact_rescues: 3,
      recent_sweep_rescues: 99,
    });

    const result = await detectRescues({ port, mailbox_id: MAILBOX_ID, batch_size: 50 });

    expect(result.first_contact_suspended).toBe(true);
    expect(result.dwell_suspended).toBe(false);
    expect(port.dwell_suspensions).toEqual([]);
    expect(port.first_contact_suspensions).toHaveLength(1);
    expect(port.first_contact_suspensions[0]?.mailbox_id).toBe(MAILBOX_ID);
    expect(port.first_contact_suspensions[0]?.reason).toContain("First-contact quarantine is suspended");
    expect(port.first_contact_suspensions[0]?.reason).toContain("can be undone");
  });

  test("a human-shaped first contact was never moved, so it can never be rescued", async () => {
    // keep_inbox rows are never applied, so the candidate query never returns one; this pins that a
    // first_contact_human row reaching the detector by some other route would still not count.
    const port = createFakePort({
      rows: [candidate({ action_id: "action-h1", sender_policy_id: null, source: "first_contact_human", kind: "keep_inbox" })],
      live: { [rowKey("message-action-h1")]: facts({ opened_at: OPENED_AFTER }) },
      recent_first_contact_rescues: 99,
    });

    const result = await detectRescues({ port, mailbox_id: MAILBOX_ID, batch_size: 50 });

    expect(result.first_contact_suspended).toBe(false);
    expect(port.first_contact_suspensions).toEqual([]);
  });
});

// docs/decisions/2026-09-06-clear-suspension-resets-the-window.md: the operator presses Clear after judging
// the three rescues that caused the suspension. Without the floor those three are still inside the 30-day
// window, so the next single rescue re-suspends quoting them, and Clear buys one mistake rather than a
// second chance.
describe("the rescue window is floored at the operator's last clear", () => {
  function daysAgo(days: number): Date {
    return new Date(Date.now() - days * 86_400_000);
  }

  function sweepRow(action_id: string): RescueCandidateRow {
    return candidate({ action_id, sender_policy_id: null, source: "sweep_settled" });
  }

  function firstContactRow(action_id: string): RescueCandidateRow {
    return candidate({ action_id, sender_policy_id: null, source: "first_contact", kind: "quarantine" });
  }

  test("rescueWindowStart is 30 days back with no clear, the clear when it is more recent, and 30 days back for an older one", () => {
    const now = new Date("2026-09-06T12:00:00.000Z");
    const window_start = new Date(now.getTime() - SWEEP_RESCUE_WINDOW_DAYS * 86_400_000);

    expect(rescueWindowStart({ now, cleared_at: null })).toEqual(window_start);
    expect(rescueWindowStart({ now, cleared_at: new Date("2026-09-01T00:00:00.000Z") })).toEqual(new Date("2026-09-01T00:00:00.000Z"));
    expect(rescueWindowStart({ now, cleared_at: new Date("2026-06-01T00:00:00.000Z") })).toEqual(window_start);
  });

  test("three sweep rescues before the clear plus one after do NOT suspend", async () => {
    const cleared_at = daysAgo(5);
    const port = createFakePort({
      rows: [sweepRow("action-w1")],
      live: { [rowKey("message-action-w1")]: facts({ opened_at: OPENED_AFTER }) },
      sweep_rescues_at: [daysAgo(10), daysAgo(9), daysAgo(8), daysAgo(2)],
      suspension_clears: { first_contact_cleared_at: null, dwell_cleared_at: cleared_at },
    });

    const result = await detectRescues({ port, mailbox_id: MAILBOX_ID, batch_size: 50 });

    expect(result.rescued).toBe(1);
    expect(result.dwell_suspended).toBe(false);
    expect(port.dwell_suspensions).toEqual([]);
    expect(port.count_windows).toHaveLength(1);
    expect(port.count_windows[0]?.since).toBe(cleared_at);
  });

  test("three sweep rescues after the clear suspend, and the reason names the clear rather than the 30 days", async () => {
    const cleared_at = daysAgo(5);
    const port = createFakePort({
      rows: [sweepRow("action-w2")],
      live: { [rowKey("message-action-w2")]: facts({ opened_at: OPENED_AFTER }) },
      sweep_rescues_at: [daysAgo(10), daysAgo(4), daysAgo(3), daysAgo(1)],
      suspension_clears: { first_contact_cleared_at: null, dwell_cleared_at: cleared_at },
    });

    const result = await detectRescues({ port, mailbox_id: MAILBOX_ID, batch_size: 50 });

    expect(result.dwell_suspended).toBe(true);
    expect(port.dwell_suspensions).toHaveLength(1);
    expect(port.dwell_suspensions[0]?.reason).toContain(`since you cleared the suspension on ${cleared_at.toISOString().slice(0, 10)}`);
    expect(port.dwell_suspensions[0]?.reason).not.toContain("within the last");
  });

  test("with no clear the window is the last 30 days, exactly as before", async () => {
    const port = createFakePort({
      rows: [sweepRow("action-w3")],
      live: { [rowKey("message-action-w3")]: facts({ opened_at: OPENED_AFTER }) },
      sweep_rescues_at: [daysAgo(29), daysAgo(20), daysAgo(10), daysAgo(45)],
    });

    const result = await detectRescues({ port, mailbox_id: MAILBOX_ID, batch_size: 50 });

    expect(result.dwell_suspended).toBe(true);
    expect(port.dwell_suspensions[0]?.reason).toContain(`within the last ${SWEEP_RESCUE_WINDOW_DAYS} days`);
    const since = port.count_windows[0]?.since.getTime() ?? 0;
    expect(Math.abs(since - daysAgo(SWEEP_RESCUE_WINDOW_DAYS).getTime())).toBeLessThan(5_000);
  });

  test("a clear older than the window changes nothing", async () => {
    const port = createFakePort({
      rows: [sweepRow("action-w4")],
      live: { [rowKey("message-action-w4")]: facts({ opened_at: OPENED_AFTER }) },
      sweep_rescues_at: [daysAgo(29), daysAgo(20), daysAgo(10)],
      suspension_clears: { first_contact_cleared_at: null, dwell_cleared_at: daysAgo(60) },
    });

    const result = await detectRescues({ port, mailbox_id: MAILBOX_ID, batch_size: 50 });

    expect(result.dwell_suspended).toBe(true);
    expect(port.dwell_suspensions[0]?.reason).toContain("within the last");
  });

  test("each pair reads its own clear: a first-contact clear does not floor the sweep count, and vice versa", async () => {
    const port = createFakePort({
      rows: [sweepRow("action-w5"), firstContactRow("action-w6")],
      live: {
        [rowKey("message-action-w5")]: facts({ opened_at: OPENED_AFTER }),
        [rowKey("message-action-w6")]: facts({ opened_at: OPENED_AFTER }),
      },
      sweep_rescues_at: [daysAgo(10), daysAgo(9), daysAgo(8)],
      first_contact_rescues_at: [daysAgo(10), daysAgo(9), daysAgo(8)],
      suspension_clears: { first_contact_cleared_at: daysAgo(5), dwell_cleared_at: null },
    });

    const result = await detectRescues({ port, mailbox_id: MAILBOX_ID, batch_size: 50 });

    expect(result.dwell_suspended).toBe(true);
    expect(result.first_contact_suspended).toBe(false);
    expect(port.first_contact_suspensions).toEqual([]);
  });

  test("three first-contact rescues after the clear suspend the quarantine", async () => {
    const port = createFakePort({
      rows: [firstContactRow("action-w7")],
      live: { [rowKey("message-action-w7")]: facts({ opened_at: OPENED_AFTER }) },
      first_contact_rescues_at: [daysAgo(4), daysAgo(3), daysAgo(1)],
      suspension_clears: { first_contact_cleared_at: daysAgo(5), dwell_cleared_at: null },
    });

    const result = await detectRescues({ port, mailbox_id: MAILBOX_ID, batch_size: 50 });

    expect(result.first_contact_suspended).toBe(true);
    expect(port.first_contact_suspensions).toHaveLength(1);
  });

  test("a pass that rescued nothing never reads the clears", async () => {
    let reads = 0;
    const port = createFakePort({
      rows: [sweepRow("action-w8")],
      live: { [rowKey("message-action-w8")]: facts({ opened_at: OPENED_BEFORE }) },
    });
    port.loadSuspensionClears = async (): Promise<SuspensionClears> => {
      reads += 1;
      return { first_contact_cleared_at: null, dwell_cleared_at: null };
    };

    const result = await detectRescues({ port, mailbox_id: MAILBOX_ID, batch_size: 50 });

    expect(result.rescued).toBe(0);
    expect(reads).toBe(0);
    expect(port.count_windows).toEqual([]);
  });
});
