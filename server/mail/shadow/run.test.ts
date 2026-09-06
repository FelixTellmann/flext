import { describe, expect, test } from "bun:test";
import type { Decision } from "@server/mail/classify/rules";
import { SWEEP_DECLINED_SOURCE, SWEEP_SETTLED_SOURCE } from "@server/mail/classify/rules";
import { buildShadowActionRow, journalableSourceFor, messageBatchQuery } from "@server/mail/shadow/run";

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
