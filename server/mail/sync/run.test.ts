import { expect, test } from "bun:test";
import type { RescuePort } from "@server/mail/rescue/detect";
import { runRescuePassForMailbox } from "@server/mail/sync/run";

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
