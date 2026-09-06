import { describe, expect, test } from "bun:test";
import type { Decision } from "@server/mail/classify/rules";
import { SWEEP_DECLINED_SOURCE, SWEEP_SETTLED_SOURCE } from "@server/mail/classify/rules";
import type { SenderArchiveCandidate, SenderArchivePort } from "@server/mail/shadow/run";
import {
  buildShadowActionRow,
  claimSenderArchives,
  journalableSourceFor,
  messageBatchQuery,
  UNSUBSCRIBE_BULK_RUN_ID,
} from "@server/mail/shadow/run";

function decisionFor(overrides: Partial<Decision> = {}): Decision {
  return { action: "archive", source: "derived", policy_id: null, suppressed_by: null, reasons: [], ...overrides };
}

describe("what a pass may journal", () => {
  test("a classify pass journals every source", () => {
    expect(journalableSourceFor({ settled_sweep: null, declined_sweep: null })).toBeNull();
  });

  test("the settled sweep journals only what it authored", () => {
    expect(journalableSourceFor({ settled_sweep: {}, declined_sweep: null })).toBe(SWEEP_SETTLED_SOURCE);
  });

  test("the declined sweep journals only what it authored — its first scheduled run re-proposed 1,090 old decisions", () => {
    expect(journalableSourceFor({ settled_sweep: null, declined_sweep: {} })).toBe(SWEEP_DECLINED_SOURCE);
  });
});

describe("buildShadowActionRow", () => {
  test("carries the mailbox_id of the pass that produced it, not a shared module-level value", () => {
    const now = new Date("2026-08-19T00:00:00.000Z");
    const row = buildShadowActionRow({
      message_id: "message-1",
      mailbox_id: "mailbox-1",
      decision: decisionFor(),
      mapping: null,
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
      mapping: null,
      run_id: "run-shared",
      now,
    });
    const row_b = buildShadowActionRow({
      message_id: "message-b",
      mailbox_id: "mailbox-b",
      decision: decisionFor(),
      mapping: null,
      run_id: "run-shared",
      now,
    });
    expect(row_a.mailbox_id).toBe("mailbox-a");
    expect(row_b.mailbox_id).toBe("mailbox-b");
  });

  test("a file decision from a policy with a client writes target_path as <client>", () => {
    const now = new Date("2026-08-19T00:00:00.000Z");
    const row = buildShadowActionRow({
      message_id: "message-file",
      mailbox_id: "mailbox-1",
      decision: decisionFor({ action: "file", source: "address_policy", policy_id: "policy-1" }),
      mapping: { client: "Acme Corp", topic: null },
      run_id: "run-1",
      now,
    });
    expect(row.target_path).toBe("Acme Corp");
  });

  test("a file decision from a policy with neither client nor topic writes a null target_path", () => {
    const now = new Date("2026-08-19T00:00:00.000Z");
    const row = buildShadowActionRow({
      message_id: "message-file-no-mapping",
      mailbox_id: "mailbox-1",
      decision: decisionFor({ action: "file", source: "address_policy", policy_id: "policy-2" }),
      mapping: { client: null, topic: null },
      run_id: "run-1",
      now,
    });
    expect(row.target_path).toBeNull();
  });

  test("an archive decision writes a null target_path even when its policy has a client set", () => {
    const now = new Date("2026-08-19T00:00:00.000Z");
    const row = buildShadowActionRow({
      message_id: "message-archive",
      mailbox_id: "mailbox-1",
      decision: decisionFor({ action: "archive", source: "address_policy", policy_id: "policy-3" }),
      mapping: { client: "Acme Corp", topic: null },
      run_id: "run-1",
      now,
    });
    expect(row.target_path).toBeNull();
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

// The scheduled sync must not re-classify the whole mailbox every fifteen minutes: it classifies only
// messages that have never been classified, which is one NOT EXISTS against Action on messageId. The
// query is inspected rather than executed — every DATABASE_URL points at the same production MySQL, so a
// behavioural test here would read live data.
describe("the scheduled classification's message batch", () => {
  test("skips messages that already have an Action row", () => {
    const sql = messageBatchQuery({
      mailbox_id: "mailbox-1",
      after_id: null,
      batch_size: 500,
      unclassified_only: true,
      settled_sweep: null,
      declined_sweep: null,
    }).toSQL().sql;

    expect(sql).toContain("not exists");
    expect(sql).toContain("`Action`");
    // Correlated on the message, not on run or status: a message classified in ANY earlier run is left
    // alone, which is what bounds the scheduled pass to newly arrived mail.
    expect(sql).toContain("`Action`.`messageId` = `Message`.`id`");
  });

  test("the operator's full sweep still classifies every live message", () => {
    const sql = messageBatchQuery({
      mailbox_id: "mailbox-1",
      after_id: null,
      batch_size: 500,
      unclassified_only: false,
      settled_sweep: null,
      declined_sweep: null,
    }).toSQL().sql;

    expect(sql).not.toContain("not exists");
    expect(sql).not.toContain("`Action`");
  });
});

// Inbox-dwell 1.9. Inspected, never executed, for the same reason as the two above: every DATABASE_URL
// points at the same production MySQL.
describe("the settled sweep's message batch", () => {
  const sweep_now = new Date("2026-08-25T12:00:00.000Z");

  function sweepSql(flavor: "gmail" | "generic"): string {
    return messageBatchQuery({
      mailbox_id: "mailbox-1",
      after_id: null,
      batch_size: 500,
      unclassified_only: false,
      settled_sweep: { dwell_days: 7, replied_dwell_days: 30, flavor, now: sweep_now },
      declined_sweep: null,
    }).toSQL().sql;
  }

  test("casts the coarse net at the SHORTER dwell, so ordinary settled mail is not hidden", () => {
    // Which dwell applies depends on replied_in_thread, which loadThreadFacts computes in JavaScript and
    // no column holds — so SQL cannot make the distinction and buildDecisionInput applies the real
    // threshold per message. Cutting at the longer value here would silently drop every ordinary settled
    // message between 7 and 30 days, which is most of them.
    const sql = messageBatchQuery({
      mailbox_id: "mailbox-1",
      after_id: null,
      batch_size: 500,
      unclassified_only: false,
      settled_sweep: { dwell_days: 7, replied_dwell_days: 30, flavor: "generic", now: sweep_now },
      declined_sweep: null,
    }).toSQL();

    // Drizzle serialises a datetime bind to "YYYY-MM-DD HH:MM:SS.mmm", so the cutoff is asserted as the
    // date it should be rather than reconstructed from a Date instance that never reaches the wire.
    // sweep_now is 2026-08-25, so 7 days back is 2026-08-18 and 30 days back would be 2026-07-26.
    expect(sql.params).toContainEqual(expect.stringContaining("2026-08-18"));
    expect(sql.params).not.toContainEqual(expect.stringContaining("2026-07-26"));
  });

  test("takes only mail that is read, in the inbox, and past the dwell", () => {
    const sql = sweepSql("generic");

    expect(sql).toContain("`Message`.`isSeen` = ?");
    expect(sql).toContain("`Message`.`internalDate` <= ?");
    expect(sql).toContain("`Message`.`folder` = ?");
  });

  test("on Gmail, inbox membership is a label on All Mail, not a folder", () => {
    const sql = sweepSql("gmail");

    expect(sql).toContain("JSON_CONTAINS");
    // The loose LIKE '%Inbox%' this replaced also matches a user label called "Inbox archive", which is
    // harmless in a count and not harmless in a sweep that moves mail.
    expect(sql).not.toContain("like");
  });

  test("decides each message once — a second sweep must not re-propose the same archive", () => {
    const sql = sweepSql("generic");

    expect(sql).toContain("not exists");
    expect(sql).toContain("`Action`.`source` = ?");
  });

  test("the scoping is the inverse of the scheduled pass, never both at once", () => {
    // unclassified_only takes mail no Action row has ever named; the sweep takes mail that WAS classified
    // and has since settled. A query carrying both predicates would return the empty set forever.
    // The sweep correlates on source, so it excludes only messages IT has already decided; it must not
    // carry the scheduled pass's bare messageId correlation, which would exclude every classified message
    // and leave the sweep with nothing to look at.
    const sweep = sweepSql("generic");
    expect(sweep).toContain("`Action`.`source` = ?");

    const scheduled = messageBatchQuery({
      mailbox_id: "mailbox-1",
      after_id: null,
      batch_size: 500,
      unclassified_only: true,
      settled_sweep: null,
      declined_sweep: null,
    }).toSQL().sql;
    expect(scheduled).not.toContain("`Message`.`isSeen`");
  });
});

// The unsubscribe button's claim. The port is faked with the same two guards journal.ts and run.ts carry
// — only a `shadow` row moves to pending, only a `failed` row reopens — and only the ids that moved come
// back, which is what lets two presses over one fake prove they cannot both own a row.
describe("claimSenderArchives", () => {
  type FakeRow = { message_id: string; status: string; error: string | null };

  function createFakePort(seed: SenderArchiveCandidate[]): SenderArchivePort & { rows: Map<string, FakeRow>; events: string[] } {
    const rows = new Map(seed.map((row) => [row.action_id, { message_id: row.message_id, status: row.status, error: null }]));
    const events: string[] = [];
    return {
      rows,
      events,
      promoteShadowActions: async (entries) => {
        events.push(`promote ${entries.map((entry) => entry.action_id).join(",")}`);
        const promoted: string[] = [];
        for (const entry of entries) {
          const row = rows.get(entry.action_id);
          if (row === undefined) {
            throw new Error(`fixture asked to promote unknown action ${entry.action_id}`);
          }
          if (row.status === "shadow") {
            row.status = "pending";
            promoted.push(entry.action_id);
          }
        }
        return promoted;
      },
      reopenFailedActions: async (input) => {
        events.push(`reopen ${input.run_id} ${input.message_ids.join(",")}`);
        const reopened: string[] = [];
        for (const [action_id, row] of rows) {
          if (row.status === "failed" && input.message_ids.includes(row.message_id)) {
            row.status = "shadow";
            row.error = null;
            reopened.push(action_id);
          }
        }
        return reopened;
      },
    };
  }

  function candidate(action_id: string, status: string, sender_key = "news@example.com"): SenderArchiveCandidate {
    return { action_id, message_id: `message-${action_id}`, status, sender_key };
  }

  test("claims the first rows up to the cap and reports exactly what the guarded write moved", async () => {
    const rows = [candidate("a-1", "shadow"), candidate("a-2", "shadow"), candidate("a-3", "shadow")];
    const port = createFakePort(rows);

    const claim = await claimSenderArchives({ rows, pending_cap: 2, port });

    expect(claim.pending.map((row) => row.action_id)).toEqual(["a-1", "a-2"]);
    expect(claim.by_sender.get("news@example.com")).toEqual({ pending: 2, waiting: 1, retried: 0, refused: 0 });
    expect(port.rows.get("a-3")?.status).toBe("shadow");
    expect(port.events).toEqual(["promote a-1,a-2"]);
  });

  test("two concurrent presses return disjoint id sets and between them claim every row exactly once", async () => {
    const rows = [candidate("a-1", "shadow"), candidate("a-2", "shadow")];
    const port = createFakePort(rows);

    const [first, second] = await Promise.all([
      claimSenderArchives({ rows, pending_cap: 50, port }),
      claimSenderArchives({ rows, pending_cap: 50, port }),
    ]);

    const first_ids = first.pending.map((row) => row.action_id);
    const second_ids = second.pending.map((row) => row.action_id);
    expect(first_ids.filter((id) => second_ids.includes(id))).toEqual([]);
    expect([...first_ids, ...second_ids].sort()).toEqual(["a-1", "a-2"]);
    expect(port.rows.get("a-1")?.status).toBe("pending");
    expect(port.rows.get("a-2")?.status).toBe("pending");
  });

  test("a re-press reopens this run's failed rows, claims them, and counts them as retried", async () => {
    const rows = [candidate("a-1", "failed"), candidate("a-2", "shadow")];
    const port = createFakePort(rows);

    const claim = await claimSenderArchives({ rows, pending_cap: 50, port });

    expect(port.events).toEqual([`reopen ${UNSUBSCRIBE_BULK_RUN_ID} message-a-1`, "promote a-1,a-2"]);
    expect(claim.pending.map((row) => row.action_id)).toEqual(["a-1", "a-2"]);
    expect(claim.by_sender.get("news@example.com")).toEqual({ pending: 2, waiting: 0, retried: 1, refused: 0 });
    expect(port.rows.get("a-1")?.error).toBeNull();
  });

  test("an archive that already landed, or a row another press still holds, is neither claimed nor waiting", async () => {
    const rows = [candidate("a-1", "applied"), candidate("a-2", "pending"), candidate("a-3", "shadow")];
    const port = createFakePort(rows);

    const claim = await claimSenderArchives({ rows, pending_cap: 50, port });

    expect(claim.pending.map((row) => row.action_id)).toEqual(["a-3"]);
    expect(claim.by_sender.get("news@example.com")).toEqual({ pending: 1, waiting: 0, retried: 0, refused: 0 });
    expect(port.rows.get("a-1")?.status).toBe("applied");
    expect(port.rows.get("a-2")?.status).toBe("pending");
  });

  test("a disabled mailbox's cap of zero claims nothing and leaves every row waiting for re-enablement", async () => {
    const rows = [candidate("a-1", "shadow"), candidate("a-2", "shadow", "other@example.com")];
    const port = createFakePort(rows);

    const claim = await claimSenderArchives({ rows, pending_cap: 0, port });

    expect(claim.pending).toEqual([]);
    expect(claim.by_sender.get("news@example.com")).toEqual({ pending: 0, waiting: 1, retried: 0, refused: 0 });
    expect(claim.by_sender.get("other@example.com")).toEqual({ pending: 0, waiting: 1, retried: 0, refused: 0 });
    expect(port.events).toEqual([]);
  });
});
