import { describe, expect, test } from "bun:test";
import type { Decision } from "@server/mail/classify/rules";
import { buildShadowActionRow } from "@server/mail/shadow/run";

function decisionFor(overrides: Partial<Decision> = {}): Decision {
  return { action: "archive", source: "derived", policy_id: null, suppressed_by: null, reasons: [], ...overrides };
}

describe("buildShadowActionRow", () => {
  test("carries the mailbox_id of the pass that produced it, not a shared module-level value", () => {
    const now = new Date("2026-08-19T00:00:00.000Z");
    const row = buildShadowActionRow({
      message_id: "message-1",
      mailbox_id: "mailbox-1",
      decision: decisionFor(),
      run_id: "run-1",
      now,
    });
    expect(row.mailbox_id).toBe("mailbox-1");
  });

  test("two batches from different mailboxes in the same run each keep their own mailbox_id", () => {
    const now = new Date("2026-08-19T00:00:00.000Z");
    const row_a = buildShadowActionRow({
      message_id: "message-a",
      mailbox_id: "mailbox-a",
      decision: decisionFor(),
      run_id: "run-shared",
      now,
    });
    const row_b = buildShadowActionRow({
      message_id: "message-b",
      mailbox_id: "mailbox-b",
      decision: decisionFor(),
      run_id: "run-shared",
      now,
    });
    expect(row_a.mailbox_id).toBe("mailbox-a");
    expect(row_b.mailbox_id).toBe("mailbox-b");
  });
});

// writeShadowBatch is not exported and issues its INSERT through the shared db handle, and every
// DATABASE_URL in this project points at the same production MySQL — so the upsert itself cannot be
// exercised here. The SET clause is pinned by reading it instead, because re-adding `status` is the one
// edit that would silently drag an approved, applied or undone row back to `shadow` on a re-run of the
// same run_id, stranding a mutation that already landed with no reachable undo.
describe("writeShadowBatch's ON DUPLICATE KEY UPDATE clause", () => {
  test("assigns no status, so a re-run over a row that has left shadow cannot drag it back", async () => {
    const source = await Bun.file(`${import.meta.dir}/run.ts`).text();
    const after_clause = source.split("onDuplicateKeyUpdate({")[1];
    expect(after_clause).toBeDefined();

    const set_clause = (after_clause ?? "").split("})")[0];
    expect(set_clause).toContain("sender_policy_id:");
    expect(set_clause).toContain("updatedAt:");
    expect(set_clause).not.toContain("status");
  });
});
