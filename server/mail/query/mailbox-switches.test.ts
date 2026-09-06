import { describe, expect, test } from "bun:test";
import { SOURCE_SWITCHES, sourceAutonomyColumn, sourceAutonomyColumns, suspensionClearColumns } from "@server/mail/query/mailbox-switches";

const now = new Date("2026-09-06T21:00:00.000Z");

describe("sourceAutonomyColumns", () => {
  test("auto stamps the switch's own set-at with the JS Date it was given", () => {
    expect(sourceAutonomyColumns("first_contact", "auto", now)).toEqual({
      first_contact_autonomy: "auto",
      first_contact_autonomy_set_at: now,
      updatedAt: now,
    });
    expect(sourceAutonomyColumns("settled_sweep", "auto", now)).toEqual({
      settled_sweep_autonomy: "auto",
      settled_sweep_autonomy_set_at: now,
      updatedAt: now,
    });
    expect(sourceAutonomyColumns("declined_sweep", "auto", now)).toEqual({
      declined_sweep_autonomy: "auto",
      declined_sweep_autonomy_set_at: now,
      updatedAt: now,
    });
  });

  test("shadow clears the set-at, so a later re-enable cannot inherit a stale cutoff", () => {
    expect(sourceAutonomyColumns("first_contact", "shadow", now)).toEqual({
      first_contact_autonomy: "shadow",
      first_contact_autonomy_set_at: null,
      updatedAt: now,
    });
  });

  test("each switch writes only its own pair: no switch can touch another's columns or a suspension", () => {
    for (const source of SOURCE_SWITCHES) {
      const keys = Object.keys(sourceAutonomyColumns(source, "auto", now)).sort();
      expect(keys).toEqual([`${source}_autonomy`, `${source}_autonomy_set_at`, "updatedAt"]);
    }
  });
});

describe("suspensionClearColumns", () => {
  test("first contact clears its own pair, stamps its cleared-at, and touches nothing else", () => {
    expect(suspensionClearColumns("first_contact", now)).toEqual({
      first_contact_suspended_at: null,
      first_contact_suspension_reason: null,
      first_contact_suspension_cleared_at: now,
      updatedAt: now,
    });
  });

  test("dwell clears the pair that suspends both sweeps and stamps its own cleared-at", () => {
    expect(suspensionClearColumns("dwell", now)).toEqual({
      dwell_suspended_at: null,
      dwell_suspension_reason: null,
      dwell_suspension_cleared_at: now,
      updatedAt: now,
    });
  });

  // The floor is the JS Date the caller passed, not a database NOW(): detect.ts compares it against
  // Date.now() in JS, and drizzle.ts sets no session timezone.
  test("the cleared-at is the same instant as updatedAt", () => {
    const columns = suspensionClearColumns("dwell", now);
    expect(columns.dwell_suspension_cleared_at).toBe(columns.updatedAt);
  });
});

describe("sourceAutonomyColumn", () => {
  test("each switch names its own autonomy column, the one the same-value guard compares against", () => {
    expect(sourceAutonomyColumn("first_contact").name).toBe("firstContactAutonomy");
    expect(sourceAutonomyColumn("settled_sweep").name).toBe("settledSweepAutonomy");
    expect(sourceAutonomyColumn("declined_sweep").name).toBe("declinedSweepAutonomy");
  });
});
