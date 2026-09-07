// The review page's pure parts, kept out of the route so -review-groups.test.ts can check them from
// fixtures without dragging the orpc client (and through it the server router) into the test.

// Ten groups, for the same reason the promote sheet shows ten rules: the backlog is a power law, and the
// first screen is the review that pays.
export const DEFAULT_VISIBLE_GROUPS = 10;

export type CountedGroup = { count: number };

// Sorted here rather than trusted from the query, so the cut is "largest groups first" whatever order the
// rows arrived in.
export function topProposalGroups<T extends CountedGroup>(groups: T[], limit: number = DEFAULT_VISIBLE_GROUPS): T[] {
  return [...groups].sort((a, b) => b.count - a.count).slice(0, limit);
}

export type ProposalTotals = { total_groups: number; total_proposals: number };

// What the "see the rest" link stands for. Counted from the report's totals rather than from the rows in
// hand, because the loader is itself capped and the groups past that cap never arrive — a sum over the
// rows here would undercount exactly when the backlog is biggest.
export function proposalsPastTheCut(totals: ProposalTotals, visible: readonly CountedGroup[]): { groups: number; proposals: number } {
  const shown = visible.reduce((sum, group) => sum + group.count, 0);
  return { groups: Math.max(0, totals.total_groups - visible.length), proposals: Math.max(0, totals.total_proposals - shown) };
}

// How many bounded calls "Approve all" needs to cover a group of this size. Bounded by the count on
// screen, never open-ended: a group that keeps growing under the loop is left for the next press.
export function approvalPasses(count: number, batch_size: number): number {
  if (count <= 0 || batch_size <= 0) {
    return 0;
  }
  return Math.ceil(count / batch_size);
}

export type ProposalRuleKey = { by: "policy"; policy_id: string } | { by: "source"; source: string };

export type ProposalGroupKeyShape = {
  mailbox_id: string;
  rule: ProposalRuleKey;
  action_kind: string;
  target_path: string | null;
};

export function groupKeyString(key: ProposalGroupKeyShape): string {
  const rule = key.rule.by === "policy" ? `policy:${key.rule.policy_id}` : `source:${key.rule.source}`;
  return [key.mailbox_id, rule, key.action_kind, key.target_path ?? ""].join("|");
}

// One section's loader outcome. The page loads four independent reads and a failure in one must render
// as a line in that section, not as a blank page for all four.
export type SectionResult<T> = { ok: true; value: T } | { ok: false; error: string };

export function settleSection<T>(result: PromiseSettledResult<T>): SectionResult<T> {
  if (result.status === "fulfilled") {
    return { ok: true, value: result.value };
  }
  const reason: unknown = result.reason;
  return { ok: false, error: reason instanceof Error ? reason.message : String(reason) };
}
