import { describe, expect, test } from "bun:test";
import { BUCKET_SECONDS, bucketHeartbeats, normaliseProjectName } from "@server/wakatime/bucket-heartbeats";

// The ledger exists to answer one question honestly: where did the hours go. Two things can make it lie,
// and both are guarded here. It can invent time — if a bucket ever distributed more than its 900 seconds,
// a day with three editors open would report more hours than the day physically held. And it can lose
// time to a name — the same work arrives as `doveras` and `doveras-donor-parser`, which measured a 40%
// under-report on the 2026 data before normalisation existed.

const at = (iso: string) => new Date(iso);

describe("bucketHeartbeats apportions a bucket and never more than a bucket", () => {
  test("three projects with equal activity split the bucket three ways", () => {
    const rows = bucketHeartbeats({
      heartbeats: [
        { occurred_at: at("2026-08-28T09:00:00.000Z"), project: "listify" },
        { occurred_at: at("2026-08-28T09:01:00.000Z"), project: "platter" },
        { occurred_at: at("2026-08-28T09:02:00.000Z"), project: "kidsliving" },
      ],
    });

    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.seconds)).toEqual([300, 300, 300]);
    // 10000 ten-thousandths do not divide by three, so the odd unit goes to the first by largest
    // remainder. The point is that they sum to exactly one, not that they are identical.
    expect(rows.map((row) => row.share)).toEqual([0.3334, 0.3333, 0.3333]);
    expect(rows.reduce((sum, row) => sum + Math.round(row.share * 10_000), 0)).toBe(10_000);
  });

  test("a bucket worked by one project is entirely that project's", () => {
    const rows = bucketHeartbeats({ heartbeats: [{ occurred_at: at("2026-08-28T09:00:00.000Z"), project: "listify" }] });

    expect(rows).toEqual([{ bucket_start: at("2026-08-28T09:00:00.000Z"), project: "listify", seconds: 900, share: 1 }]);
  });

  test("seconds sum to exactly the bucket however awkwardly it divides", () => {
    // Seven projects divide 900 as 128.57 each — the case where independent rounding leaks seconds.
    const heartbeats = Array.from({ length: 7 }, (_, index) => ({
      occurred_at: at("2026-08-28T09:00:00.000Z"),
      project: `project-${String.fromCharCode(97 + index)}`,
    }));

    const rows = bucketHeartbeats({ heartbeats });

    expect(rows).toHaveLength(7);
    expect(rows.reduce((sum, row) => sum + row.seconds, 0)).toBe(BUCKET_SECONDS);
  });

  // Six equal projects are the case that caught this on real heartbeats: 150/900 is 0.16667, which rounds
  // UP to 0.1667, and six of those sum to 1.0002 — a bucket claiming more time than it held. An earlier
  // version divided the share out of the seconds and rounded, and only a three-way split was tested, which
  // happens to round down and hid it. Every split from 1 to 12 is checked now.
  test("shares sum to exactly one at every split, never above", () => {
    for (const project_count of Array.from({ length: 12 }, (_, index) => index + 1)) {
      // Letters, not digits: a trailing number is stripped as a second checkout, so `project-0` and
      // `project-1` would normalise to the same stream and collapse into one row.
      const heartbeats = Array.from({ length: project_count }, (_, index) => ({
        occurred_at: at("2026-08-28T09:00:00.000Z"),
        project: `project-${String.fromCharCode(97 + index)}`,
      }));

      const rows = bucketHeartbeats({ heartbeats });

      expect(rows).toHaveLength(project_count);
      expect(rows.reduce((sum, row) => sum + row.seconds, 0)).toBe(BUCKET_SECONDS);
      // Summed in whole ten-thousandths, which is how the decimal(5,4) column stores them and how MySQL
      // adds them back up. Summing the JS decimals instead reports 1.0000000000000002 for six equal
      // projects — float error in the assertion, not an over-allocation in the data.
      expect(rows.reduce((sum, row) => sum + Math.round(row.share * 10_000), 0)).toBe(10_000);
    }
  });

  test("weight follows heartbeat count, not merely presence", () => {
    const rows = bucketHeartbeats({
      heartbeats: [
        { occurred_at: at("2026-08-28T09:00:00.000Z"), project: "listify" },
        { occurred_at: at("2026-08-28T09:01:00.000Z"), project: "listify" },
        { occurred_at: at("2026-08-28T09:02:00.000Z"), project: "listify" },
        { occurred_at: at("2026-08-28T09:03:00.000Z"), project: "platter" },
      ],
    });

    expect(rows.find((row) => row.project === "listify")?.seconds).toBe(675);
    expect(rows.find((row) => row.project === "platter")?.seconds).toBe(225);
  });
});

describe("a bucket nobody worked in is absent, never zero", () => {
  test("only the quarter-hours that hold heartbeats produce rows", () => {
    const rows = bucketHeartbeats({
      heartbeats: [
        { occurred_at: at("2026-08-28T09:00:00.000Z"), project: "listify" },
        // 09:15 and 09:30 hold nothing at all.
        { occurred_at: at("2026-08-28T09:45:00.000Z"), project: "listify" },
      ],
    });

    expect(rows.map((row) => row.bucket_start.toISOString())).toEqual(["2026-08-28T09:00:00.000Z", "2026-08-28T09:45:00.000Z"]);
  });

  test("a heartbeat is filed by the quarter-hour it falls in, not the one it is nearest", () => {
    const rows = bucketHeartbeats({ heartbeats: [{ occurred_at: at("2026-08-28T09:14:59.999Z"), project: "listify" }] });

    expect(rows[0]?.bucket_start.toISOString()).toBe("2026-08-28T09:00:00.000Z");
  });
});

describe("normaliseProjectName folds the names that are the same project", () => {
  test("a workspace path reduces to its last segment", () => {
    expect(normaliseProjectName("C:\\development\\listify")).toBe("listify");
    expect(normaliseProjectName("/Users/felixtellmann/development/listify")).toBe("listify");
  });

  test("a trailing number is a second checkout, not a different project", () => {
    expect(normaliseProjectName("listify-2")).toBe("listify");
    expect(normaliseProjectName("listify_3")).toBe("listify");
  });

  test("an alias folds a name no mechanical rule could infer", () => {
    expect(normaliseProjectName("doveras-donor-parser")).toBe("doveras");
    expect(normaliseProjectName("C:\\development\\doveras-donor-parser")).toBe("doveras");
  });

  test("an absent or empty project is named rather than dropped", () => {
    expect(normaliseProjectName(null)).toBe("unknown");
    expect(normaliseProjectName("   ")).toBe("unknown");
  });

  test("the three listify spellings collapse into one bucket row", () => {
    const rows = bucketHeartbeats({
      heartbeats: [
        { occurred_at: at("2026-08-28T09:00:00.000Z"), project: "listify" },
        { occurred_at: at("2026-08-28T09:01:00.000Z"), project: "listify-2" },
        { occurred_at: at("2026-08-28T09:02:00.000Z"), project: "C:\\development\\listify" },
      ],
    });

    expect(rows).toEqual([{ bucket_start: at("2026-08-28T09:00:00.000Z"), project: "listify", seconds: 900, share: 1 }]);
  });
});
