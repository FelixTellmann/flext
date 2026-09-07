import { describe, expect, test } from "bun:test";
import { isoWeekOf, isoWeekRange, operatorDateOf, operatorDayStart, operatorDayStartOf, operatorWeekRange } from "@server/operator-day";

// Every screen, bucket and ingest window in the personal OS agrees on one definition of "today". These
// tests exist because the failure is silent: a boundary that drifts by two hours does not throw, it just
// files late-evening work under tomorrow and makes a day report hours it did not hold.

describe("the operator's day begins at local midnight, not UTC midnight", () => {
  test("late evening local still belongs to that day, not the next", () => {
    // 2026-08-28T21:30 local is 19:30Z — comfortably inside the 28th either way.
    expect(operatorDateOf(new Date("2026-08-28T19:30:00.000Z"))).toBe("2026-08-28");
  });

  test("the two hours before local midnight are the day that is ending", () => {
    // 2026-08-28T23:30 local is 21:30Z. A UTC reading would agree here.
    expect(operatorDateOf(new Date("2026-08-28T21:30:00.000Z"))).toBe("2026-08-28");
  });

  test("the small hours after local midnight are the new day, where a UTC reading would disagree", () => {
    // 2026-08-29T00:30 local is 2026-08-28T22:30Z — UTC still calls this the 28th.
    expect(operatorDateOf(new Date("2026-08-28T22:30:00.000Z"))).toBe("2026-08-29");
  });

  test("a named day starts two hours before UTC midnight", () => {
    expect(operatorDayStartOf("2026-08-28").toISOString()).toBe("2026-08-27T22:00:00.000Z");
  });

  test("the two day-start forms agree on the same instant", () => {
    const at = new Date("2026-08-28T19:30:00.000Z");

    expect(operatorDayStart(at).toISOString()).toBe(operatorDayStartOf(operatorDateOf(at)).toISOString());
  });
});

describe("isoWeekOf pins a week to the year holding its Thursday", () => {
  test("a date in the middle of the year", () => {
    expect(isoWeekOf(new Date("2026-08-28T10:00:00.000Z"))).toBe("2026-W35");
  });

  test("the last days of December can belong to week 1 of the next year", () => {
    expect(isoWeekOf(new Date("2026-12-31T10:00:00.000Z"))).toBe("2026-W53");
    expect(isoWeekOf(new Date("2025-12-31T10:00:00.000Z"))).toBe("2026-W01");
  });

  test("a week is stable across the days inside it", () => {
    const monday = isoWeekOf(new Date("2026-08-24T10:00:00.000Z"));
    const sunday = isoWeekOf(new Date("2026-08-30T10:00:00.000Z"));

    expect(monday).toBe(sunday);
  });
});

describe("operatorWeekRange runs Monday to Sunday", () => {
  test("a Friday resolves to its own Monday and Sunday", () => {
    expect(operatorWeekRange(new Date("2026-08-28T10:00:00.000Z"))).toEqual({ from: "2026-08-24", to: "2026-08-30" });
  });

  test("a Sunday belongs to the week that is ending, not the one starting", () => {
    expect(operatorWeekRange(new Date("2026-08-30T10:00:00.000Z"))).toEqual({ from: "2026-08-24", to: "2026-08-30" });
  });

  test("a Monday is the first day of its own week", () => {
    expect(operatorWeekRange(new Date("2026-08-24T10:00:00.000Z"))).toEqual({ from: "2026-08-24", to: "2026-08-30" });
  });
});

describe("isoWeekRange is the inverse of isoWeekOf", () => {
  test("a mid-year label resolves to the Monday and Sunday operatorWeekRange gives", () => {
    expect(isoWeekRange("2026-W35")).toEqual({ from: "2026-08-24", to: "2026-08-30" });
  });

  test("week 1 can begin in the previous calendar year", () => {
    expect(isoWeekRange("2026-W01")).toEqual({ from: "2025-12-29", to: "2026-01-04" });
  });

  test("week 53 exists in a year that has one", () => {
    expect(isoWeekRange("2026-W53")).toEqual({ from: "2026-12-28", to: "2027-01-03" });
  });

  test("every day of the range labels back to the same week", () => {
    for (const week of ["2026-W01", "2026-W35", "2026-W53", "2027-W01"]) {
      const { from, to } = isoWeekRange(week);

      expect(isoWeekOf(operatorDayStartOf(from))).toBe(week);
      expect(isoWeekOf(operatorDayStartOf(to))).toBe(week);
    }
  });

  test("a label that is not an ISO week throws", () => {
    expect(() => isoWeekRange("2026-35")).toThrow();
  });
});
