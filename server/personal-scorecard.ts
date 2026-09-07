// The execution score for one week, spec 4.3: planned tactics only, a percentage and never a streak.
// Pure so the live weeks and the freeze on review completion cannot disagree about the arithmetic.

export type ScoredTask = { plan_week: string | null; goal_id: string | null; completed_at: Date | null };

export type WeekScore = { planned: number; completed: number; percent: number | null };

// `week_range.to` is exclusive: the instant the following week begins.
export const scoreWeek = (tasks: ScoredTask[], week: string, week_range: { from: Date; to: Date }): WeekScore => {
  const planned_tasks = tasks.filter((task) => task.plan_week === week && task.goal_id !== null);
  const completed = planned_tasks.filter(
    (task) => task.completed_at !== null && task.completed_at >= week_range.from && task.completed_at < week_range.to,
  ).length;
  const planned = planned_tasks.length;

  // Null, never zero: a week with nothing planned has no score, and rendering it as 0% would manufacture
  // a miss out of an absence (spec 16).
  return { planned, completed, percent: planned === 0 ? null : Math.round((completed / planned) * 100) };
};
