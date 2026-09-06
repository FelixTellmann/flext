import { describe, expect, test } from "bun:test";
import { DEFAULT_VISIBLE_RULES, visibleRules } from "./-promote-list";

const rules = Array.from({ length: 14 }, (_, index) => ({ policy_id: `p${index}`, waiting: index * 3 }));

describe("visibleRules", () => {
  test("cuts to the top ten by waiting count, largest first, and reports the rest as hidden", () => {
    const { visible, hidden } = visibleRules(rules, false);
    expect(visible).toHaveLength(DEFAULT_VISIBLE_RULES);
    expect(visible.map((rule) => rule.waiting)).toEqual([39, 36, 33, 30, 27, 24, 21, 18, 15, 12]);
    expect(hidden).toBe(4);
  });

  test("the toggle shows every rule, still ordered, with nothing hidden", () => {
    const { visible, hidden } = visibleRules(rules, true);
    expect(visible).toHaveLength(14);
    expect(visible[0]?.waiting).toBe(39);
    expect(hidden).toBe(0);
  });

  test("ten or fewer rules are never cut, so the toggle has nothing to offer", () => {
    const few = rules.slice(0, 10);
    expect(visibleRules(few, false)).toEqual({ visible: [...few].reverse(), hidden: 0 });
  });
});
