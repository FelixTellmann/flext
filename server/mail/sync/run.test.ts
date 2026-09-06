import { expect, test } from "bun:test";
import type {
  ActionJournal,
  ActionPromotionLookup,
  ActionUndoLookup,
  PendingActionRow,
  UndoableActionRow,
} from "@server/mail/actions/executor";
import { executeActions } from "@server/mail/actions/executor";
import type { ExecutableActionKind } from "@server/mail/actions/kinds";
import type { FilingBindingRow } from "@server/mail/filing/bindings";
import type {
  CopyUidResult,
  FetchedMessage,
  FlagChangeResult,
  FlagWrite,
  FlagWriteResult,
  FolderInfo,
  FolderStatus,
  LabelChange,
  LabelResult,
  MailboxProvider,
  MessageIdentity,
} from "@server/mail/providers/types";
import type { RescuePort } from "@server/mail/rescue/detect";
import type { RunShadowPassInput, RunShadowPassResult } from "@server/mail/shadow/run";
import { runClassifyAndExecutePassForMailbox, runRescuePassForMailbox } from "@server/mail/sync/run";

function okPort(): RescuePort {
  return {
    loadRescueCandidates: async () => [],
    loadLiveMessages: async () => new Map(),
    markRescued: async () => {},
    suspendPolicy: async () => false,
    countRecentSweepRescues: async () => 0,
    suspendMailboxDwell: async () => false,
    countRecentFirstContactRescues: async () => 0,
    suspendMailboxFirstContact: async () => false,
  };
}

test("a detector failure is recorded as a note, not thrown", async () => {
  const port: RescuePort = { ...okPort(), loadRescueCandidates: () => Promise.reject(new Error("boom")) };

  const note = await runRescuePassForMailbox({ port, mailbox_id: "mailbox-1", batch_size: 10 });

  expect(note).toBe("rescue detection failed: unknown: boom");
});

test("a pass that rescues nothing leaves no note", async () => {
  const note = await runRescuePassForMailbox({ port: okPort(), mailbox_id: "mailbox-1", batch_size: 10 });

  expect(note).toBeNull();
});

// Records every call, and the four mutating ones separately: moveMessages, setLabels, setFlags and
// createFolder are the entire mutating surface of MailboxProvider (server/mail/providers/types.ts), so a
// provider whose four mutation logs are empty is a mailbox that was not touched. Keeping this list in step
// with that one is load-bearing rather than tidy — an unrecorded mutating member would let a test assert
// "nothing was touched" while the sync had in fact written flags. Nothing here reaches a real server.
type RecordingProvider = MailboxProvider & {
  calls: string[];
  moves: string[];
  label_writes: string[];
  flag_writes: string[];
  created_folders: string[];
};

// `uids` are the messages the fake INBOX holds; the executor captures their state before it plans, so a
// test that expects a mutation must seed the uid it names.
function createRecordingProvider(uids: number[] = []): RecordingProvider {
  const calls: string[] = [];
  const moves: string[] = [];
  const label_writes: string[] = [];
  const flag_writes: string[] = [];
  const created_folders: string[] = [];

  return {
    calls,
    moves,
    label_writes,
    flag_writes,
    created_folders,
    capabilities: { condstore: true, qresync: true, uidplus: true, move: true, gmail: false },
    listFolders: async (): Promise<FolderInfo[]> => {
      calls.push("listFolders");
      return [
        { path: "INBOX", delimiter: "/", special_use: "\\Inbox", subscribed: true, selectable: true },
        { path: "Archives", delimiter: "/", special_use: "\\Archive", subscribed: true, selectable: true },
        { path: "Deleted Items", delimiter: "/", special_use: "\\Trash", subscribed: true, selectable: true },
      ];
    },
    openFolder: async (folder: string): Promise<FolderStatus> => {
      calls.push(`openFolder ${folder}`);
      return { path: folder, uid_validity: "1", uid_next: 1, highest_modseq: null, exists: 0 };
    },
    fetchHeaders: async (folder: string): Promise<FetchedMessage[]> => {
      calls.push(`fetchHeaders ${folder}`);
      return uids.map((uid) => ({
        uid,
        flags: ["\\Seen"],
        modseq: null,
        internal_date: new Date("2026-08-20T10:00:00.000Z"),
        size: 1024,
        gm_msgid: null,
        gm_thrid: null,
        labels: null,
        envelope: { subject: null, message_id: null, in_reply_to: null, date: null, from: [], to: [], cc: [] },
        headers: {},
        structure: null,
      }));
    },
    fetchIdentities: async (folder: string): Promise<MessageIdentity[]> => {
      calls.push(`fetchIdentities ${folder}`);
      return [];
    },
    fetchFlagChanges: async (folder: string): Promise<FlagChangeResult> => {
      calls.push(`fetchFlagChanges ${folder}`);
      return { changes: [], vanished_uids: [], qresync_used: false };
    },
    listUids: async (folder: string): Promise<number[]> => {
      calls.push(`listUids ${folder}`);
      return [];
    },
    moveMessages: async (folder: string, uids: number[], target_folder: string): Promise<CopyUidResult> => {
      calls.push(`moveMessages ${folder}`);
      moves.push(`${folder} ${uids.join(",")} -> ${target_folder}`);
      return {
        target_folder,
        destination_uid_validity: "2",
        pairs: uids.map((uid) => ({ source_uid: uid, destination_uid: uid + 1000 })),
        unconfirmed_uids: [],
      };
    },
    setFlags: async (folder: string, uids: number[], change: FlagWrite): Promise<FlagWriteResult> => {
      calls.push(`setFlags ${folder}`);
      flag_writes.push(`${folder} ${uids.join(",")} +${change.add_flags.join(",")} -${change.remove_flags.join(",")}`);
      return { folder, uids, added_flags: change.add_flags, removed_flags: change.remove_flags };
    },

    setLabels: async (folder: string, uids: number[], change: LabelChange): Promise<LabelResult> => {
      calls.push(`setLabels ${folder}`);
      label_writes.push(`${folder} ${uids.join(",")} +${change.add_labels.join(",")} -${change.remove_labels.join(",")}`);
      return { folder, uids, added_labels: change.add_labels, removed_labels: change.remove_labels };
    },
    createFolder: async (folder: string): Promise<void> => {
      calls.push(`createFolder ${folder}`);
      created_folders.push(folder);
    },
    disconnect: async (): Promise<void> => {
      calls.push("disconnect");
    },
  };
}

type FakeActionRow = { action_id: string; status: string; kind: ExecutableActionKind; folder: string; uid: number };

// Backed by an in-memory Action table so the emptiness of the pending batch is DERIVED from the rows'
// status rather than hardcoded: with no promotion, every row the shadow pass wrote is still `shadow`, and
// loadPendingActions selects `pending` only — exactly what journal.ts's query does, including its
// `action_ids` narrowing.
function createFakeJournal(rows: FakeActionRow[]): ActionJournal & { writes: string[]; batches: (string[] | undefined)[] } {
  const writes: string[] = [];
  const batches: (string[] | undefined)[] = [];

  function setStatus(action_ids: string[], status: string): void {
    for (const row of rows) {
      if (action_ids.includes(row.action_id)) {
        row.status = status;
      }
    }
  }

  return {
    writes,
    batches,
    loadPendingActions: async (input: { mailbox_id: string; batch_size: number; action_ids?: string[] }): Promise<PendingActionRow[]> => {
      batches.push(input.action_ids);
      if (input.action_ids !== undefined && input.action_ids.length === 0) {
        return [];
      }
      return rows
        .filter((row) => row.status === "pending")
        .filter((row) => input.action_ids === undefined || input.action_ids.includes(row.action_id))
        .slice(0, input.batch_size)
        .map((row) => ({
          action_id: row.action_id,
          message_id: `message-${row.uid}`,
          kind: row.kind,
          run_id: "run-1",
          folder: row.folder,
          uid: row.uid,
          target_path: null,
          policy_scope: "address" as const,
          dkim_aligned: true,
          filing_confirmed_at: null,
        }));
    },
    recordFromState: async () => {
      writes.push("recordFromState");
    },
    recordSelfMarkedRead: async (message_ids) => {
      writes.push(`recordSelfMarkedRead ${message_ids.join(",")}`);
    },
    loadFilingBindings: async (): Promise<FilingBindingRow[]> => [],
    markApplied: async (entries) => {
      writes.push("markApplied");
      setStatus(
        entries.map((entry) => entry.action_id),
        "applied",
      );
    },
    markFailed: async (entries) => {
      writes.push("markFailed");
      setStatus(
        entries.map((entry) => entry.action_id),
        "failed",
      );
    },
    markDeferred: async (entries) => {
      writes.push("markDeferred");
      setStatus(
        entries.map((entry) => entry.action_id),
        "deferred",
      );
    },
    loadActionForUndo: async (): Promise<ActionUndoLookup | null> => null,
    loadUndoableActionsByPolicy: async (): Promise<UndoableActionRow[]> => [],
    markUndone: async () => {
      writes.push("markUndone");
    },
    recordUndoFailure: async () => {
      writes.push("recordUndoFailure");
    },
    loadActionForPromotion: async (): Promise<ActionPromotionLookup | null> => null,
    loadShadowActionsByPolicy: async (): Promise<ActionPromotionLookup[]> => [],
    loadShadowActionsBySource: async (): Promise<ActionPromotionLookup[]> => [],
    promoteShadowActions: async (): Promise<string[]> => {
      writes.push("promoteShadowActions");
      return [];
    },
    resolveFilingActions: async () => {
      writes.push("resolveFilingActions");
    },
  };
}

function shadowResult(examined: number): RunShadowPassResult {
  return { examined, journaled: examined, by_decision: { keep: examined } };
}

// THE GUARD. Every one of the 103 sender policies is at autonomy `shadow` in production today, so a real
// promotion pass would find nothing to promote — but proving that here would mean querying the real
// database, which server/mail/actions/autonomy.test.ts covers with fakes instead. This test stands in the
// promotion result production would produce right now (empty) and asserts what the executor does with it:
// reach a real mailbox and change nothing in it. The real executeActions runs here, not a fake: the claim
// is about what the executor does, so substituting it would prove nothing.
test("a sync with no auto policies reaches the executor and issues zero mailbox mutations", async () => {
  const provider = createRecordingProvider();
  const journal = createFakeJournal([
    { action_id: "action-1", status: "shadow", kind: "auto_trash", folder: "INBOX", uid: 11 },
    { action_id: "action-2", status: "shadow", kind: "archive", folder: "INBOX", uid: 12 },
    { action_id: "action-3", status: "shadow", kind: "file", folder: "INBOX", uid: 13 },
  ]);

  const note = await runClassifyAndExecutePassForMailbox({
    mailbox_id: "mailbox-1",
    flavor: "generic",
    hierarchy_delimiter: "/",
    provider,
    journal,
    run_id: "sweep-run-1",
    shadowPass: async () => shadowResult(3),
    promoteAutoActions: async () => [],
    executePendingActions: executeActions,
  });

  expect(provider.moves).toEqual([]);
  expect(provider.label_writes).toEqual([]);
  expect(provider.created_folders).toEqual([]);
  // Not one call of any kind: with no pending rows the executor returns before it even lists folders.
  expect(provider.calls).toEqual([]);
  // No journal write either — nothing was applied, failed or deferred.
  expect(journal.writes).toEqual([]);
  // The run still reports its classification, and says nothing about execution because none happened.
  expect(note).toBe("shadow: examined 3, journaled 3");
});

test("the shadow pass is given the sweep's run id, not one of its own", async () => {
  const received: RunShadowPassInput[] = [];

  await runClassifyAndExecutePassForMailbox({
    mailbox_id: "mailbox-1",
    flavor: "generic",
    hierarchy_delimiter: "/",
    provider: createRecordingProvider(),
    journal: createFakeJournal([]),
    run_id: "sweep-run-1",
    shadowPass: async (input) => {
      received.push(input);
      return shadowResult(0);
    },
    promoteAutoActions: async () => [],
    executePendingActions: async () => ({ examined: 0, applied: 0, failed: 0, deferred: 0 }),
  });

  expect(received).toEqual([{ mailbox_id: "mailbox-1", batch_size: 500, run_id: "sweep-run-1" }]);
});

test("a shadow pass failure is recorded as a note and the executor still runs", async () => {
  let executed = false;

  const note = await runClassifyAndExecutePassForMailbox({
    mailbox_id: "mailbox-1",
    flavor: "generic",
    hierarchy_delimiter: "/",
    provider: createRecordingProvider(),
    journal: createFakeJournal([]),
    run_id: "sweep-run-1",
    shadowPass: () => Promise.reject(new Error("boom")),
    promoteAutoActions: async () => ["action-1"],
    executePendingActions: async () => {
      executed = true;
      return { examined: 0, applied: 0, failed: 0, deferred: 0 };
    },
  });

  expect(note).toBe("shadow pass failed: unknown: boom; execute: promoted 1, examined 0, applied 0, failed 0, deferred 0");
  expect(executed).toBe(true);
});

test("an executor failure is recorded as a note, not thrown", async () => {
  const note = await runClassifyAndExecutePassForMailbox({
    mailbox_id: "mailbox-1",
    flavor: "generic",
    hierarchy_delimiter: "/",
    provider: createRecordingProvider(),
    journal: createFakeJournal([]),
    run_id: "sweep-run-1",
    shadowPass: async () => shadowResult(2),
    promoteAutoActions: async () => ["action-1"],
    executePendingActions: () => Promise.reject(new Error("mailbox went away")),
  });

  expect(note).toBe("shadow: examined 2, journaled 2; execution failed: unknown: mailbox went away");
});

test("an executed batch is reported on the run summary", async () => {
  const note = await runClassifyAndExecutePassForMailbox({
    mailbox_id: "mailbox-1",
    flavor: "generic",
    hierarchy_delimiter: "/",
    provider: createRecordingProvider(),
    journal: createFakeJournal([]),
    run_id: "sweep-run-1",
    shadowPass: async () => shadowResult(4),
    promoteAutoActions: async () => ["action-1", "action-2", "action-3"],
    executePendingActions: async () => ({ examined: 3, applied: 2, failed: 1, deferred: 0 }),
  });

  expect(note).toBe("shadow: examined 4, journaled 4; execute: promoted 3, examined 3, applied 2, failed 1, deferred 0");
});

// The batch the scheduled run hands the executor is a constant, not something a caller can widen: the
// operator-facing path caps at 200 and nobody is present to choose one here.
test("the executor is given the bounded scheduled batch size", async () => {
  const sizes: number[] = [];

  await runClassifyAndExecutePassForMailbox({
    mailbox_id: "mailbox-1",
    flavor: "generic",
    hierarchy_delimiter: "/",
    provider: createRecordingProvider(),
    journal: createFakeJournal([]),
    run_id: "sweep-run-1",
    shadowPass: async () => shadowResult(0),
    promoteAutoActions: async () => ["action-1"],
    executePendingActions: async (input) => {
      sizes.push(input.batch_size);
      return { examined: 0, applied: 0, failed: 0, deferred: 0 };
    },
  });

  expect(sizes).toEqual([200]);
});

// THE SAFETY REGRESSION THIS ROUND EXISTS TO CLOSE. `pending` is what operator approval produces as well
// as what promotion produces, so an executor that loaded the whole pending set would apply, within
// fifteen minutes and without being asked, the ~7,900 decisions the operator approves intending to review
// before pressing Apply. The scheduled run executes only rows it promoted itself; it promoted none here.
test("an operator-approved pending row is never executed by the scheduled sync", async () => {
  const provider = createRecordingProvider();
  const approved: FakeActionRow[] = [
    { action_id: "approved-1", status: "pending", kind: "auto_trash", folder: "INBOX", uid: 21 },
    { action_id: "approved-2", status: "pending", kind: "archive", folder: "INBOX", uid: 22 },
  ];
  const journal = createFakeJournal(approved);

  const note = await runClassifyAndExecutePassForMailbox({
    mailbox_id: "mailbox-1",
    flavor: "generic",
    hierarchy_delimiter: "/",
    provider,
    journal,
    run_id: "sweep-run-1",
    shadowPass: async () => shadowResult(2),
    // Standing in for the real promoteAutoActions: with no policy at `auto` it promotes nothing, so this
    // run has nothing of its own to execute and the approved rows are none of its business.
    promoteAutoActions: async () => [],
    executePendingActions: executeActions,
  });

  expect(provider.calls).toEqual([]);
  expect(provider.moves).toEqual([]);
  expect(provider.label_writes).toEqual([]);
  expect(provider.created_folders).toEqual([]);
  expect(approved.map((row) => row.status)).toEqual(["pending", "pending"]);
  expect(journal.writes).toEqual([]);
  // Not even a load: an empty promotion returns before the executor rather than calling it with an empty
  // filter, so nothing ever asked the journal for the pending set.
  expect(journal.batches).toEqual([]);
  expect(note).toBe("shadow: examined 2, journaled 2");
});

test("an empty promotion list short-circuits before the executor", async () => {
  let executor_called = false;

  await runClassifyAndExecutePassForMailbox({
    mailbox_id: "mailbox-1",
    flavor: "generic",
    hierarchy_delimiter: "/",
    provider: createRecordingProvider(),
    journal: createFakeJournal([]),
    run_id: "sweep-run-1",
    shadowPass: async () => shadowResult(0),
    promoteAutoActions: async () => [],
    executePendingActions: async () => {
      executor_called = true;
      return { examined: 0, applied: 0, failed: 0, deferred: 0 };
    },
  });

  expect(executor_called).toBe(false);
});

// The other half of the same invariant: when this run DID promote something, the operator's approved rows
// sitting in the same pending set still go untouched. The real executeActions runs, against the real
// journal narrowing, so the filter is what is under test rather than the fake.
test("only the rows this run promoted are executed, not the rest of the pending set", async () => {
  const provider = createRecordingProvider([31, 32]);
  const rows: FakeActionRow[] = [
    { action_id: "promoted-1", status: "pending", kind: "auto_trash", folder: "INBOX", uid: 31 },
    { action_id: "approved-1", status: "pending", kind: "auto_trash", folder: "INBOX", uid: 32 },
  ];
  const journal = createFakeJournal(rows);

  await runClassifyAndExecutePassForMailbox({
    mailbox_id: "mailbox-1",
    flavor: "generic",
    hierarchy_delimiter: "/",
    provider,
    journal,
    run_id: "sweep-run-1",
    shadowPass: async () => shadowResult(2),
    promoteAutoActions: async () => ["promoted-1"],
    executePendingActions: executeActions,
  });

  expect(journal.batches).toEqual([["promoted-1"]]);
  // UID 31 moved; UID 32, the operator's, was never named in a mutation.
  expect(provider.moves).toEqual(["INBOX 31 -> Deleted Items"]);
  expect(rows.find((row) => row.action_id === "approved-1")?.status).toBe("pending");
});
