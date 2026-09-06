import { describe, expect, test } from "bun:test";
import { approvalPasses, DEFAULT_VISIBLE_GROUPS, groupKeyString, settleSection, topProposalGroups } from "./-review-groups";

const groups = Array.from({ length: 14 }, (_, index) => ({ label: `g${index}`, count: (index + 1) * 5 }));

describe("topProposalGroups", () => {
  test("cuts to the ten largest groups and totals what the link to the full page stands for", () => {
    const { visible, hidden_groups, hidden_proposals } = topProposalGroups(groups);
    expect(visible).toHaveLength(DEFAULT_VISIBLE_GROUPS);
    expect(visible.map((group) => group.count)).toEqual([70, 65, 60, 55, 50, 45, 40, 35, 30, 25]);
    expect(hidden_groups).toBe(4);
    expect(hidden_proposals).toBe(5 + 10 + 15 + 20);
  });

  test("ten or fewer groups are never cut", () => {
    const few = groups.slice(0, 10);
    expect(topProposalGroups(few)).toEqual({ visible: [...few].reverse(), hidden_groups: 0, hidden_proposals: 0 });
  });

  test("an empty report has nothing to show and nothing hidden", () => {
    expect(topProposalGroups([])).toEqual({ visible: [], hidden_groups: 0, hidden_proposals: 0 });
  });
});

describe("approvalPasses", () => {
  test("covers the group shown with the fewest bounded calls", () => {
    expect(approvalPasses(412, 200)).toBe(3);
    expect(approvalPasses(200, 200)).toBe(1);
    expect(approvalPasses(1, 200)).toBe(1);
  });

  test("an empty group needs no call at all", () => {
    expect(approvalPasses(0, 200)).toBe(0);
    expect(approvalPasses(5, 0)).toBe(0);
  });
});

describe("groupKeyString", () => {
  test("distinguishes a policy from a source and a destination from none", () => {
    const by_policy = { mailbox_id: "m1", rule: { by: "policy", policy_id: "p1" }, action_kind: "file", target_path: "Finances" } as const;
    expect(groupKeyString(by_policy)).toBe("m1|policy:p1|file|Finances");
    expect(groupKeyString({ ...by_policy, rule: { by: "source", source: "first_contact" } })).toBe("m1|source:first_contact|file|Finances");
    expect(groupKeyString({ ...by_policy, target_path: null })).not.toBe(groupKeyString(by_policy));
  });
});

describe("settleSection", () => {
  test("carries a fulfilled value through and words a rejection", () => {
    expect(settleSection({ status: "fulfilled", value: 3 })).toEqual({ ok: true, value: 3 });
    expect(settleSection({ status: "rejected", reason: new Error("connection refused") })).toEqual({
      ok: false,
      error: "connection refused",
    });
    expect(settleSection({ status: "rejected", reason: "plain string" })).toEqual({ ok: false, error: "plain string" });
  });
});
