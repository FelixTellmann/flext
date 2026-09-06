// The promote sheet defaults to the rules that matter: on 2026-08-26 ten of 113 policies covered half
// the backlog, so ten rows is the review that pays and the rest is a scroll nobody finishes.
export const DEFAULT_VISIBLE_RULES = 10;

export type WaitingRule = { waiting: number };

// Sorted here rather than trusted from the query, so the cut is "top by waiting" whatever order the rows
// arrived in. `hidden` is what the "Show all" toggle would reveal.
export function visibleRules<T extends WaitingRule>(rules: T[], show_all: boolean): { visible: T[]; hidden: number } {
  const ordered = [...rules].sort((a, b) => b.waiting - a.waiting);
  if (show_all || ordered.length <= DEFAULT_VISIBLE_RULES) {
    return { visible: ordered, hidden: 0 };
  }
  return { visible: ordered.slice(0, DEFAULT_VISIBLE_RULES), hidden: ordered.length - DEFAULT_VISIBLE_RULES };
}
