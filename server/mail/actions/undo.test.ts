import { describe, expect, test } from "bun:test";
import type { ActionJournal, ActionUndoLookup, UndoableActionRow } from "@server/mail/actions/executor";
import { GMAIL_INBOX_LABEL } from "@server/mail/actions/kinds";
import type { ActionStateSnapshot } from "@server/mail/actions/state";
import { serializeActionState } from "@server/mail/actions/state";
import type { UndoActionResult, UndoResult } from "@server/mail/actions/undo";
import { undoAction, undoPolicyActions } from "@server/mail/actions/undo";
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

const INBOX = "INBOX";
const ARCHIVE_FOLDER = "Archives/2026";
const TRASH_FOLDER = "Deleted Items";
const GMAIL_TRASH_FOLDER = "[Gmail]/Trash";

const INBOX_VALIDITY = "1000";
const ARCHIVE_VALIDITY = "2000";
const TRASH_VALIDITY = "3000";
const GMAIL_ALL_VALIDITY = "4000";
const GMAIL_TRASH_VALIDITY = "5000";

const MAILBOX_ID = "mailbox-1";
const MESSAGE_ID = "message-1";

type FakeFolder = {
  path: string;
  uid_validity: string;
  special_use: string | null;
  // uid -> message id. A move mints a new uid, exactly as UID MOVE does, so nothing in these tests can
  // pass by assuming the recorded uid still addresses the message after it has been relocated.
  messages: Map<number, string>;
};

type FakeMailbox = {
  folders: FakeFolder[];
  labels: Map<string, string[] | null>;
  next_uid: number;
};

type ProviderFailure = "move" | "set_labels";

// Mutable so a test can clear the failure and re-run the same undo against the same mailbox, which is the
// only way to prove a retry actually reaches the row and resumes.
type FakeProviderOptions = {
  events: string[];
  mailbox: FakeMailbox;
  unconfirmed_uids?: number[];
  fail?: ProviderFailure;
};

function genericMailbox(input: { folder: string; uid: number; labels?: string[] | null }): FakeMailbox {
  const folders: FakeFolder[] = [
    { path: INBOX, uid_validity: INBOX_VALIDITY, special_use: null, messages: new Map() },
    { path: ARCHIVE_FOLDER, uid_validity: ARCHIVE_VALIDITY, special_use: "\\Archive", messages: new Map() },
    { path: TRASH_FOLDER, uid_validity: TRASH_VALIDITY, special_use: "\\Trash", messages: new Map() },
  ];
  const home = folders.find((folder) => folder.path === input.folder);
  if (home === undefined) {
    throw new Error(`the fixture has no folder ${input.folder}`);
  }
  home.messages.set(input.uid, MESSAGE_ID);
  return { folders, labels: new Map([[MESSAGE_ID, input.labels ?? null]]), next_uid: 6000 };
}

function gmailMailbox(input: { folder: string; uid: number; labels: string[] }): FakeMailbox {
  const folders: FakeFolder[] = [
    { path: GMAIL_CANONICAL_FOLDER, uid_validity: GMAIL_ALL_VALIDITY, special_use: null, messages: new Map() },
    { path: GMAIL_TRASH_FOLDER, uid_validity: GMAIL_TRASH_VALIDITY, special_use: "\\Trash", messages: new Map() },
  ];
  const home = folders.find((folder) => folder.path === input.folder);
  if (home === undefined) {
    throw new Error(`the fixture has no folder ${input.folder}`);
  }
  home.messages.set(input.uid, MESSAGE_ID);
  return { folders, labels: new Map([[MESSAGE_ID, [...input.labels]]]), next_uid: 7000 };
}

function locate(mailbox: FakeMailbox, message_id: string): { folder: string; uid: number } | null {
  for (const folder of mailbox.folders) {
    for (const [uid, held] of folder.messages) {
      if (held === message_id) {
        return { folder: folder.path, uid };
      }
    }
  }
  return null;
}

function createFakeProvider(options: FakeProviderOptions): MailboxProvider {
  const { events, mailbox } = options;

  function requireFolder(path: string): FakeFolder {
    const folder = mailbox.folders.find((candidate) => candidate.path === path);
    if (folder === undefined) {
      throw new Error(`no such folder ${path}`);
    }
    return folder;
  }

  function unsupported(name: string): never {
    throw new Error(`${name} is not part of this fixture`);
  }

  return {
    capabilities: { condstore: true, qresync: true, uidplus: true, move: true, gmail: false },

    listFolders: async (): Promise<FolderInfo[]> => {
      events.push("list_folders");
      return mailbox.folders.map((folder) => ({
        path: folder.path,
        delimiter: "/",
        special_use: folder.special_use,
        subscribed: true,
        selectable: true,
      }));
    },

    openFolder: async (path: string): Promise<FolderStatus> => {
      events.push(`open ${path}`);
      const folder = requireFolder(path);
      return {
        path,
        uid_validity: folder.uid_validity,
        uid_next: mailbox.next_uid,
        highest_modseq: null,
        exists: folder.messages.size,
      };
    },

    moveMessages: async (path: string, uids: number[], target_folder: string): Promise<CopyUidResult> => {
      events.push(`move ${path} ${uids.join(",")} -> ${target_folder}`);
      if (options.fail === "move") {
        throw new Error(`UID MOVE into ${target_folder} was rejected`);
      }
      const source = requireFolder(path);
      const target = requireFolder(target_folder);
      const unconfirmed = options.unconfirmed_uids ?? [];

      const pairs = [];
      const unconfirmed_uids: number[] = [];
      for (const uid of uids) {
        const held = source.messages.get(uid);
        if (held === undefined || unconfirmed.includes(uid)) {
          unconfirmed_uids.push(uid);
          continue;
        }
        source.messages.delete(uid);
        const destination_uid = mailbox.next_uid;
        mailbox.next_uid += 1;
        target.messages.set(destination_uid, held);
        pairs.push({ source_uid: uid, destination_uid });
      }
      return { target_folder, destination_uid_validity: target.uid_validity, pairs, unconfirmed_uids };
    },

    setLabels: async (path: string, uids: number[], change: LabelChange): Promise<LabelResult> => {
      events.push(`set_labels ${path} ${uids.join(",")} +[${change.add_labels.join(",")}] -[${change.remove_labels.join(",")}]`);
      if (options.fail === "set_labels") {
        throw new Error("STORE X-GM-LABELS was rejected");
      }
      const folder = requireFolder(path);
      const written: number[] = [];
      for (const uid of uids) {
        const held = folder.messages.get(uid);
        if (held === undefined) {
          continue;
        }
        const current = mailbox.labels.get(held) ?? [];
        const remaining = current.filter((label) => !change.remove_labels.includes(label));
        mailbox.labels.set(held, [...new Set([...remaining, ...change.add_labels])].sort());
        written.push(uid);
      }
      return { folder: path, uids: written, added_labels: change.add_labels, removed_labels: change.remove_labels };
    },

    createFolder: async (folder: string): Promise<void> => {
      events.push(`create_folder ${folder}`);
    },

    fetchHeaders: async (): Promise<FetchedMessage[]> => unsupported("fetchHeaders"),
    fetchIdentities: async (): Promise<MessageIdentity[]> => unsupported("fetchIdentities"),
    fetchFlagChanges: async (): Promise<FlagChangeResult> => unsupported("fetchFlagChanges"),
    listUids: async (): Promise<number[]> => unsupported("listUids"),
    disconnect: async () => undefined,
  };
}

type SeedRow = {
  action_id: string;
  kind: string;
  applied_at: string | null;
  from_state: ActionStateSnapshot;
  to_state: ActionStateSnapshot | null;
  message_id?: string;
  mailbox_id?: string;
  status?: string;
  from_state_json?: string | null;
};

// Seeded and mutated in the shape the drizzle loader returns, so the fake cannot quietly hide a status or
// a mailbox the production query would have surfaced.
type FakeJournal = ActionJournal & { rows: Map<string, ActionUndoLookup & { error: string | null }> };

function seedLookup(row: SeedRow): ActionUndoLookup & { error: string | null } {
  return {
    action_id: row.action_id,
    message_id: row.message_id ?? MESSAGE_ID,
    mailbox_id: row.mailbox_id ?? MAILBOX_ID,
    status: row.status ?? "applied",
    kind: row.kind,
    from_state_json: row.from_state_json === undefined ? serializeActionState(row.from_state) : row.from_state_json,
    to_state_json: row.to_state === null ? null : serializeActionState(row.to_state),
    applied_at: row.applied_at === null ? null : new Date(row.applied_at),
    error: null,
  };
}

function createFakeJournal(input: { events: string[]; seed: SeedRow[] }): FakeJournal {
  const rows = new Map(input.seed.map((row) => [row.action_id, seedLookup(row)]));

  function requireRow(action_id: string): ActionUndoLookup & { error: string | null } {
    const row = rows.get(action_id);
    if (row === undefined) {
      throw new Error(`the journal was asked to update unknown action ${action_id}`);
    }
    return row;
  }

  function unsupported(name: string): never {
    throw new Error(`${name} is not part of this fixture`);
  }

  return {
    rows,

    loadActionForUndo: async (query) => {
      input.events.push(`load_for_undo ${query.action_id}`);
      return rows.get(query.action_id) ?? null;
    },

    // Filtered as the production query is, but handed over OLDEST-FIRST on purpose. That query orders
    // newest-first so `limit` takes the newest batch; undo re-sorts what it is given, and that is what
    // these tests exercise.
    loadUndoableActionsByPolicy: async (query) => {
      input.events.push(`load_undoable_by_policy ${query.sender_policy_id}`);
      const undoable: UndoableActionRow[] = [];
      for (const row of rows.values()) {
        if (row.status !== "applied" || row.mailbox_id !== query.mailbox_id || row.applied_at === null) {
          continue;
        }
        if (row.kind !== "archive" && row.kind !== "auto_trash" && row.kind !== "file") {
          continue;
        }
        undoable.push({
          action_id: row.action_id,
          message_id: row.message_id,
          kind: row.kind,
          from_state_json: row.from_state_json,
          to_state_json: row.to_state_json,
          applied_at: row.applied_at,
        });
      }
      return undoable.sort((left, right) => left.applied_at.getTime() - right.applied_at.getTime()).slice(0, query.batch_size);
    },

    markUndone: async (entries) => {
      input.events.push(`mark_undone ${entries.map((entry) => entry.action_id).join(",")}`);
      for (const entry of entries) {
        const row = requireRow(entry.action_id);
        row.status = "undone";
        row.error = null;
      }
    },

    recordUndoFailure: async (entries) => {
      input.events.push(`record_undo_failure ${entries.map((entry) => entry.action_id).join(",")}`);
      for (const entry of entries) {
        const row = requireRow(entry.action_id);
        // The production statement guards on status = applied and never sets it; a fake that moved the
        // status would hide exactly the defect this method exists to fix.
        row.error = entry.error;
        if (entry.to_state_json !== undefined) {
          row.to_state_json = entry.to_state_json;
        }
      }
    },

    loadPendingActions: async () => unsupported("loadPendingActions"),
    recordFromState: async () => unsupported("recordFromState"),
    markApplied: async () => unsupported("markApplied"),
    markFailed: async () => unsupported("markFailed"),
    markDeferred: async () => unsupported("markDeferred"),
    loadActionForPromotion: async () => unsupported("loadActionForPromotion"),
    loadShadowActionsByPolicy: async () => unsupported("loadShadowActionsByPolicy"),
    promoteShadowActions: async () => unsupported("promoteShadowActions"),
  };
}

function moveEvents(events: string[]): string[] {
  return events.filter((event) => event.startsWith("move ") || event.startsWith("set_labels "));
}

const GENERIC_ARCHIVE_FROM: ActionStateSnapshot = { folder: INBOX, uid: 11, uid_validity: INBOX_VALIDITY, flags: ["\\Seen"], labels: null };
const GENERIC_ARCHIVE_TO: ActionStateSnapshot = {
  folder: ARCHIVE_FOLDER,
  uid: 9001,
  uid_validity: ARCHIVE_VALIDITY,
  flags: ["\\Seen"],
  labels: null,
};

const GMAIL_TRASH_FROM: ActionStateSnapshot = {
  folder: GMAIL_CANONICAL_FOLDER,
  uid: 40,
  uid_validity: GMAIL_ALL_VALIDITY,
  flags: ["\\Seen"],
  labels: [GMAIL_INBOX_LABEL, "Receipts"],
};
const GMAIL_TRASH_TO: ActionStateSnapshot = {
  folder: GMAIL_TRASH_FOLDER,
  uid: 700,
  uid_validity: GMAIL_TRASH_VALIDITY,
  flags: ["\\Seen"],
  labels: [],
};

describe("undoAction — single action (§7.3)", () => {
  test("moves a generic archive back to the folder from_state_json recorded", async () => {
    const events: string[] = [];
    const mailbox = genericMailbox({ folder: ARCHIVE_FOLDER, uid: 9001 });
    const provider = createFakeProvider({ events, mailbox });
    const journal = createFakeJournal({
      events,
      seed: [
        {
          action_id: "action-1",
          kind: "archive",
          applied_at: "2026-08-19T10:00:00.000Z",
          from_state: GENERIC_ARCHIVE_FROM,
          to_state: GENERIC_ARCHIVE_TO,
        },
      ],
    });

    const result = await undoAction({ action_id: "action-1", mailbox_id: MAILBOX_ID, flavor: "generic", provider, journal });

    expect(result).toEqual({ outcome: "undone" } satisfies UndoActionResult);
    expect(moveEvents(events)).toEqual([`move ${ARCHIVE_FOLDER} 9001 -> ${INBOX}`]);
    expect(locate(mailbox, MESSAGE_ID)).toEqual({ folder: INBOX, uid: 6000 });
  });

  test("marks the row undone and keeps it — a reversed row is part of the record, never deleted", async () => {
    const events: string[] = [];
    const mailbox = genericMailbox({ folder: ARCHIVE_FOLDER, uid: 9001 });
    const provider = createFakeProvider({ events, mailbox });
    const journal = createFakeJournal({
      events,
      seed: [
        {
          action_id: "action-1",
          kind: "archive",
          applied_at: "2026-08-19T10:00:00.000Z",
          from_state: GENERIC_ARCHIVE_FROM,
          to_state: GENERIC_ARCHIVE_TO,
        },
      ],
    });

    await undoAction({ action_id: "action-1", mailbox_id: MAILBOX_ID, flavor: "generic", provider, journal });

    expect(journal.rows.has("action-1")).toBe(true);
    const row = journal.rows.get("action-1");
    expect(row?.status).toBe("undone");
    expect(row?.error).toBeNull();
    expect(row?.from_state_json).toBe(serializeActionState(GENERIC_ARCHIVE_FROM));
    expect(row?.to_state_json).not.toBeNull();
  });

  test("restores a Gmail archive by adding the label back at the unchanged UID", async () => {
    const events: string[] = [];
    const mailbox = gmailMailbox({ folder: GMAIL_CANONICAL_FOLDER, uid: 40, labels: ["Newsletters"] });
    const provider = createFakeProvider({ events, mailbox });
    const journal = createFakeJournal({
      events,
      seed: [
        {
          action_id: "action-1",
          kind: "archive",
          applied_at: "2026-08-19T10:00:00.000Z",
          from_state: {
            folder: GMAIL_CANONICAL_FOLDER,
            uid: 40,
            uid_validity: GMAIL_ALL_VALIDITY,
            flags: [],
            labels: [GMAIL_INBOX_LABEL, "Newsletters"],
          },
          to_state: { folder: GMAIL_CANONICAL_FOLDER, uid: 40, uid_validity: GMAIL_ALL_VALIDITY, flags: [], labels: ["Newsletters"] },
        },
      ],
    });

    const result = await undoAction({ action_id: "action-1", mailbox_id: MAILBOX_ID, flavor: "gmail", provider, journal });

    expect(result).toEqual({ outcome: "undone" } satisfies UndoActionResult);
    expect(moveEvents(events)).toEqual([`set_labels ${GMAIL_CANONICAL_FOLDER} 40 +[${GMAIL_INBOX_LABEL}] -[]`]);
    expect(mailbox.labels.get(MESSAGE_ID)).toEqual(["Newsletters", GMAIL_INBOX_LABEL]);
  });

  // The UID question in one test: the move back mints a new UID, and the label restore that follows it in
  // the same sequence has to address THAT one. Issuing it against to_state's 700, or against from_state's
  // 40, would label a different message or nothing at all.
  test("a Gmail trash undo moves back first, then restores the labels at the UID the move minted", async () => {
    const events: string[] = [];
    const mailbox = gmailMailbox({ folder: GMAIL_TRASH_FOLDER, uid: 700, labels: [] });
    const provider = createFakeProvider({ events, mailbox });
    const journal = createFakeJournal({
      events,
      seed: [
        {
          action_id: "action-1",
          kind: "auto_trash",
          applied_at: "2026-08-19T10:00:00.000Z",
          from_state: GMAIL_TRASH_FROM,
          to_state: GMAIL_TRASH_TO,
        },
      ],
    });

    const result = await undoAction({ action_id: "action-1", mailbox_id: MAILBOX_ID, flavor: "gmail", provider, journal });

    expect(result).toEqual({ outcome: "undone" } satisfies UndoActionResult);
    expect(moveEvents(events)).toEqual([
      `move ${GMAIL_TRASH_FOLDER} 700 -> ${GMAIL_CANONICAL_FOLDER}`,
      `set_labels ${GMAIL_CANONICAL_FOLDER} 7000 +[Receipts,${GMAIL_INBOX_LABEL}] -[]`,
    ]);
    expect(locate(mailbox, MESSAGE_ID)).toEqual({ folder: GMAIL_CANONICAL_FOLDER, uid: 7000 });
    expect(mailbox.labels.get(MESSAGE_ID)).toEqual(["Receipts", GMAIL_INBOX_LABEL]);
  });

  test("an empty inverse is a successful undo with nothing to issue", async () => {
    const events: string[] = [];
    const mailbox = gmailMailbox({ folder: GMAIL_CANONICAL_FOLDER, uid: 40, labels: ["Newsletters"] });
    const provider = createFakeProvider({ events, mailbox });
    const state: ActionStateSnapshot = {
      folder: GMAIL_CANONICAL_FOLDER,
      uid: 40,
      uid_validity: GMAIL_ALL_VALIDITY,
      flags: [],
      labels: ["Newsletters"],
    };
    const journal = createFakeJournal({
      events,
      seed: [{ action_id: "action-1", kind: "archive", applied_at: "2026-08-19T10:00:00.000Z", from_state: state, to_state: state }],
    });

    const result = await undoAction({ action_id: "action-1", mailbox_id: MAILBOX_ID, flavor: "gmail", provider, journal });

    expect(result).toEqual({ outcome: "undone" } satisfies UndoActionResult);
    expect(moveEvents(events)).toEqual([]);
    expect(journal.rows.get("action-1")?.status).toBe("undone");
  });
});

describe("undoAction — why nothing happened is reportable", () => {
  function fixtures(seed: SeedRow[]): { events: string[]; provider: MailboxProvider; journal: FakeJournal } {
    const events: string[] = [];
    const mailbox = genericMailbox({ folder: ARCHIVE_FOLDER, uid: 9001 });
    return { events, provider: createFakeProvider({ events, mailbox }), journal: createFakeJournal({ events, seed }) };
  }

  const base = {
    kind: "archive",
    applied_at: "2026-08-19T10:00:00.000Z",
    from_state: GENERIC_ARCHIVE_FROM,
    to_state: GENERIC_ARCHIVE_TO,
  };

  test("an action that does not exist", async () => {
    const { events, provider, journal } = fixtures([]);
    const result = await undoAction({ action_id: "action-missing", mailbox_id: MAILBOX_ID, flavor: "generic", provider, journal });

    expect(result).toEqual({ outcome: "not_undoable", reason: "missing", detail: "no action with that id exists." });
    expect(events).toEqual(["load_for_undo action-missing"]);
  });

  test("an action belonging to another mailbox", async () => {
    const { provider, journal } = fixtures([{ ...base, action_id: "action-1", mailbox_id: "mailbox-2" }]);
    const result = await undoAction({ action_id: "action-1", mailbox_id: MAILBOX_ID, flavor: "generic", provider, journal });

    expect(result.outcome).toBe("not_undoable");
    expect(result).toMatchObject({ reason: "other_mailbox" });
    expect(journal.rows.get("action-1")?.status).toBe("applied");
  });

  test("an action that has already been undone", async () => {
    const { provider, journal } = fixtures([{ ...base, action_id: "action-1", status: "undone" }]);
    const result = await undoAction({ action_id: "action-1", mailbox_id: MAILBOX_ID, flavor: "generic", provider, journal });

    expect(result).toEqual({
      outcome: "not_undoable",
      reason: "already_undone",
      detail: "that action has already been undone.",
    });
  });

  test("an action that never mutated the mailbox", async () => {
    const { provider, journal } = fixtures([{ ...base, action_id: "action-1", status: "shadow" }]);
    const result = await undoAction({ action_id: "action-1", mailbox_id: MAILBOX_ID, flavor: "generic", provider, journal });

    expect(result).toMatchObject({ outcome: "not_undoable", reason: "not_applied" });
    expect(result).toMatchObject({ detail: expect.stringContaining("shadow") });
  });

  test("an applied action with no applied_at cannot be ordered and is reported, not hidden", async () => {
    const { provider, journal } = fixtures([{ ...base, action_id: "action-1", applied_at: null }]);
    const result = await undoAction({ action_id: "action-1", mailbox_id: MAILBOX_ID, flavor: "generic", provider, journal });

    expect(result).toMatchObject({ outcome: "not_undoable", reason: "unaddressable" });
  });
});

describe("undoAction — a failed reversal stays applied and stays reachable", () => {
  test("a whole-sequence failure leaves status applied, records the reason, and a retry completes it", async () => {
    const events: string[] = [];
    const mailbox = genericMailbox({ folder: ARCHIVE_FOLDER, uid: 9001 });
    const options: FakeProviderOptions = { events, mailbox, unconfirmed_uids: [9001] };
    const provider = createFakeProvider(options);
    const journal = createFakeJournal({
      events,
      seed: [
        {
          action_id: "action-1",
          kind: "archive",
          applied_at: "2026-08-19T10:00:00.000Z",
          from_state: GENERIC_ARCHIVE_FROM,
          to_state: GENERIC_ARCHIVE_TO,
        },
      ],
    });

    const first = await undoAction({ action_id: "action-1", mailbox_id: MAILBOX_ID, flavor: "generic", provider, journal });
    expect(first.outcome).toBe("failed");

    // The action is still applied — which is what is still true of the message — and the reason is on the
    // row. Stamping `failed` here would lock it out of every loader and make the retry below impossible.
    const after_failure = journal.rows.get("action-1");
    expect(after_failure?.status).toBe("applied");
    expect(after_failure?.error).toContain("confirmed no destination for UID 9001");
    expect(after_failure?.to_state_json).toBe(serializeActionState(GENERIC_ARCHIVE_TO));
    expect(locate(mailbox, MESSAGE_ID)).toEqual({ folder: ARCHIVE_FOLDER, uid: 9001 });

    options.unconfirmed_uids = [];
    const second = await undoAction({ action_id: "action-1", mailbox_id: MAILBOX_ID, flavor: "generic", provider, journal });

    expect(second).toEqual({ outcome: "undone" } satisfies UndoActionResult);
    expect(journal.rows.get("action-1")?.status).toBe("undone");
    expect(locate(mailbox, MESSAGE_ID)).toEqual({ folder: INBOX, uid: 6000 });
  });

  // Defect 2: the move back landed, so the message is at an address to_state_json did not name. Recording
  // the address it actually reached is what lets the retry issue only the tail of the sequence.
  test("a partial sequence records where the message actually got to, and the retry resumes from there", async () => {
    const events: string[] = [];
    const mailbox = gmailMailbox({ folder: GMAIL_TRASH_FOLDER, uid: 700, labels: [] });
    const options: FakeProviderOptions = { events, mailbox, fail: "set_labels" };
    const provider = createFakeProvider(options);
    const journal = createFakeJournal({
      events,
      seed: [
        {
          action_id: "action-1",
          kind: "auto_trash",
          applied_at: "2026-08-19T10:00:00.000Z",
          from_state: GMAIL_TRASH_FROM,
          to_state: GMAIL_TRASH_TO,
        },
      ],
    });

    const first = await undoAction({ action_id: "action-1", mailbox_id: MAILBOX_ID, flavor: "gmail", provider, journal });

    expect(first).toEqual({ outcome: "failed", error: "STORE X-GM-LABELS was rejected" } satisfies UndoActionResult);
    // Correctly filed, unlabelled — the exact partial state the row must stay applied for.
    expect(locate(mailbox, MESSAGE_ID)).toEqual({ folder: GMAIL_CANONICAL_FOLDER, uid: 7000 });
    expect(mailbox.labels.get(MESSAGE_ID)).toEqual([]);

    const after_failure = journal.rows.get("action-1");
    expect(after_failure?.status).toBe("applied");
    expect(after_failure?.from_state_json).toBe(serializeActionState(GMAIL_TRASH_FROM));
    expect(after_failure?.to_state_json).toBe(
      serializeActionState({ folder: GMAIL_CANONICAL_FOLDER, uid: 7000, uid_validity: GMAIL_ALL_VALIDITY, flags: ["\\Seen"], labels: [] }),
    );

    const resumed_events: string[] = [];
    options.fail = undefined;
    options.events = resumed_events;
    const resumed_provider = createFakeProvider({ ...options, events: resumed_events });
    const second = await undoAction({
      action_id: "action-1",
      mailbox_id: MAILBOX_ID,
      flavor: "gmail",
      provider: resumed_provider,
      journal,
    });

    expect(second).toEqual({ outcome: "undone" } satisfies UndoActionResult);
    // Only the tail. A retry that restarted the sequence would move a message that is already home.
    expect(moveEvents(resumed_events)).toEqual([`set_labels ${GMAIL_CANONICAL_FOLDER} 7000 +[Receipts,${GMAIL_INBOX_LABEL}] -[]`]);
    expect(mailbox.labels.get(MESSAGE_ID)).toEqual(["Receipts", GMAIL_INBOX_LABEL]);
    expect(journal.rows.get("action-1")?.status).toBe("undone");
  });

  test("a changed UIDVALIDITY refuses before any mutation is issued", async () => {
    const events: string[] = [];
    const mailbox = genericMailbox({ folder: ARCHIVE_FOLDER, uid: 9001 });
    const provider = createFakeProvider({ events, mailbox });
    const journal = createFakeJournal({
      events,
      seed: [
        {
          action_id: "action-1",
          kind: "archive",
          applied_at: "2026-08-19T10:00:00.000Z",
          from_state: GENERIC_ARCHIVE_FROM,
          to_state: { ...GENERIC_ARCHIVE_TO, uid_validity: "99999" },
        },
      ],
    });

    const result = await undoAction({ action_id: "action-1", mailbox_id: MAILBOX_ID, flavor: "generic", provider, journal });

    expect(result).toMatchObject({ outcome: "failed" });
    expect(moveEvents(events)).toEqual([]);
    expect(journal.rows.get("action-1")?.error).toContain("UIDVALIDITY");
    expect(journal.rows.get("action-1")?.status).toBe("applied");
  });

  test("a row with no from_state_json has nothing to restore and is not guessed at", async () => {
    const events: string[] = [];
    const mailbox = genericMailbox({ folder: ARCHIVE_FOLDER, uid: 9001 });
    const provider = createFakeProvider({ events, mailbox });
    const journal = createFakeJournal({
      events,
      seed: [
        {
          action_id: "action-1",
          kind: "archive",
          applied_at: "2026-08-19T10:00:00.000Z",
          from_state: GENERIC_ARCHIVE_FROM,
          from_state_json: null,
          to_state: GENERIC_ARCHIVE_TO,
        },
      ],
    });

    const result = await undoAction({ action_id: "action-1", mailbox_id: MAILBOX_ID, flavor: "generic", provider, journal });

    expect(result).toMatchObject({ outcome: "failed" });
    expect(moveEvents(events)).toEqual([]);
    expect(journal.rows.get("action-1")?.error).toContain("no usable from_state_json");
  });

  test("a row with no to_state_json has no address to work back from", async () => {
    const events: string[] = [];
    const mailbox = genericMailbox({ folder: ARCHIVE_FOLDER, uid: 9001 });
    const provider = createFakeProvider({ events, mailbox });
    const journal = createFakeJournal({
      events,
      seed: [
        {
          action_id: "action-1",
          kind: "archive",
          applied_at: "2026-08-19T10:00:00.000Z",
          from_state: GENERIC_ARCHIVE_FROM,
          to_state: null,
        },
      ],
    });

    const result = await undoAction({ action_id: "action-1", mailbox_id: MAILBOX_ID, flavor: "generic", provider, journal });

    expect(result).toMatchObject({ outcome: "failed" });
    expect(moveEvents(events)).toEqual([]);
    expect(journal.rows.get("action-1")?.error).toContain("no usable to_state_json");
    expect(journal.rows.get("action-1")?.status).toBe("applied");
  });

  test("a rebuilt plan that matches no point on the path back refuses rather than addressing another folder", async () => {
    const events: string[] = [];
    const mailbox = genericMailbox({ folder: TRASH_FOLDER, uid: 9001 });
    const provider = createFakeProvider({ events, mailbox });
    const journal = createFakeJournal({
      events,
      seed: [
        {
          action_id: "action-1",
          kind: "archive",
          applied_at: "2026-08-19T10:00:00.000Z",
          from_state: GENERIC_ARCHIVE_FROM,
          // The executor recorded a landing in Trash, but the archive plan rebuilt from today's
          // SPECIAL-USE attributes lands in Archives/2026, and no state on the path back is Trash.
          to_state: { folder: TRASH_FOLDER, uid: 9001, uid_validity: TRASH_VALIDITY, flags: ["\\Seen"], labels: null },
        },
      ],
    });

    const result = await undoAction({ action_id: "action-1", mailbox_id: MAILBOX_ID, flavor: "generic", provider, journal });

    expect(result).toMatchObject({ outcome: "failed" });
    expect(moveEvents(events)).toEqual([]);
    expect(journal.rows.get("action-1")?.error).toContain("matches no point on this action's path back");
  });
});

describe("undoPolicyActions — newest-first replay (§7.3)", () => {
  // The ordering test with teeth. One message, two actions by one policy: INBOX -> Archive, then
  // Archive -> Trash. Replayed newest-first the message ends in INBOX, the state before the policy ever
  // touched it. Replayed oldest-first the first inverse addresses UID 9001 in Archives/2026 — where the
  // message no longer is — so it fails, blocks its sibling, and the message stays in Deleted Items. Even
  // if that stale UID had hit something, the end state would be Archives/2026: the INTERMEDIATE state
  // between the two actions, never the original. Every assertion below changes if the sort is removed.
  const chain: SeedRow[] = [
    {
      action_id: "action-archive",
      kind: "archive",
      applied_at: "2026-08-19T10:00:00.000Z",
      from_state: GENERIC_ARCHIVE_FROM,
      to_state: GENERIC_ARCHIVE_TO,
    },
    {
      action_id: "action-trash",
      kind: "auto_trash",
      applied_at: "2026-08-19T11:00:00.000Z",
      from_state: GENERIC_ARCHIVE_TO,
      to_state: { folder: TRASH_FOLDER, uid: 9500, uid_validity: TRASH_VALIDITY, flags: ["\\Seen"], labels: null },
    },
  ];

  test("replays a chain newest-first and restores the original state, not the intermediate one", async () => {
    const events: string[] = [];
    const mailbox = genericMailbox({ folder: TRASH_FOLDER, uid: 9500 });
    const provider = createFakeProvider({ events, mailbox });
    const journal = createFakeJournal({ events, seed: chain });

    const result = await undoPolicyActions({
      sender_policy_id: "policy-1",
      mailbox_id: MAILBOX_ID,
      flavor: "generic",
      provider,
      journal,
      batch_size: 50,
    });

    expect(result).toEqual({ examined: 2, undone: 2, failed: 0, skipped: 0 } satisfies UndoResult);

    // Newest inverse first, and the second addresses the UID the first minted (6000) rather than the
    // 9001 the journal recorded — a chain walks the message backwards through addresses no row knows.
    expect(moveEvents(events)).toEqual([`move ${TRASH_FOLDER} 9500 -> ${ARCHIVE_FOLDER}`, `move ${ARCHIVE_FOLDER} 6000 -> ${INBOX}`]);
    expect(locate(mailbox, MESSAGE_ID)).toEqual({ folder: INBOX, uid: 6001 });
    expect(journal.rows.get("action-trash")?.status).toBe("undone");
    expect(journal.rows.get("action-archive")?.status).toBe("undone");
  });

  test("a newer inverse that fails skips the older one and leaves it completely untouched", async () => {
    const events: string[] = [];
    const mailbox = genericMailbox({ folder: TRASH_FOLDER, uid: 9500 });
    const provider = createFakeProvider({ events, mailbox, unconfirmed_uids: [9500] });
    const journal = createFakeJournal({ events, seed: chain });

    const result = await undoPolicyActions({
      sender_policy_id: "policy-1",
      mailbox_id: MAILBOX_ID,
      flavor: "generic",
      provider,
      journal,
      batch_size: 50,
    });

    expect(result).toEqual({ examined: 2, undone: 0, failed: 1, skipped: 1 } satisfies UndoResult);
    expect(moveEvents(events)).toEqual([`move ${TRASH_FOLDER} 9500 -> ${ARCHIVE_FOLDER}`]);
    expect(locate(mailbox, MESSAGE_ID)).toEqual({ folder: TRASH_FOLDER, uid: 9500 });

    // Never attempted, still correctly applied, mailbox state untouched — so nothing is written to it. A
    // stamped row would have §9's journal report a broken action next to a message that is exactly where
    // that action put it.
    const skipped = journal.rows.get("action-archive");
    expect(skipped?.status).toBe("applied");
    expect(skipped?.error).toBeNull();
    expect(events).not.toContain("record_undo_failure action-archive");

    // The attempted one carries the reason and is still applied, so re-running the bulk undo reaches both.
    expect(journal.rows.get("action-trash")?.status).toBe("applied");
    expect(journal.rows.get("action-trash")?.error).toContain("confirmed no destination for UID 9500");
  });

  test("actions on different messages are independent — one failure does not block the others", async () => {
    const events: string[] = [];
    const mailbox = genericMailbox({ folder: ARCHIVE_FOLDER, uid: 9001 });
    mailbox.folders.find((folder) => folder.path === ARCHIVE_FOLDER)?.messages.set(9002, "message-2");
    mailbox.labels.set("message-2", null);

    const provider = createFakeProvider({ events, mailbox, unconfirmed_uids: [9001] });
    const journal = createFakeJournal({
      events,
      seed: [
        {
          action_id: "action-1",
          kind: "archive",
          applied_at: "2026-08-19T11:00:00.000Z",
          from_state: GENERIC_ARCHIVE_FROM,
          to_state: GENERIC_ARCHIVE_TO,
        },
        {
          action_id: "action-2",
          message_id: "message-2",
          kind: "archive",
          applied_at: "2026-08-19T10:00:00.000Z",
          from_state: { folder: INBOX, uid: 12, uid_validity: INBOX_VALIDITY, flags: [], labels: null },
          to_state: { folder: ARCHIVE_FOLDER, uid: 9002, uid_validity: ARCHIVE_VALIDITY, flags: [], labels: null },
        },
      ],
    });

    const result = await undoPolicyActions({
      sender_policy_id: "policy-1",
      mailbox_id: MAILBOX_ID,
      flavor: "generic",
      provider,
      journal,
      batch_size: 50,
    });

    expect(result).toEqual({ examined: 2, undone: 1, failed: 1, skipped: 0 } satisfies UndoResult);
    expect(journal.rows.get("action-1")?.status).toBe("applied");
    expect(journal.rows.get("action-2")?.status).toBe("undone");
    expect(locate(mailbox, "message-2")).toEqual({ folder: INBOX, uid: 6000 });
  });

  test("refuses an unscoped bulk undo", async () => {
    const events: string[] = [];
    const mailbox = genericMailbox({ folder: ARCHIVE_FOLDER, uid: 9001 });
    const provider = createFakeProvider({ events, mailbox });
    const journal = createFakeJournal({ events, seed: [] });

    await expect(
      undoPolicyActions({ sender_policy_id: "", mailbox_id: MAILBOX_ID, flavor: "generic", provider, journal, batch_size: 50 }),
    ).rejects.toThrow("needs a policy id");
    expect(events).toEqual([]);
  });
});
