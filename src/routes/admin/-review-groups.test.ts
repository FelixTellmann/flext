import { describe, expect, test } from "bun:test";
import {
  approvalPasses,
  DEFAULT_VISIBLE_GROUPS,
  groupKeyString,
  proposalsPastTheCut,
  settleSection,
  topProposalGroups,
} from "./-review-groups";

const groups = Array.from({ length: 14 }, (_, index) => ({ label: `g${index}`, count: (index + 1) * 5 }));

describe("topProposalGroups", () => {
  test("cuts to the ten largest groups", () => {
    const visible = topProposalGroups(groups);
    expect(visible).toHaveLength(DEFAULT_VISIBLE_GROUPS);
    expect(visible.map((group) => group.count)).toEqual([70, 65, 60, 55, 50, 45, 40, 35, 30, 25]);
  });

  test("ten or fewer groups are never cut", () => {
    const few = groups.slice(0, 10);
    expect(topProposalGroups(few)).toEqual([...few].reverse());
  });

  test("an empty report has nothing to show", () => {
    expect(topProposalGroups([])).toEqual([]);
  });
});

describe("proposalsPastTheCut", () => {
  const totals = { total_groups: groups.length, total_proposals: groups.reduce((sum, group) => sum + group.count, 0) };

  test("totals what the link to the full page stands for", () => {
    expect(proposalsPastTheCut(totals, topProposalGroups(groups))).toEqual({ groups: 4, proposals: 5 + 10 + 15 + 20 });
  });

  // The loader caps the rows it returns, so the report's totals are the only count that sees past it.
  test("counts groups the loader never returned", () => {
    const loaded = groups.slice(0, 12);
    const past = proposalsPastTheCut({ total_groups: 60, total_proposals: 900 }, topProposalGroups(loaded));
    expect(past.groups).toBe(50);
    expect(past.proposals).toBe(900 - (60 + 55 + 50 + 45 + 40 + 35 + 30 + 25 + 20 + 15));
  });

  test("nothing past the cut when everything is on screen", () => {
    const few = groups.slice(0, 10);
    expect(proposalsPastTheCut({ total_groups: 10, total_proposals: 275 }, topProposalGroups(few))).toEqual({ groups: 0, proposals: 0 });
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
