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

// Records every call, and the three mutating ones separately: moveMessages, setLabels and createFolder are
// the entire mutating surface of MailboxProvider (server/mail/providers/types.ts), so a provider whose
// three mutation logs are empty is a mailbox that was not touched. Nothing here reaches a real server.
type RecordingProvider = MailboxProvider & {
  calls: string[];
  moves: string[];
  label_writes: string[];
  created_folders: string[];
};

function createRecordingProvider(): RecordingProvider {
  const calls: string[] = [];
  const moves: string[] = [];
  const label_writes: string[] = [];
  const created_folders: string[] = [];

  return {
    calls,
    moves,
    label_writes,
    created_folders,
    capabilities: { condstore: true, qresync: true, uidplus: true, move: true, gmail: false },
    listFolders: async (): Promise<FolderInfo[]> => {
      calls.push("listFolders");
      return [{ path: "INBOX", delimiter: "/", special_use: "\\Inbox", subscribed: true, selectable: true }];
    },
    openFolder: async (folder: string): Promise<FolderStatus> => {
      calls.push(`openFolder ${folder}`);
      return { path: folder, uid_validity: "1", uid_next: 1, highest_modseq: null, exists: 0 };
    },
    fetchHeaders: async (folder: string): Promise<FetchedMessage[]> => {
      calls.push(`fetchHeaders ${folder}`);
      return [];
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
      return { target_folder, destination_uid_validity: "1", pairs: [], unconfirmed_uids: uids };
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
// loadPendingActions selects `pending` only — exactly what journal.ts's query does.
function createFakeJournal(rows: FakeActionRow[]): ActionJournal & { writes: string[] } {
  const writes: string[] = [];

  return {
    writes,
    loadPendingActions: async (input: { mailbox_id: string; batch_size: number }): Promise<PendingActionRow[]> =>
      rows
        .filter((row) => row.status === "pending")
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
        })),
    recordFromState: async () => {
      writes.push("recordFromState");
    },
    loadFilingBindings: async (): Promise<FilingBindingRow[]> => [],
    markApplied: async () => {
      writes.push("markApplied");
    },
    markFailed: async () => {
      writes.push("markFailed");
    },
    markDeferred: async () => {
      writes.push("markDeferred");
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
    promoteShadowActions: async () => {
      writes.push("promoteShadowActions");
    },
    resolveFilingActions: async () => {
      writes.push("resolveFilingActions");
    },
  };
}

function shadowResult(examined: number): RunShadowPassResult {
  return { examined, journaled: examined, by_decision: { keep: examined } };
}

// THE GUARD. Every one of the 103 sender policies is at autonomy `shadow`, nothing can be at `auto` until
// Task 8 builds the promotion procedure, and the Task 7 seam inside the pipeline is empty — so the shadow
// pass writes rows at `shadow`, nothing promotes them, and the executor that now runs unattended must
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
    executePendingActions: async () => {
      executed = true;
      return { examined: 0, applied: 0, failed: 0, deferred: 0 };
    },
  });

  expect(note).toBe("shadow pass failed: unknown: boom");
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
    executePendingActions: async () => ({ examined: 3, applied: 2, failed: 1, deferred: 0 }),
  });

  expect(note).toBe("shadow: examined 4, journaled 4; execute: examined 3, applied 2, failed 1, deferred 0");
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
    executePendingActions: async (input) => {
      sizes.push(input.batch_size);
      return { examined: 0, applied: 0, failed: 0, deferred: 0 };
    },
  });

  expect(sizes).toEqual([200]);
});
