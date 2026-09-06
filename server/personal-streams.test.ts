import { describe, expect, test } from "bun:test";
import { resolveStreamAttributes } from "@server/personal-streams";

// A stream is a project, but the mode and the floor each have a fallback, and the ledger's deficit column
// is only honest if the fallbacks resolve the same way every time. Each rule below is one row of that
// table; the dormant and maintenance cases guard spec 6.3, which says those modes owe nothing.

const area = { mode: "always_on", soft_floor_hours: 10 };

describe("mode: the project's own, else the area's", () => {
  test("a project mode wins over the area mode", () => {
    const resolved = resolveStreamAttributes({ project: { mode: "sprint", soft_floor_hours: null }, area, is_only_project: true });

    expect(resolved.mode).toBe("sprint");
  });

  test("a null project mode inherits the area mode", () => {
    const resolved = resolveStreamAttributes({ project: { mode: null, soft_floor_hours: null }, area, is_only_project: true });

    expect(resolved.mode).toBe("always_on");
  });
});

describe("floor: the project's own, else the area's for its only project", () => {
  test("a project floor wins over the area floor", () => {
    const resolved = resolveStreamAttributes({ project: { mode: null, soft_floor_hours: 4 }, area, is_only_project: true });

    expect(resolved.soft_floor_hours).toBe(4);
  });

  test("the area floor applies when the project is the area's only one", () => {
    const resolved = resolveStreamAttributes({ project: { mode: null, soft_floor_hours: null }, area, is_only_project: true });

    expect(resolved.soft_floor_hours).toBe(10);
  });

  test("the area floor is not split across several projects", () => {
    const resolved = resolveStreamAttributes({ project: { mode: null, soft_floor_hours: null }, area, is_only_project: false });

    expect(resolved.soft_floor_hours).toBeNull();
  });

  test("a project with no floor anywhere has none", () => {
    const resolved = resolveStreamAttributes({
      project: { mode: null, soft_floor_hours: null },
      area: { mode: "always_on", soft_floor_hours: null },
      is_only_project: true,
    });

    expect(resolved.soft_floor_hours).toBeNull();
  });
});

describe("dormant and maintenance accrue no deficit", () => {
  test("a dormant project has no floor even with one stored", () => {
    const resolved = resolveStreamAttributes({ project: { mode: "dormant", soft_floor_hours: 6 }, area, is_only_project: true });

    expect(resolved).toEqual({ mode: "dormant", soft_floor_hours: null });
  });

  test("a maintenance mode inherited from the area also clears the floor", () => {
    const resolved = resolveStreamAttributes({
      project: { mode: null, soft_floor_hours: 6 },
      area: { mode: "maintenance", soft_floor_hours: 10 },
      is_only_project: true,
    });

    expect(resolved).toEqual({ mode: "maintenance", soft_floor_hours: null });
  });

  test("sprint keeps its floor", () => {
    const resolved = resolveStreamAttributes({ project: { mode: "sprint", soft_floor_hours: 6 }, area, is_only_project: false });

    expect(resolved.soft_floor_hours).toBe(6);
  });
});
