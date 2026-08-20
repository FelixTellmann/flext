import { describe, expect, test } from "bun:test";
import type { CopyResponseObject, ImapFlow } from "imapflow";
import { buildImapProvider } from "./imap";
import type { MailboxCapabilities } from "./types";

type FailurePoint = "move" | "copy" | "expunge" | "add_labels" | "remove_labels" | "create_folder";

type FakeOptions = {
  uidplus?: boolean;
  move?: boolean;
  gmail?: boolean;
  flavor?: "gmail" | "generic";
  copyuid_destination?: number[] | null;
  copyuid_uid_validity?: number | null;
  copyuid_omit?: number[];
  fail?: FailurePoint;
  create_folder_error?: unknown;
};

type LockRecord = { folder: string; read_only: boolean; released: boolean };

function formatSet(uids: number[]): string {
  return uids.join(",");
}

function createFake(options: FakeOptions = {}) {
  const uidplus = options.uidplus ?? true;
  const move = options.move ?? true;
  const gmail = options.gmail ?? false;

  const commands: string[] = [];
  const locks: LockRecord[] = [];

  function copyResponse(destination: string, uids: number[]): CopyResponseObject {
    const response: CopyResponseObject = { path: "INBOX", destination };

    const uid_validity = options.copyuid_uid_validity === undefined ? 38505 : options.copyuid_uid_validity;
    if (uid_validity !== null) {
      response.uidValidity = BigInt(uid_validity);
    }

    const destination_uids =
      options.copyuid_destination === undefined ? uids.map((_uid, index) => 9001 + index) : options.copyuid_destination;
    if (destination_uids !== null) {
      const omitted = options.copyuid_omit ?? [];
      const entries: [number, number][] = [];
      uids.forEach((uid, index) => {
        if (omitted.includes(uid)) {
          return;
        }
        entries.push([uid, destination_uids[index]]);
      });
      response.uidMap = new Map(entries);
    }

    return response;
  }

  const fake = {
    mailbox: { path: "INBOX", uidValidity: 38504n, uidNext: 900, highestModseq: 77n, exists: 12 },

    getMailboxLock: async (folder: string, lock_options?: { readOnly?: boolean }) => {
      const record: LockRecord = { folder, read_only: lock_options?.readOnly === true, released: false };
      locks.push(record);
      commands.push(`SELECT ${folder} (${record.read_only ? "readonly" : "readwrite"})`);
      return {
        path: folder,
        release: () => {
          record.released = true;
        },
      };
    },

    messageMove: async (uids: number[], destination: string, move_options?: { uid?: boolean }) => {
      commands.push(`${move_options?.uid === true ? "UID " : ""}MOVE ${formatSet(uids)} ${destination}`);
      if (options.fail === "move") {
        return false;
      }
      return copyResponse(destination, uids);
    },

    messageCopy: async (uids: number[], destination: string, copy_options?: { uid?: boolean }) => {
      commands.push(`${copy_options?.uid === true ? "UID " : ""}COPY ${formatSet(uids)} ${destination}`);
      if (options.fail === "copy") {
        return false;
      }
      return copyResponse(destination, uids);
    },

    // Mirrors node_modules/imapflow/lib/commands/expunge.js: STORE +FLAGS (\Deleted), then
    // `UID EXPUNGE <set>` only while UIDPLUS is advertised and the caller asked for UIDs — otherwise a
    // bare `EXPUNGE`. The degradation is modelled rather than assumed so the tests below assert the
    // command that would actually reach the wire.
    messageDelete: async (uids: number[], delete_options?: { uid?: boolean }) => {
      commands.push(`STORE ${formatSet(uids)} +FLAGS (\\Deleted)`);
      const by_uid = delete_options?.uid === true && uidplus;
      commands.push(by_uid ? `UID EXPUNGE ${formatSet(uids)}` : "EXPUNGE");
      if (options.fail === "expunge") {
        return false;
      }
      return true;
    },

    messageFlagsAdd: async (uids: number[], flags: string[], store_options?: { uid?: boolean; useLabels?: boolean }) => {
      const operation = store_options?.useLabels === true ? "X-GM-LABELS" : "FLAGS";
      commands.push(`${store_options?.uid === true ? "UID " : ""}STORE ${formatSet(uids)} +${operation} (${flags.join(" ")})`);
      if (options.fail === "add_labels") {
        return false;
      }
      return true;
    },

    messageFlagsRemove: async (uids: number[], flags: string[], store_options?: { uid?: boolean; useLabels?: boolean }) => {
      const operation = store_options?.useLabels === true ? "X-GM-LABELS" : "FLAGS";
      commands.push(`${store_options?.uid === true ? "UID " : ""}STORE ${formatSet(uids)} -${operation} (${flags.join(" ")})`);
      if (options.fail === "remove_labels") {
        return false;
      }
      return true;
    },

    mailboxCreate: async (path: string) => {
      commands.push(`CREATE ${path}`);
      if (options.fail === "create_folder") {
        throw options.create_folder_error ?? new Error("CREATE failed");
      }
      return { path, created: true };
    },

    list: async () => {
      commands.push("LIST");
      return [];
    },

    fetch: async function* (range: string) {
      commands.push(`UID FETCH ${range}`);
      yield* [];
    },

    search: async () => {
      commands.push("UID SEARCH ALL");
      return [];
    },

    on: () => undefined,
    removeListener: () => undefined,
    logout: async () => undefined,
    close: () => undefined,
  };

  const capabilities: MailboxCapabilities = { condstore: true, qresync: true, uidplus, move, gmail };
  const provider = buildImapProvider(fake as unknown as ImapFlow, capabilities, options.flavor ?? (gmail ? "gmail" : "generic"));

  return { provider, commands, locks };
}

const INBOX_UIDS = [101, 102];

describe("UID EXPUNGE is never allowed to become a bare EXPUNGE", () => {
  test("a move that would fall back to COPY + EXPUNGE hard-fails without UIDPLUS, before the folder is even selected", async () => {
    const { provider, commands, locks } = createFake({ uidplus: false, move: false });

    await expect(provider.moveMessages("INBOX", INBOX_UIDS, "Archives/2026")).rejects.toThrow(/UIDPLUS/);
    expect(commands).toEqual([]);
    expect(locks).toEqual([]);
  });

  test("a move over a server that does advertise MOVE still refuses without UIDPLUS, because COPYUID would be unknowable", async () => {
    const { provider, commands } = createFake({ uidplus: false, move: true });

    await expect(provider.moveMessages("INBOX", INBOX_UIDS, "Archives/2026")).rejects.toThrow(/UIDPLUS/);
    expect(commands).toEqual([]);
  });

  test("an empty UID set is refused rather than issued as a set-less expunge", async () => {
    const { provider, commands } = createFake({ move: false });

    await expect(provider.moveMessages("INBOX", [], "Archives/2026")).rejects.toThrow(/empty UID set/);
    expect(commands).toEqual([]);
  });

  test("a UID set carrying a non-UID is refused before any command is issued", async () => {
    const zero = createFake();
    await expect(zero.provider.moveMessages("INBOX", [0], "Archives/2026")).rejects.toThrow(/positive integers/);
    expect(zero.commands).toEqual([]);

    const fractional = createFake();
    await expect(fractional.provider.moveMessages("INBOX", [101.5], "Archives/2026")).rejects.toThrow(/positive integers/);
    expect(fractional.commands).toEqual([]);

    const not_a_number = createFake({ gmail: true });
    await expect(not_a_number.provider.setLabels("INBOX", [Number.NaN], { add_labels: ["\\Inbox"], remove_labels: [] })).rejects.toThrow(
      /positive integers/,
    );
    expect(not_a_number.commands).toEqual([]);
  });
});

describe("moveMessages", () => {
  test("issues UID MOVE where the server advertises MOVE", async () => {
    const { provider, commands } = createFake({ move: true });

    const result = await provider.moveMessages("INBOX", INBOX_UIDS, "Archives/2026");

    expect(commands).toEqual(["SELECT INBOX (readwrite)", "UID MOVE 101,102 Archives/2026"]);
    expect(result).toEqual({
      target_folder: "Archives/2026",
      destination_uid_validity: "38505",
      pairs: [
        { source_uid: 101, destination_uid: 9001 },
        { source_uid: 102, destination_uid: 9002 },
      ],
      unconfirmed_uids: [],
    });
  });

  test("falls back to UID COPY + STORE \\Deleted + UID EXPUNGE over the same set where MOVE is absent", async () => {
    const { provider, commands } = createFake({ move: false });

    const result = await provider.moveMessages("INBOX", INBOX_UIDS, "Archives/2026");

    expect(commands).toEqual([
      "SELECT INBOX (readwrite)",
      "UID COPY 101,102 Archives/2026",
      "STORE 101,102 +FLAGS (\\Deleted)",
      "UID EXPUNGE 101,102",
    ]);
    expect(result.pairs).toEqual([
      { source_uid: 101, destination_uid: 9001 },
      { source_uid: 102, destination_uid: 9002 },
    ]);
  });

  test("the fallback expunges exactly the set it copied, never a wider one", async () => {
    const { provider, commands } = createFake({ move: false });

    await provider.moveMessages("INBOX", [7], "Archives/2026");

    expect(commands).toContain("UID COPY 7 Archives/2026");
    expect(commands).toContain("UID EXPUNGE 7");
    expect(commands).not.toContain("EXPUNGE");
  });

  test("the whole move is refused when the server sends no COPYUID, so undo is never left without an address", async () => {
    const { provider } = createFake({ copyuid_destination: null });

    await expect(provider.moveMessages("INBOX", INBOX_UIDS, "Archives/2026")).rejects.toThrow(/COPYUID/);
  });

  test("a COPYUID without a UIDVALIDITY is refused too", async () => {
    const { provider } = createFake({ copyuid_uid_validity: null });

    await expect(provider.moveMessages("INBOX", INBOX_UIDS, "Archives/2026")).rejects.toThrow(/COPYUID/);
  });

  test("a refused UID MOVE surfaces as a throw rather than a silent no-op", async () => {
    const { provider } = createFake({ fail: "move" });

    await expect(provider.moveMessages("INBOX", INBOX_UIDS, "Archives/2026")).rejects.toThrow(/UID MOVE/);
  });

  test("a fallback whose expunge fails throws, leaving the copy visible to the caller as a stopped sequence", async () => {
    const { provider, commands } = createFake({ move: false, fail: "expunge" });

    await expect(provider.moveMessages("INBOX", INBOX_UIDS, "Archives/2026")).rejects.toThrow(/UID EXPUNGE/);
    expect(commands).toContain("UID COPY 101,102 Archives/2026");
  });
});

describe("COPYUID accounts for every requested UID", () => {
  test("a fully confirmed UID MOVE reports nothing unconfirmed", async () => {
    const { provider } = createFake({ move: true });

    const result = await provider.moveMessages("INBOX", INBOX_UIDS, "Archives/2026");

    expect(result.pairs.map((pair) => pair.source_uid)).toEqual(INBOX_UIDS);
    expect(result.unconfirmed_uids).toEqual([]);
  });

  test("a UID the server left out of COPYUID is returned as unconfirmed, not thrown and not invented", async () => {
    const { provider } = createFake({ move: true, copyuid_omit: [102] });

    const result = await provider.moveMessages("INBOX", [101, 102, 103], "Archives/2026");

    expect(result.pairs).toEqual([
      { source_uid: 101, destination_uid: 9001 },
      { source_uid: 103, destination_uid: 9003 },
    ]);
    expect(result.unconfirmed_uids).toEqual([102]);
  });

  test("the confirmed destination addresses survive a partial batch — throwing would orphan them too", async () => {
    const { provider } = createFake({ move: true, copyuid_omit: [101] });

    const result = await provider.moveMessages("INBOX", [101, 102], "Archives/2026");

    expect(result.pairs).toEqual([{ source_uid: 102, destination_uid: 9002 }]);
    expect(result.unconfirmed_uids).toEqual([101]);
    expect(result.destination_uid_validity).toBe("38505");
  });

  test("the COPY fallback reports the same partial accounting", async () => {
    const { provider } = createFake({ move: false, copyuid_omit: [102] });

    const result = await provider.moveMessages("INBOX", [101, 102], "Archives/2026");

    expect(result.pairs).toEqual([{ source_uid: 101, destination_uid: 9001 }]);
    expect(result.unconfirmed_uids).toEqual([102]);
  });

  test("the COPY fallback expunges only the UIDs COPYUID confirmed", async () => {
    const { provider, commands } = createFake({ move: false, copyuid_omit: [102] });

    await provider.moveMessages("INBOX", [101, 102], "Archives/2026");

    expect(commands).toEqual([
      "SELECT INBOX (readwrite)",
      "UID COPY 101,102 Archives/2026",
      "STORE 101 +FLAGS (\\Deleted)",
      "UID EXPUNGE 101",
    ]);
  });

  test("a COPY fallback that confirmed nothing expunges nothing at all", async () => {
    const { provider, commands } = createFake({ move: false, copyuid_omit: INBOX_UIDS });

    const result = await provider.moveMessages("INBOX", INBOX_UIDS, "Archives/2026");

    expect(result.pairs).toEqual([]);
    expect(result.unconfirmed_uids).toEqual(INBOX_UIDS);
    expect(commands).toEqual(["SELECT INBOX (readwrite)", "UID COPY 101,102 Archives/2026"]);
    expect(commands.some((command) => command.includes("EXPUNGE"))).toBe(false);
  });
});

describe("setLabels", () => {
  test("an add issues STORE +X-GM-LABELS", async () => {
    const { provider, commands } = createFake({ gmail: true });

    const result = await provider.setLabels("INBOX", [101], { add_labels: ["\\Inbox"], remove_labels: [] });

    expect(commands).toEqual(["SELECT INBOX (readwrite)", "UID STORE 101 +X-GM-LABELS (\\Inbox)"]);
    expect(result).toEqual({ folder: "INBOX", uids: [101], added_labels: ["\\Inbox"], removed_labels: [] });
  });

  test("a removal issues STORE -X-GM-LABELS", async () => {
    const { provider, commands } = createFake({ gmail: true });

    await provider.setLabels("INBOX", [101], { add_labels: [], remove_labels: ["\\Inbox"] });

    expect(commands).toEqual(["SELECT INBOX (readwrite)", "UID STORE 101 -X-GM-LABELS (\\Inbox)"]);
  });

  test("additions are issued before removals, so a half-applied change gains a label rather than losing one", async () => {
    const { provider, commands } = createFake({ gmail: true });

    await provider.setLabels("INBOX", [101], { add_labels: ["Work", "Clients/Acme"], remove_labels: ["\\Inbox"] });

    expect(commands).toEqual([
      "SELECT INBOX (readwrite)",
      "UID STORE 101 +X-GM-LABELS (Work Clients/Acme)",
      "UID STORE 101 -X-GM-LABELS (\\Inbox)",
    ]);
  });

  test("a label write against a folder server is refused instead of being silently dropped", async () => {
    const { provider, commands } = createFake({ gmail: false });

    await expect(provider.setLabels("INBOX", [101], { add_labels: ["\\Inbox"], remove_labels: [] })).rejects.toThrow(/Gmail label store/);
    expect(commands).toEqual([]);
  });

  test("a Gmail server behind a generic-flavoured mailbox is refused as well", async () => {
    const { provider } = createFake({ gmail: true, flavor: "generic" });

    await expect(provider.setLabels("INBOX", [101], { add_labels: ["\\Inbox"], remove_labels: [] })).rejects.toThrow(/Gmail label store/);
  });

  test("a change with nothing to add and nothing to remove is refused rather than issued as an empty STORE", async () => {
    const { provider, commands } = createFake({ gmail: true });

    await expect(provider.setLabels("INBOX", [101], { add_labels: [], remove_labels: [] })).rejects.toThrow(/nothing to add/);
    expect(commands).toEqual([]);
  });

  test("a rejected STORE throws instead of reporting labels that were never written", async () => {
    const { provider } = createFake({ gmail: true, fail: "add_labels" });

    await expect(provider.setLabels("INBOX", [101], { add_labels: ["Work"], remove_labels: [] })).rejects.toThrow(/STORE \+X-GM-LABELS/);
  });
});

describe("locking", () => {
  test("every read path takes a read-only lock", async () => {
    const { provider, locks } = createFake();

    await provider.openFolder("INBOX");
    await provider.fetchHeaders("INBOX", "1:*");
    await provider.fetchIdentities("INBOX");
    await provider.fetchFlagChanges("INBOX", "77");
    await provider.listUids("INBOX");

    expect(locks).toHaveLength(5);
    expect(locks.every((lock) => lock.read_only)).toBe(true);
    expect(locks.every((lock) => lock.released)).toBe(true);
  });

  test("every mutation method takes exactly one write lock, fallback included", async () => {
    const move = createFake({ move: true });
    await move.provider.moveMessages("INBOX", INBOX_UIDS, "Archives/2026");

    // The COPY + EXPUNGE fallback runs inside the same single lock rather than taking one of its own.
    const fallback = createFake({ move: false });
    await fallback.provider.moveMessages("INBOX", INBOX_UIDS, "Archives/2026");

    const labels = createFake({ gmail: true });
    await labels.provider.setLabels("INBOX", [101], { add_labels: ["\\Inbox"], remove_labels: [] });

    for (const { locks } of [move, fallback, labels]) {
      expect(locks).toHaveLength(1);
      expect(locks[0].read_only).toBe(false);
      expect(locks[0].released).toBe(true);
    }
  });

  test("the write lock is released when the mutation fails", async () => {
    const move = createFake({ fail: "move" });
    await expect(move.provider.moveMessages("INBOX", INBOX_UIDS, "Archives/2026")).rejects.toThrow();
    expect(move.locks[0].released).toBe(true);

    const copy = createFake({ move: false, fail: "copy" });
    await expect(copy.provider.moveMessages("INBOX", INBOX_UIDS, "Archives/2026")).rejects.toThrow();
    expect(copy.locks[0].released).toBe(true);

    const labels = createFake({ gmail: true, fail: "remove_labels" });
    await expect(labels.provider.setLabels("INBOX", [101], { add_labels: [], remove_labels: ["\\Inbox"] })).rejects.toThrow();
    expect(labels.locks[0].released).toBe(true);

    const expunge = createFake({ move: false, fail: "expunge" });
    await expect(expunge.provider.moveMessages("INBOX", INBOX_UIDS, "Archives/2026")).rejects.toThrow();
    expect(expunge.locks[0].released).toBe(true);
  });

  test("a read path never opens a writable mailbox even on a server that can mutate", async () => {
    const { provider, commands } = createFake({ move: true, gmail: true });

    await provider.listUids("INBOX");
    await provider.openFolder("INBOX");

    expect(commands.filter((command) => command.startsWith("SELECT"))).toEqual(["SELECT INBOX (readonly)", "SELECT INBOX (readonly)"]);
  });
});

// The interface enumerates what can happen to a mailbox, so an unreachable member is a lie about the
// blast radius rather than dead weight: `copyMessages` and `expungeUids` sat here through Phase 4 with no
// caller, and a public expunge was the only way this contract could delete mail. Adding either back needs
// a caller and this list edited on purpose. `createFolder` joined in Phase 5 (§6) as the narrowest
// possible addition: it creates, and it cannot delete, rename, unsubscribe or move anything.
test("the provider exposes exactly three mutating methods, and none deletes", () => {
  const { provider } = createFake();

  const members = Object.keys(provider).sort();
  expect(members).toEqual([
    "capabilities",
    "createFolder",
    "disconnect",
    "fetchFlagChanges",
    "fetchHeaders",
    "fetchIdentities",
    "listFolders",
    "listUids",
    "moveMessages",
    "openFolder",
    "setLabels",
  ]);
  expect(members.some((member) => member.toLowerCase().includes("purge"))).toBe(false);
  expect(members).not.toContain("expungeUids");
  expect(members).not.toContain("copyMessages");
});

describe("createFolder", () => {
  test("issues CREATE and takes no lock at all — it needs no selected mailbox", async () => {
    const { provider, commands, locks } = createFake();

    await provider.createFolder("Archives/2026");

    expect(commands).toEqual(["CREATE Archives/2026"]);
    expect(locks).toEqual([]);
  });

  test("a folder that already exists resolves rather than throwing, per the ALREADYEXISTS response code", async () => {
    const { provider } = createFake({
      fail: "create_folder",
      create_folder_error: Object.assign(new Error("Mailbox already exists"), { responseCode: "ALREADYEXISTS" }),
    });

    await expect(provider.createFolder("Archives/2026")).resolves.toBeUndefined();
  });

  test("a folder that already exists resolves on a server predating ALREADYEXISTS, matched by the NO text instead", async () => {
    const { provider } = createFake({
      fail: "create_folder",
      create_folder_error: Object.assign(new Error("NO [CANNOT] Mailbox already exists"), { responseText: "Mailbox already exists" }),
    });

    await expect(provider.createFolder("Archives/2026")).resolves.toBeUndefined();
  });

  test("any other failure propagates", async () => {
    const { provider } = createFake({
      fail: "create_folder",
      create_folder_error: Object.assign(new Error("NO Permission denied"), { responseCode: "CANNOT" }),
    });

    await expect(provider.createFolder("Archives/2026")).rejects.toThrow(/Permission denied/);
  });
});
