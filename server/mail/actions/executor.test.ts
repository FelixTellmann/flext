import { describe, expect, test } from "bun:test";
import type { ActionJournal, ExecuteActionsResult, PendingActionRow } from "@server/mail/actions/executor";
import { executeActions } from "@server/mail/actions/executor";
import { FILE_DEFERRED_REASON, GMAIL_INBOX_LABEL, inverseOf, planFor } from "@server/mail/actions/kinds";
import type { ActionStateSnapshot } from "@server/mail/actions/state";
import { parseActionState, serializeActionState } from "@server/mail/actions/state";
import type {
  CopyUidResult,
  FetchedMessage,
  FlagChangeResult,
  FolderInfo,
  FolderStatus,
  LabelChange,
  LabelResult,
  MailboxProvider,
  MessageIdentity,
} from "@server/mail/providers/types";
import { GMAIL_CANONICAL_FOLDER } from "@server/mail/types";

const UID_VALIDITY = "38504";
const DESTINATION_UID_VALIDITY = "77001";
const ARCHIVE_FOLDER = "Archives/2026";
const TRASH_FOLDER = "Deleted Items";
const GMAIL_TRASH_FOLDER = "[Gmail]/Trash";

type FakeMessage = { uid: number; flags: string[]; labels: string[] | null };

type ProviderFailure = "open" | "fetch" | "move" | "set_labels";

type FakeProviderOptions = {
  events: string[];
  messages: FakeMessage[];
  folder?: string;
  gmail?: boolean;
  archive_folder?: string | null;
  trash_folder?: string | null;
  unconfirmed_uids?: number[];
  fail?: ProviderFailure;
};

function fetchedMessage(entry: FakeMessage): FetchedMessage {
  return {
    uid: entry.uid,
    flags: [...entry.flags],
    modseq: null,
    internal_date: new Date("2026-08-19T10:00:00.000Z"),
    size: 1024,
    gm_msgid: null,
    gm_thrid: null,
    labels: entry.labels === null ? null : [...entry.labels],
    envelope: { subject: null, message_id: null, in_reply_to: null, date: null, from: [], to: [], cc: [] },
    headers: {},
  };
}

function createFakeProvider(options: FakeProviderOptions): MailboxProvider {
  const { events } = options;
  const source_folder = options.folder ?? "INBOX";
  const gmail = options.gmail ?? false;
  const unconfirmed = options.unconfirmed_uids ?? [];

  const folders: FolderInfo[] = [{ path: source_folder, delimiter: "/", special_use: null, subscribed: true, selectable: true }];
  const archive = options.archive_folder === undefined ? ARCHIVE_FOLDER : options.archive_folder;
  const trash = options.trash_folder === undefined ? TRASH_FOLDER : options.trash_folder;
  if (archive !== null) {
    folders.push({ path: archive, delimiter: "/", special_use: "\\Archive", subscribed: true, selectable: true });
  }
  if (trash !== null) {
    folders.push({ path: trash, delimiter: "/", special_use: "\\Trash", subscribed: true, selectable: true });
  }

  function unsupported(name: string): never {
    throw new Error(`${name} is not part of this fixture`);
  }

  return {
    capabilities: { condstore: true, qresync: true, uidplus: true, move: true, gmail },

    listFolders: async () => {
      events.push("list_folders");
      return folders;
    },

    openFolder: async (folder: string): Promise<FolderStatus> => {
      events.push(`open ${folder}`);
      if (options.fail === "open") {
        throw new Error(`could not open folder ${folder}`);
      }
      return { path: folder, uid_validity: UID_VALIDITY, uid_next: 900, highest_modseq: null, exists: options.messages.length };
    },

    fetchHeaders: async (folder: string, uid_range: string): Promise<FetchedMessage[]> => {
      events.push(`fetch ${folder} ${uid_range}`);
      if (options.fail === "fetch") {
        throw new Error(`could not read ${folder}`);
      }
      const requested = new Set(uid_range.split(",").map((value) => Number(value)));
      return options.messages.filter((entry) => requested.has(entry.uid)).map(fetchedMessage);
    },

    moveMessages: async (folder: string, uids: number[], target_folder: string): Promise<CopyUidResult> => {
      events.push(`move ${folder} ${uids.join(",")} -> ${target_folder}`);
      if (options.fail === "move") {
        throw new Error(`UID MOVE into ${target_folder} was rejected`);
      }
      const moved = uids.filter((uid) => !unconfirmed.includes(uid));
      return {
        target_folder,
        destination_uid_validity: DESTINATION_UID_VALIDITY,
        pairs: moved.map((uid, index) => ({ source_uid: uid, destination_uid: 9000 + index })),
        unconfirmed_uids: uids.filter((uid) => unconfirmed.includes(uid)),
      };
    },

    setLabels: async (folder: string, uids: number[], change: LabelChange): Promise<LabelResult> => {
      events.push(`set_labels ${folder} ${uids.join(",")} +[${change.add_labels.join(",")}] -[${change.remove_labels.join(",")}]`);
      if (options.fail === "set_labels") {
        throw new Error("STORE X-GM-LABELS was rejected");
      }
      return { folder, uids, added_labels: change.add_labels, removed_labels: change.remove_labels };
    },

    fetchIdentities: async (): Promise<MessageIdentity[]> => unsupported("fetchIdentities"),
    fetchFlagChanges: async (): Promise<FlagChangeResult> => unsupported("fetchFlagChanges"),
    listUids: async (): Promise<number[]> => unsupported("listUids"),
    disconnect: async () => undefined,
  };
}

type JournalRow = {
  status: string;
  from_state_json: string | null;
  to_state_json: string | null;
  error: string | null;
};

type CrashPoint = "record_from_state" | "mark_applied";

type FakeJournal = ActionJournal & { rows: Map<string, JournalRow> };

function createFakeJournal(input: {
  events: string[];
  pending: PendingActionRow[];
  crash_at?: CrashPoint;
  // A pre-state already on the row, as a run that crashed after mutating would have left it.
  seeded_from_state?: Record<string, string>;
}): FakeJournal {
  const rows = new Map<string, JournalRow>(
    input.pending.map((row) => [
      row.action_id,
      { status: "pending", from_state_json: input.seeded_from_state?.[row.action_id] ?? null, to_state_json: null, error: null },
    ]),
  );

  function requireRow(action_id: string): JournalRow {
    const row = rows.get(action_id);
    if (row === undefined) {
      throw new Error(`the journal was asked to update unknown action ${action_id}`);
    }
    return row;
  }

  return {
    rows,

    loadPendingActions: async () => {
      input.events.push("load_pending");
      return input.pending;
    },

    recordFromState: async (entries) => {
      input.events.push(`record_from_state ${entries.map((entry) => entry.action_id).join(",")}`);
      if (input.crash_at === "record_from_state") {
        throw new Error("the process died while journalling the pre-state");
      }
      for (const entry of entries) {
        const row = requireRow(entry.action_id);
        // Mirrors the WHERE clause in journal.ts exactly: a row that already carries a pre-state is not
        // touched at all. The first capture is the truth.
        if (row.from_state_json !== null && row.from_state_json !== "") {
          continue;
        }
        row.status = "pending";
        row.from_state_json = entry.from_state_json;
      }
    },

    markApplied: async (entries) => {
      input.events.push(`mark_applied ${entries.map((entry) => entry.action_id).join(",")}`);
      // The simulated crash: the mutation has already gone out to the server and the process dies before
      // the status can be advanced.
      if (input.crash_at === "mark_applied") {
        throw new Error("the process died between the mutation and the status update");
      }
      for (const entry of entries) {
        const row = requireRow(entry.action_id);
        row.status = "applied";
        row.to_state_json = entry.to_state_json;
        row.error = null;
      }
    },

    markFailed: async (entries) => {
      input.events.push(`mark_failed ${entries.map((entry) => entry.action_id).join(",")}`);
      for (const entry of entries) {
        const row = requireRow(entry.action_id);
        row.status = "failed";
        row.error = entry.error;
      }
    },

    markDeferred: async (entries) => {
      input.events.push(`mark_deferred ${entries.map((entry) => entry.action_id).join(",")}`);
      for (const entry of entries) {
        const row = requireRow(entry.action_id);
        row.status = "deferred";
        row.error = entry.reason;
      }
    },

    // Undo's half of the journal port. The executor never reads or writes it, so reaching one here is a
    // wiring bug rather than a case to fixture; server/mail/actions/undo.test.ts exercises them.
    loadActionForUndo: async () => {
      throw new Error("loadActionForUndo is not part of this fixture");
    },
    loadUndoableActionsByPolicy: async () => {
      throw new Error("loadUndoableActionsByPolicy is not part of this fixture");
    },
    markUndone: async () => {
      throw new Error("markUndone is not part of this fixture");
    },
    recordUndoFailure: async () => {
      throw new Error("recordUndoFailure is not part of this fixture");
    },
    // Promotion's half of the journal port. The executor never reads or writes it, so reaching one here is
    // a wiring bug rather than a case to fixture; server/mail/actions/promote.test.ts exercises them.
    loadActionForPromotion: async () => {
      throw new Error("loadActionForPromotion is not part of this fixture");
    },
    loadShadowActionsByPolicy: async () => {
      throw new Error("loadShadowActionsByPolicy is not part of this fixture");
    },
    promoteShadowActions: async () => {
      throw new Error("promoteShadowActions is not part of this fixture");
    },
  };
}

function pendingRow(input: { uid: number; kind: PendingActionRow["kind"]; folder?: string; action_id?: string }): PendingActionRow {
  return {
    action_id: input.action_id ?? `action-${input.uid}`,
    message_id: `message-${input.uid}`,
    kind: input.kind,
    run_id: "run-1",
    folder: input.folder ?? "INBOX",
    uid: input.uid,
  };
}

function indexOfEvent(events: string[], prefix: string): number {
  return events.findIndex((event) => event.startsWith(prefix));
}

describe("executeActions ordering (§7.1)", () => {
  test("journals from_state at pending BEFORE the mutation is issued", async () => {
    const events: string[] = [];
    const pending = [pendingRow({ uid: 11, kind: "auto_trash" })];
    const journal = createFakeJournal({ events, pending });
    const provider = createFakeProvider({ events, messages: [{ uid: 11, flags: ["\\Seen"], labels: null }] });

    const result = await executeActions({ mailbox_id: "mailbox-1", flavor: "generic", provider, journal, batch_size: 50 });

    expect(result).toEqual({ examined: 1, applied: 1, failed: 0, deferred: 0 } satisfies ExecuteActionsResult);

    const read_at = indexOfEvent(events, "fetch INBOX");
    const journalled_at = indexOfEvent(events, "record_from_state");
    const mutated_at = indexOfEvent(events, "move INBOX");
    const applied_at = indexOfEvent(events, "mark_applied");

    expect(read_at).toBeGreaterThanOrEqual(0);
    expect(read_at).toBeLessThan(journalled_at);
    expect(journalled_at).toBeLessThan(mutated_at);
    expect(mutated_at).toBeLessThan(applied_at);
  });

  test("a crash between the mutation and the status update leaves a pending row holding the pre-state", async () => {
    const events: string[] = [];
    const pending = [pendingRow({ uid: 11, kind: "auto_trash" })];
    const journal = createFakeJournal({ events, pending, crash_at: "mark_applied" });
    const provider = createFakeProvider({ events, messages: [{ uid: 11, flags: ["\\Seen", "\\Flagged"], labels: null }] });

    await expect(executeActions({ mailbox_id: "mailbox-1", flavor: "generic", provider, journal, batch_size: 50 })).rejects.toThrow(
      "the process died between the mutation and the status update",
    );

    // The mailbox really was mutated, so this is the exact window the ordering exists to survive.
    expect(events).toContain(`move INBOX 11 -> ${TRASH_FOLDER}`);

    const row = journal.rows.get("action-11");
    expect(row?.status).toBe("pending");
    expect(row?.to_state_json).toBeNull();
    expect(parseActionState(row?.from_state_json ?? null)).toEqual({
      folder: "INBOX",
      uid: 11,
      uid_validity: UID_VALIDITY,
      flags: ["\\Flagged", "\\Seen"],
      labels: null,
    });
  });

  test("a crash while journalling the pre-state leaves the mailbox untouched", async () => {
    const events: string[] = [];
    const pending = [pendingRow({ uid: 11, kind: "auto_trash" })];
    const journal = createFakeJournal({ events, pending, crash_at: "record_from_state" });
    const provider = createFakeProvider({ events, messages: [{ uid: 11, flags: [], labels: null }] });

    await expect(executeActions({ mailbox_id: "mailbox-1", flavor: "generic", provider, journal, batch_size: 50 })).rejects.toThrow(
      "the process died while journalling the pre-state",
    );

    expect(events.some((event) => event.startsWith("move "))).toBe(false);
    expect(journal.rows.get("action-11")?.status).toBe("pending");
  });

  test("a re-run of a crashed row keeps the original pre-state, so undo still has a real inverse", async () => {
    const events: string[] = [];
    const pending = [pendingRow({ uid: 21, kind: "archive", folder: GMAIL_CANONICAL_FOLDER })];

    // What the crashed run journalled before it mutated: the message still carried \Inbox.
    const original_from_state: ActionStateSnapshot = {
      folder: GMAIL_CANONICAL_FOLDER,
      uid: 21,
      uid_validity: UID_VALIDITY,
      flags: ["\\Seen"],
      labels: [GMAIL_INBOX_LABEL, "Work"],
    };
    const journalled = serializeActionState(original_from_state);
    const journal = createFakeJournal({ events, pending, seeded_from_state: { "action-21": journalled } });

    // The mailbox as that crash left it: \Inbox already removed, and on Gmail the UID survives a label
    // removal, so this re-capture succeeds where a generic mailbox's would have failed on a missing UID.
    const provider = createFakeProvider({
      events,
      gmail: true,
      folder: GMAIL_CANONICAL_FOLDER,
      trash_folder: GMAIL_TRASH_FOLDER,
      messages: [{ uid: 21, flags: ["\\Seen"], labels: ["Work"] }],
    });

    const result = await executeActions({ mailbox_id: "mailbox-1", flavor: "gmail", provider, journal, batch_size: 50 });

    // Re-issuing the mutation is harmless — removing an absent label changes nothing — and finishes the row.
    expect(result).toEqual({ examined: 1, applied: 1, failed: 0, deferred: 0 } satisfies ExecuteActionsResult);
    expect(events).toContain(`set_labels ${GMAIL_CANONICAL_FOLDER} 21 +[] -[${GMAIL_INBOX_LABEL}]`);

    const row = journal.rows.get("action-21");
    expect(row?.status).toBe("applied");
    expect(row?.from_state_json).toBe(journalled);

    const recovered = parseActionState(row?.from_state_json ?? null);
    expect(recovered?.labels).toEqual(["Work", GMAIL_INBOX_LABEL]);

    const plan = planFor("archive", "gmail", {
      source_folder: GMAIL_CANONICAL_FOLDER,
      archive_folder: null,
      trash_folder: GMAIL_TRASH_FOLDER,
    });
    if (plan.outcome !== "planned") {
      throw new Error("a Gmail archive must produce a planned action");
    }

    // The point of the whole rule: undo restores the label from the surviving pre-state.
    expect(inverseOf(plan, recovered ?? original_from_state)).toEqual([
      { verb: "set_labels", add_labels: [GMAIL_INBOX_LABEL], remove_labels: [] },
    ]);

    // And the counterfactual it exists to prevent — had the re-capture overwritten the pre-state, the
    // inverse would be empty and undo would report a clean reversal that changed nothing.
    expect(inverseOf(plan, { folder: GMAIL_CANONICAL_FOLDER, flags: ["\\Seen"], labels: ["Work"] })).toEqual([]);
  });

  test("a mutation that throws leaves every row failed with its pre-state intact", async () => {
    const events: string[] = [];
    const pending = [pendingRow({ uid: 11, kind: "auto_trash" }), pendingRow({ uid: 12, kind: "auto_trash" })];
    const journal = createFakeJournal({ events, pending });
    const provider = createFakeProvider({
      events,
      fail: "move",
      messages: [
        { uid: 11, flags: [], labels: null },
        { uid: 12, flags: [], labels: null },
      ],
    });

    const result = await executeActions({ mailbox_id: "mailbox-1", flavor: "generic", provider, journal, batch_size: 50 });

    expect(result).toEqual({ examined: 2, applied: 0, failed: 2, deferred: 0 } satisfies ExecuteActionsResult);
    for (const action_id of ["action-11", "action-12"]) {
      const row = journal.rows.get(action_id);
      expect(row?.status).toBe("failed");
      expect(row?.error).toContain("UID MOVE");
      expect(parseActionState(row?.from_state_json ?? null)).not.toBeNull();
    }
  });
});

describe("executeActions batching (§7.3)", () => {
  test("400 archives in one folder are a single command over a UID set", async () => {
    const events: string[] = [];
    const uids = Array.from({ length: 400 }, (_entry, index) => index + 1);
    const pending = uids.map((uid) => pendingRow({ uid, kind: "archive" }));
    const journal = createFakeJournal({ events, pending });
    const provider = createFakeProvider({ events, messages: uids.map((uid) => ({ uid, flags: [], labels: null })) });

    const result = await executeActions({ mailbox_id: "mailbox-1", flavor: "generic", provider, journal, batch_size: 400 });

    expect(result.applied).toBe(400);
    const move_events = events.filter((event) => event.startsWith("move "));
    expect(move_events).toEqual([`move INBOX ${uids.join(",")} -> ${ARCHIVE_FOLDER}`]);
    expect(events.filter((event) => event.startsWith("fetch ")).length).toBe(1);
  });

  test("different targets are different commands", async () => {
    const events: string[] = [];
    const pending = [
      pendingRow({ uid: 1, kind: "archive" }),
      pendingRow({ uid: 2, kind: "auto_trash" }),
      pendingRow({ uid: 3, kind: "archive" }),
    ];
    const journal = createFakeJournal({ events, pending });
    const provider = createFakeProvider({
      events,
      messages: [
        { uid: 1, flags: [], labels: null },
        { uid: 2, flags: [], labels: null },
        { uid: 3, flags: [], labels: null },
      ],
    });

    await executeActions({ mailbox_id: "mailbox-1", flavor: "generic", provider, journal, batch_size: 50 });

    expect(events.filter((event) => event.startsWith("move "))).toEqual([
      `move INBOX 1,3 -> ${ARCHIVE_FOLDER}`,
      `move INBOX 2 -> ${TRASH_FOLDER}`,
    ]);
  });
});

describe("executeActions outcomes", () => {
  test("a Gmail archive is a label write, and to_state keeps the UID", async () => {
    const events: string[] = [];
    const pending = [pendingRow({ uid: 21, kind: "archive", folder: GMAIL_CANONICAL_FOLDER })];
    const journal = createFakeJournal({ events, pending });
    const provider = createFakeProvider({
      events,
      gmail: true,
      folder: GMAIL_CANONICAL_FOLDER,
      trash_folder: GMAIL_TRASH_FOLDER,
      messages: [{ uid: 21, flags: ["\\Seen"], labels: [GMAIL_INBOX_LABEL, "Work"] }],
    });

    const result = await executeActions({ mailbox_id: "mailbox-1", flavor: "gmail", provider, journal, batch_size: 50 });

    expect(result.applied).toBe(1);
    expect(events).toContain(`set_labels ${GMAIL_CANONICAL_FOLDER} 21 +[] -[${GMAIL_INBOX_LABEL}]`);
    expect(events.some((event) => event.startsWith("move "))).toBe(false);
    expect(parseActionState(journal.rows.get("action-21")?.to_state_json ?? null)).toEqual({
      folder: GMAIL_CANONICAL_FOLDER,
      uid: 21,
      uid_validity: UID_VALIDITY,
      flags: ["\\Seen"],
      labels: ["Work"],
    });
  });

  test("a move records COPYUID's destination address in to_state", async () => {
    const events: string[] = [];
    const pending = [pendingRow({ uid: 31, kind: "auto_trash" })];
    const journal = createFakeJournal({ events, pending });
    const provider = createFakeProvider({ events, messages: [{ uid: 31, flags: ["\\Seen"], labels: null }] });

    await executeActions({ mailbox_id: "mailbox-1", flavor: "generic", provider, journal, batch_size: 50 });

    expect(parseActionState(journal.rows.get("action-31")?.to_state_json ?? null)).toEqual({
      folder: TRASH_FOLDER,
      uid: 9000,
      uid_validity: DESTINATION_UID_VALIDITY,
      flags: ["\\Seen"],
      labels: null,
    });
  });

  test("unconfirmed UIDs fail alone, are not retried, and do not hold back the rest of the batch", async () => {
    const events: string[] = [];
    const pending = [
      pendingRow({ uid: 41, kind: "archive" }),
      pendingRow({ uid: 42, kind: "archive" }),
      pendingRow({ uid: 43, kind: "archive" }),
    ];
    const journal = createFakeJournal({ events, pending });
    const provider = createFakeProvider({
      events,
      unconfirmed_uids: [42],
      messages: [
        { uid: 41, flags: [], labels: null },
        { uid: 42, flags: [], labels: null },
        { uid: 43, flags: [], labels: null },
      ],
    });

    const result = await executeActions({ mailbox_id: "mailbox-1", flavor: "generic", provider, journal, batch_size: 50 });

    expect(result).toEqual({ examined: 3, applied: 2, failed: 1, deferred: 0 } satisfies ExecuteActionsResult);
    expect(events.filter((event) => event.startsWith("move ")).length).toBe(1);

    const unconfirmed_row = journal.rows.get("action-42");
    expect(unconfirmed_row?.status).toBe("failed");
    expect(unconfirmed_row?.error).toContain("Not retried");
    // The pre-state survives even though the outcome is unknown: it is the only thing an eventual undo has.
    expect(parseActionState(unconfirmed_row?.from_state_json ?? null)).not.toBeNull();
    expect(journal.rows.get("action-41")?.status).toBe("applied");
    expect(journal.rows.get("action-43")?.status).toBe("applied");
  });

  test("a message that is no longer in the folder fails without joining the command", async () => {
    const events: string[] = [];
    const pending = [pendingRow({ uid: 51, kind: "archive" }), pendingRow({ uid: 52, kind: "archive" })];
    const journal = createFakeJournal({ events, pending });
    const provider = createFakeProvider({ events, messages: [{ uid: 51, flags: [], labels: null }] });

    const result = await executeActions({ mailbox_id: "mailbox-1", flavor: "generic", provider, journal, batch_size: 50 });

    expect(result).toEqual({ examined: 2, applied: 1, failed: 1, deferred: 0 } satisfies ExecuteActionsResult);
    expect(events).toContain(`move INBOX 51 -> ${ARCHIVE_FOLDER}`);
    expect(journal.rows.get("action-52")?.error).toContain("no longer in INBOX");
    expect(journal.rows.get("action-52")?.from_state_json).toBeNull();
  });

  test("file is deferred, not failed, and issues no command", async () => {
    const events: string[] = [];
    const pending = [pendingRow({ uid: 61, kind: "file" })];
    const journal = createFakeJournal({ events, pending });
    const provider = createFakeProvider({ events, messages: [{ uid: 61, flags: [], labels: null }] });

    const result = await executeActions({ mailbox_id: "mailbox-1", flavor: "generic", provider, journal, batch_size: 50 });

    expect(result).toEqual({ examined: 1, applied: 0, failed: 0, deferred: 1 } satisfies ExecuteActionsResult);
    expect(journal.rows.get("action-61")).toEqual({
      status: "deferred",
      from_state_json: null,
      to_state_json: null,
      error: FILE_DEFERRED_REASON,
    });
    expect(events.some((event) => event.startsWith("move ") || event.startsWith("set_labels "))).toBe(false);
  });

  test("a missing SPECIAL-USE folder fails the row instead of guessing a folder name", async () => {
    const events: string[] = [];
    const pending = [pendingRow({ uid: 71, kind: "archive" }), pendingRow({ uid: 72, kind: "auto_trash" })];
    const journal = createFakeJournal({ events, pending });
    const provider = createFakeProvider({
      events,
      archive_folder: null,
      messages: [
        { uid: 71, flags: [], labels: null },
        { uid: 72, flags: [], labels: null },
      ],
    });

    const result = await executeActions({ mailbox_id: "mailbox-1", flavor: "generic", provider, journal, batch_size: 50 });

    expect(result).toEqual({ examined: 2, applied: 1, failed: 1, deferred: 0 } satisfies ExecuteActionsResult);
    expect(journal.rows.get("action-71")?.status).toBe("failed");
    expect(journal.rows.get("action-71")?.error).toContain("SPECIAL-USE");
    expect(events.filter((event) => event.startsWith("move "))).toEqual([`move INBOX 72 -> ${TRASH_FOLDER}`]);
  });

  test("a folder that cannot be read fails its rows before anything is mutated", async () => {
    const events: string[] = [];
    const pending = [pendingRow({ uid: 81, kind: "archive" })];
    const journal = createFakeJournal({ events, pending });
    const provider = createFakeProvider({ events, fail: "fetch", messages: [{ uid: 81, flags: [], labels: null }] });

    const result = await executeActions({ mailbox_id: "mailbox-1", flavor: "generic", provider, journal, batch_size: 50 });

    expect(result.failed).toBe(1);
    expect(events.some((event) => event.startsWith("move "))).toBe(false);
    expect(journal.rows.get("action-81")?.from_state_json).toBeNull();
  });

  test("an empty pending set touches neither the server nor the journal", async () => {
    const events: string[] = [];
    const journal = createFakeJournal({ events, pending: [] });
    const provider = createFakeProvider({ events, messages: [] });

    const result = await executeActions({ mailbox_id: "mailbox-1", flavor: "generic", provider, journal, batch_size: 50 });

    expect(result).toEqual({ examined: 0, applied: 0, failed: 0, deferred: 0 } satisfies ExecuteActionsResult);
    expect(events).toEqual(["load_pending"]);
  });
});
