import { describe, expect, test } from "bun:test";
import { percentOf, scoreWeek } from "@server/personal-scorecard";

// The score is only honest over planned tactics (spec 4.3's first trap), and it has to say "nothing" for a
// week with nothing planned rather than "0%" (spec 16). Each case below is one of those edges.

const week = "2026-W35";
const week_range = { from: new Date("2026-08-23T22:00:00.000Z"), to: new Date("2026-08-30T22:00:00.000Z") };
const inside = new Date("2026-08-26T10:00:00.000Z");

describe("scoreWeek", () => {
  test("nothing planned is null, never zero", () => {
    expect(scoreWeek([], week, week_range)).toEqual({ planned: 0, completed: 0, percent: null });
  });

  test("a task without a goal is not a tactic and never counts", () => {
    const tasks = [{ plan_week: week, goal_id: null, completed_at: inside }];

    expect(scoreWeek(tasks, week, week_range)).toEqual({ planned: 0, completed: 0, percent: null });
  });

  test("a tactic planned for another week is not this week's plan", () => {
    const tasks = [{ plan_week: "2026-W34", goal_id: "g1", completed_at: inside }];

    expect(scoreWeek(tasks, week, week_range)).toEqual({ planned: 0, completed: 0, percent: null });
  });

  test("a completion outside the week counts as planned but not as completed", () => {
    const tasks = [
      { plan_week: week, goal_id: "g1", completed_at: new Date("2026-08-31T10:00:00.000Z") },
      { plan_week: week, goal_id: "g1", completed_at: new Date("2026-08-23T21:59:59.000Z") },
    ];

    expect(scoreWeek(tasks, week, week_range)).toEqual({ planned: 2, completed: 0, percent: 0 });
  });

  test("the week's own boundary instant belongs to the week; the next week's does not", () => {
    const tasks = [
      { plan_week: week, goal_id: "g1", completed_at: week_range.from },
      { plan_week: week, goal_id: "g1", completed_at: week_range.to },
    ];

    expect(scoreWeek(tasks, week, week_range)).toEqual({ planned: 2, completed: 1, percent: 50 });
  });

  test("percent is rounded over planned only", () => {
    const tasks = [
      { plan_week: week, goal_id: "g1", completed_at: inside },
      { plan_week: week, goal_id: "g2", completed_at: inside },
      { plan_week: week, goal_id: "g1", completed_at: null },
    ];

    expect(scoreWeek(tasks, week, week_range)).toEqual({ planned: 3, completed: 2, percent: 67 });
  });
});

describe("percentOf", () => {
  test("frozen counts score the same way a live week does", () => {
    expect(percentOf(0, 0)).toBeNull();
    expect(percentOf(3, 2)).toBe(67);
  });
});
