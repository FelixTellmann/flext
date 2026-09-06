import { describe, expect, test } from "bun:test";
import type { ActionJournal, ExecuteActionsInput, ExecuteActionsResult } from "@server/mail/actions/executor";
import { inverseOf, planFor, SEEN_FLAG } from "@server/mail/actions/kinds";
import type { PolicyAction, PolicyScope } from "@server/mail/classify/rules";
import { JUNK_FOLDER_SOURCE } from "@server/mail/classify/rules";
import type { FolderInfo, MailboxProvider } from "@server/mail/providers/types";
import type { PolicyRow } from "@server/mail/query/policies";
import type { JunkCandidate, JunkQuarantinePort } from "@server/mail/sync/junk";
import {
  isJunkFolder,
  JUNK_FOLDER_RUN_ID,
  junkCandidateQuery,
  junkVerdictFor,
  runJunkQuarantinePassForMailbox,
  selectJunkFolders,
} from "@server/mail/sync/junk";

// xneelo's shape: "." delimiter, INBOX as the namespace root, no SPECIAL-USE on the spam folder.
function folder(path: string, overrides: Partial<FolderInfo> = {}): FolderInfo {
  return { path, delimiter: ".", special_use: null, subscribed: true, selectable: true, ...overrides };
}

describe("junk folder detection", () => {
  test("a server that advertises \\Junk needs no name match", () => {
    expect(isJunkFolder(folder("INBOX.Rubbish", { special_use: "\\Junk" }))).toBe(true);
  });

  test("INBOX.Junk and INBOX.spambucket under a '.' delimiter match on their last segment", () => {
    expect(isJunkFolder(folder("INBOX.Junk"))).toBe(true);
    expect(isJunkFolder(folder("INBOX.spambucket"))).toBe(true);
  });

  test("the name match is case-insensitive and accepts a top-level folder", () => {
    expect(isJunkFolder(folder("Spam", { delimiter: "/" }))).toBe(true);
    expect(isJunkFolder(folder("INBOX.JUNK"))).toBe(true);
  });

  test("a folder named Junkyard is not a junk folder", () => {
    expect(isJunkFolder(folder("INBOX.Junkyard"))).toBe(false);
  });

  test("the name is the last segment only — a junk-named parent does not claim its children", () => {
    expect(isJunkFolder(folder("INBOX.Junk.Kept"))).toBe(false);
  });

  test("Quarantine and the inbox are never junk folders", () => {
    expect(isJunkFolder(folder("INBOX.Quarantine"))).toBe(false);
    expect(isJunkFolder(folder("INBOX", { special_use: "\\Inbox" }))).toBe(false);
  });

  test("selectJunkFolders returns the paths of selectable junk folders only", () => {
    const folders = [
      folder("INBOX", { special_use: "\\Inbox" }),
      folder("INBOX.Junk"),
      folder("INBOX.spambucket", { selectable: false }),
      folder("INBOX.Quarantine"),
    ];

    expect(selectJunkFolders(folders)).toEqual(["INBOX.Junk"]);
  });
});

describe("the candidate query", () => {
  test("takes live messages in the junk folders with no applied or pending quarantine", () => {
    const sql = junkCandidateQuery({ mailbox_id: "mailbox-1", junk_folders: ["INBOX.Junk", "INBOX.spambucket"], batch_size: 200 }).toSQL()
      .sql;

    expect(sql).toContain("`Message`.`disappearedAt` is null");
    expect(sql).toContain("`Message`.`folder` in (?, ?)");
    expect(sql).toContain("not exists");
    expect(sql).toContain("`Action`.`messageId` = `Message`.`id`");
    expect(sql).toContain("`Action`.`kind` = ?");
    expect(sql).toContain("`Action`.`status` in (?, ?)");
    expect(sql).toContain("order by `Message`.`internalDate` asc");
  });

  test("refuses an empty folder list rather than emitting IN ()", () => {
    expect(() => junkCandidateQuery({ mailbox_id: "mailbox-1", junk_folders: [], batch_size: 200 })).toThrow();
  });
});

function policyRow(input: { scope: PolicyScope; value: string; action: PolicyAction }): PolicyRow {
  const now = new Date("2026-09-01T00:00:00.000Z");
  return {
    id: `policy-${input.value}`,
    scope: input.scope,
    value: input.value,
    action: input.action,
    client: null,
    topic: null,
    autonomy: "shadow",
    autonomy_promoted_at: null,
    source: "test",
    suspended_at: null,
    suspension_reason: null,
    createdAt: now,
    updatedAt: now,
  };
}

function policyIndex(rows: PolicyRow[]) {
  const by_address = new Map<string, PolicyRow>();
  const by_domain = new Map<string, PolicyRow>();
  for (const row of rows) {
    (row.scope === "address" ? by_address : by_domain).set(row.value.toLowerCase(), row);
  }
  return { by_address, by_domain };
}

function candidate(overrides: Partial<JunkCandidate> = {}): JunkCandidate {
  return {
    id: "message-1",
    folder: "INBOX.Junk",
    from_address: "news@example.com",
    from_domain: "example.com",
    is_flagged: false,
    ...overrides,
  };
}

describe("the verdict on a junk message", () => {
  test("no policy: move", () => {
    expect(junkVerdictFor(candidate(), policyIndex([]))).toBe("move");
  });

  test("a keep_inbox address policy leaves it where it is", () => {
    const index = policyIndex([policyRow({ scope: "address", value: "News@Example.com", action: "keep_inbox" })]);

    expect(junkVerdictFor(candidate(), index)).toBe("keep_inbox");
  });

  test("a keep_inbox domain policy leaves it where it is", () => {
    const index = policyIndex([policyRow({ scope: "domain", value: "example.com", action: "keep_inbox" })]);

    expect(junkVerdictFor(candidate(), index)).toBe("keep_inbox");
  });

  test("an address policy outranks a domain keep_inbox, as matchPolicy resolves it", () => {
    const index = policyIndex([
      policyRow({ scope: "domain", value: "example.com", action: "keep_inbox" }),
      policyRow({ scope: "address", value: "news@example.com", action: "file" }),
    ]);

    expect(junkVerdictFor(candidate(), index)).toBe("move");
  });

  test("a policy that is not keep_inbox does not protect the message", () => {
    const index = policyIndex([policyRow({ scope: "address", value: "news@example.com", action: "archive" })]);

    expect(junkVerdictFor(candidate(), index)).toBe("move");
  });

  test("a flagged message is left in place, before any policy is consulted", () => {
    expect(junkVerdictFor(candidate({ is_flagged: true }), policyIndex([]))).toBe("flagged");
  });

  test("a message with no sender address is still moved", () => {
    expect(junkVerdictFor(candidate({ from_address: null, from_domain: null }), policyIndex([]))).toBe("move");
  });
});

describe("the plan for a junk message", () => {
  const context = {
    source_folder: "INBOX.Junk",
    archive_folder: null,
    trash_folder: null,
    file_folder: null,
    quarantine_folder: "INBOX.Quarantine",
  };

  test("marks it read first, then moves it out of the junk folder into Quarantine", () => {
    const plan = planFor("quarantine", "generic", context);

    expect(plan.pre_mutations).toEqual([{ verb: "set_flags", add_flags: [SEEN_FLAG], remove_flags: [] }]);
    expect(plan.mutation).toEqual({ verb: "move", source_folder: "INBOX.Junk", target_folder: "INBOX.Quarantine" });
  });

  test("the inverse restores it to the junk folder it came from, unread", () => {
    const plan = planFor("quarantine", "generic", context);

    const inverse = inverseOf(plan, { folder: "INBOX.Junk", flags: [], labels: null });

    expect(inverse).toEqual([
      { verb: "move", source_folder: "INBOX.Quarantine", target_folder: "INBOX.Junk" },
      { verb: "set_flags", add_flags: [], remove_flags: [SEEN_FLAG] },
    ]);
  });
});

type RecordedExecution = { input: ExecuteActionsInput };

function fakePort(input: { candidates: JunkCandidate[]; policies?: PolicyRow[]; journaled?: string[][] }): JunkQuarantinePort {
  const journaled = input.journaled ?? [];
  return {
    loadCandidates: async () => input.candidates,
    loadPolicyIndex: async () => policyIndex(input.policies ?? []),
    journalPendingQuarantines: async ({ message_ids }) => {
      journaled.push(message_ids);
      return message_ids.map((message_id) => `action-for-${message_id}`);
    },
  };
}

// The pass only forwards these to the executor, and the executor here is a fake that records its input,
// so nothing on either is ever called.
const provider = {} as unknown as MailboxProvider;
const journal = {} as unknown as ActionJournal;

function passInput(port: JunkQuarantinePort, executions: RecordedExecution[], result?: Partial<ExecuteActionsResult>) {
  return {
    mailbox_id: "mailbox-1",
    flavor: "generic" as const,
    hierarchy_delimiter: ".",
    junk_folders: ["INBOX.Junk"],
    batch_size: 200,
    provider,
    journal,
    port,
    executePendingActions: async (input: ExecuteActionsInput): Promise<ExecuteActionsResult> => {
      executions.push({ input });
      return { examined: input.action_ids?.length ?? 0, applied: input.action_ids?.length ?? 0, failed: 0, deferred: 0, ...result };
    },
  };
}

describe("the junk quarantine pass", () => {
  test("a Gmail mailbox is out of scope: no read, no note", async () => {
    const executions: RecordedExecution[] = [];
    const port: JunkQuarantinePort = {
      ...fakePort({ candidates: [candidate()] }),
      loadCandidates: () => Promise.reject(new Error("read")),
    };

    const note = await runJunkQuarantinePassForMailbox({ ...passInput(port, executions), flavor: "gmail" });

    expect(note).toBeNull();
    expect(executions).toHaveLength(0);
  });

  test("a server with no junk folder is skipped without a read", async () => {
    const executions: RecordedExecution[] = [];
    const port: JunkQuarantinePort = {
      ...fakePort({ candidates: [candidate()] }),
      loadCandidates: () => Promise.reject(new Error("read")),
    };

    const note = await runJunkQuarantinePassForMailbox({ ...passInput(port, executions), junk_folders: [] });

    expect(note).toBeNull();
    expect(executions).toHaveLength(0);
  });

  test("an empty junk folder leaves no note and never reaches the executor", async () => {
    const executions: RecordedExecution[] = [];

    const note = await runJunkQuarantinePassForMailbox(passInput(fakePort({ candidates: [] }), executions));

    expect(note).toBeNull();
    expect(executions).toHaveLength(0);
  });

  test("journals and executes exactly the movable messages, and says what it left behind", async () => {
    const executions: RecordedExecution[] = [];
    const journaled: string[][] = [];
    const port = fakePort({
      candidates: [
        candidate({ id: "spam-1", from_address: "a@spam.example", from_domain: "spam.example" }),
        candidate({ id: "flagged-1", is_flagged: true }),
        candidate({ id: "kept-1", from_address: "friend@example.com", from_domain: "example.com" }),
        candidate({ id: "spam-2", from_address: "b@spam.example", from_domain: "spam.example" }),
      ],
      policies: [policyRow({ scope: "address", value: "friend@example.com", action: "keep_inbox" })],
      journaled,
    });

    const note = await runJunkQuarantinePassForMailbox(passInput(port, executions));

    expect(journaled).toEqual([["spam-1", "spam-2"]]);
    expect(executions).toHaveLength(1);
    expect(executions[0]?.input.action_ids).toEqual(["action-for-spam-1", "action-for-spam-2"]);
    expect(executions[0]?.input.mailbox_id).toBe("mailbox-1");
    expect(executions[0]?.input.batch_size).toBe(200);
    expect(executions[0]?.input.provider).toBe(provider);
    expect(executions[0]?.input.journal).toBe(journal);
    expect(note).toBe("junk: examined 4, moved 2, failed 0, left 1 flagged in place, kept 1 by policy");
  });

  test("when everything is flagged or kept, the executor is not called", async () => {
    const executions: RecordedExecution[] = [];
    const journaled: string[][] = [];
    const port = fakePort({
      candidates: [candidate({ id: "flagged-1", is_flagged: true })],
      journaled,
    });

    const note = await runJunkQuarantinePassForMailbox(passInput(port, executions));

    expect(journaled).toHaveLength(0);
    expect(executions).toHaveLength(0);
    expect(note).toBe("junk: examined 1, moved 0, failed 0, left 1 flagged in place");
  });

  test("failures and deferrals from the executor are reported", async () => {
    const executions: RecordedExecution[] = [];
    const port = fakePort({ candidates: [candidate({ id: "spam-1" }), candidate({ id: "spam-2" }), candidate({ id: "spam-3" })] });

    const note = await runJunkQuarantinePassForMailbox(passInput(port, executions, { applied: 1, failed: 1, deferred: 1 }));

    expect(note).toBe("junk: examined 3, moved 1, failed 1, deferred 1");
  });

  test("a port failure becomes a note, not a thrown error", async () => {
    const executions: RecordedExecution[] = [];
    const port: JunkQuarantinePort = { ...fakePort({ candidates: [] }), loadCandidates: () => Promise.reject(new Error("boom")) };

    const note = await runJunkQuarantinePassForMailbox(passInput(port, executions));

    expect(note).toBe("junk quarantine failed: unknown: boom");
  });

  test("the source and run id are the stage's own, so its rows coexist with the classify pass's", () => {
    expect(JUNK_FOLDER_SOURCE).toBe("junk_folder");
    expect(JUNK_FOLDER_RUN_ID).not.toBe("scheduled-sync");
  });
});
