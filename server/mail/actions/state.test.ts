import { describe, expect, test } from "bun:test";
import { GMAIL_INBOX_LABEL } from "@server/mail/actions/kinds";
import type { ActionStateSnapshot } from "@server/mail/actions/state";
import { captureFolderStates, parseActionState, resolveActionFolders, serializeActionState } from "@server/mail/actions/state";
import type { FetchedMessage, FolderInfo, FolderStatus, MailboxProvider } from "@server/mail/providers/types";

const UID_VALIDITY = "38504";

type StubMessage = { uid: number; flags: string[]; labels: string[] | null };

function fetchedMessage(entry: StubMessage): FetchedMessage {
  return {
    uid: entry.uid,
    flags: [...entry.flags],
    modseq: null,
    internal_date: new Date("2026-08-19T10:00:00.000Z"),
    size: 512,
    gm_msgid: null,
    gm_thrid: null,
    labels: entry.labels === null ? null : [...entry.labels],
    envelope: { subject: null, message_id: null, in_reply_to: null, date: null, from: [], to: [], cc: [] },
    headers: {},
  };
}

// A read-only stub: every mutating member throws, so a state-capture path that reached one would fail the
// test rather than pass quietly.
function createStubProvider(input: { messages?: StubMessage[]; folders?: FolderInfo[]; ranges?: string[] }): MailboxProvider {
  function unsupported(name: string): never {
    throw new Error(`${name} must never be reached while capturing state`);
  }

  return {
    capabilities: { condstore: true, qresync: true, uidplus: true, move: true, gmail: false },
    listFolders: async () => input.folders ?? [],
    openFolder: async (folder: string): Promise<FolderStatus> => ({
      path: folder,
      uid_validity: UID_VALIDITY,
      uid_next: 900,
      highest_modseq: null,
      exists: (input.messages ?? []).length,
    }),
    fetchHeaders: async (_folder: string, uid_range: string): Promise<FetchedMessage[]> => {
      input.ranges?.push(uid_range);
      const requested = new Set(uid_range.split(",").map((value) => Number(value)));
      return (input.messages ?? []).filter((entry) => requested.has(entry.uid)).map(fetchedMessage);
    },
    fetchIdentities: async () => unsupported("fetchIdentities"),
    fetchFlagChanges: async () => unsupported("fetchFlagChanges"),
    listUids: async () => unsupported("listUids"),
    moveMessages: async () => unsupported("moveMessages"),
    copyMessages: async () => unsupported("copyMessages"),
    setLabels: async () => unsupported("setLabels"),
    expungeUids: async () => unsupported("expungeUids"),
    disconnect: async () => undefined,
  };
}

function folder(path: string, special_use: string | null, selectable = true): FolderInfo {
  return { path, delimiter: "/", special_use, subscribed: true, selectable };
}

describe("resolveActionFolders", () => {
  test("resolves targets from SPECIAL-USE rather than from a folder name", () => {
    const provider = createStubProvider({
      folders: [folder("INBOX", null), folder("Papierkorb", "\\Trash"), folder("Archives/2026", "\\Archive"), folder("Archive", null)],
    });

    return expect(resolveActionFolders(provider)).resolves.toEqual({ archive_folder: "Archives/2026", trash_folder: "Papierkorb" });
  });

  test("returns null for an attribute the server does not advertise", () => {
    const provider = createStubProvider({ folders: [folder("INBOX", null), folder("Deleted Items", "\\Trash")] });

    return expect(resolveActionFolders(provider)).resolves.toEqual({ archive_folder: null, trash_folder: "Deleted Items" });
  });

  test("ignores a special-use folder that cannot be selected", () => {
    const provider = createStubProvider({ folders: [folder("[Gmail]", "\\Archive", false)] });

    return expect(resolveActionFolders(provider)).resolves.toEqual({ archive_folder: null, trash_folder: null });
  });
});

describe("captureFolderStates", () => {
  test("reads flags and labels from the server and stamps the folder's UIDVALIDITY", async () => {
    const ranges: string[] = [];
    const provider = createStubProvider({
      ranges,
      messages: [
        { uid: 4, flags: ["\\Seen"], labels: [GMAIL_INBOX_LABEL, "Work"] },
        { uid: 9, flags: [], labels: null },
      ],
    });

    const captured = await captureFolderStates({ provider, folder: "INBOX", uids: [9, 4, 9] });

    expect(ranges).toEqual(["4,9"]);
    expect(captured.get(4)).toEqual({
      folder: "INBOX",
      uid: 4,
      uid_validity: UID_VALIDITY,
      flags: ["\\Seen"],
      labels: [GMAIL_INBOX_LABEL, "Work"],
    });
    expect(captured.get(9)?.labels).toBeNull();
  });

  test("omits a UID the server did not report rather than inventing a state for it", async () => {
    const provider = createStubProvider({ messages: [{ uid: 4, flags: [], labels: null }] });

    const captured = await captureFolderStates({ provider, folder: "INBOX", uids: [4, 5] });

    expect(captured.has(5)).toBe(false);
    expect(captured.size).toBe(1);
  });

  test("touches the server not at all for an empty UID set", async () => {
    const ranges: string[] = [];
    const provider = createStubProvider({ ranges, messages: [] });

    expect((await captureFolderStates({ provider, folder: "INBOX", uids: [] })).size).toBe(0);
    expect(ranges).toEqual([]);
  });

  test("refuses an empty folder, because a blank from_state folder is an undo that moves mail to nowhere", () => {
    const provider = createStubProvider({ messages: [{ uid: 4, flags: [], labels: null }] });

    return expect(captureFolderStates({ provider, folder: "", uids: [4] })).rejects.toThrow("empty folder");
  });

  test("refuses a UID below 1, which addresses nothing in a sequence set", () => {
    const provider = createStubProvider({ messages: [] });

    return expect(captureFolderStates({ provider, folder: "INBOX", uids: [0] })).rejects.toThrow("UIDs start at 1");
  });
});

describe("serializeActionState / parseActionState", () => {
  const snapshot: ActionStateSnapshot = {
    folder: "INBOX",
    uid: 7,
    uid_validity: UID_VALIDITY,
    flags: ["\\Seen", "\\Flagged"],
    labels: ["Work", GMAIL_INBOX_LABEL, "Work"],
  };

  test("round-trips through the journal's text column", () => {
    expect(parseActionState(serializeActionState(snapshot))).toEqual({
      folder: "INBOX",
      uid: 7,
      uid_validity: UID_VALIDITY,
      flags: ["\\Flagged", "\\Seen"],
      labels: ["Work", GMAIL_INBOX_LABEL],
    });
  });

  test("is byte-identical for the same state written in a different order", () => {
    const reordered: ActionStateSnapshot = { ...snapshot, flags: ["\\Flagged", "\\Seen"], labels: [GMAIL_INBOX_LABEL, "Work"] };

    expect(serializeActionState(snapshot)).toBe(serializeActionState(reordered));
  });

  test("keeps a null label set distinct from an empty one", () => {
    expect(parseActionState(serializeActionState({ ...snapshot, labels: null }))?.labels).toBeNull();
    expect(parseActionState(serializeActionState({ ...snapshot, labels: [] }))?.labels).toEqual([]);
  });

  test("refuses to write a blank folder", () => {
    expect(() => serializeActionState({ ...snapshot, folder: "" })).toThrow("empty folder");
  });

  test("reads anything unusable as no recorded state at all", () => {
    expect(parseActionState(null)).toBeNull();
    expect(parseActionState("")).toBeNull();
    expect(parseActionState("{not json")).toBeNull();
    expect(parseActionState(JSON.stringify({ folder: "", uid: 7, uid_validity: UID_VALIDITY, flags: [], labels: null }))).toBeNull();
    expect(parseActionState(JSON.stringify({ folder: "INBOX", uid: 0, uid_validity: UID_VALIDITY, flags: [], labels: null }))).toBeNull();
    expect(parseActionState(JSON.stringify({ folder: "INBOX", uid: 7 }))).toBeNull();
  });
});
