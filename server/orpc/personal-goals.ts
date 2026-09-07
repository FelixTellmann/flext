import { ORPCError } from "@orpc/server";
import { db } from "@server/db/drizzle";
import {
  personalAntiGoal,
  personalArea,
  personalCycle,
  personalGoal,
  personalGoalProgress,
  personalPractice,
  personalPracticeEntry,
  personalReview,
  personalTask,
} from "@server/db/schema";
import { DAY_MS, isoWeekOf, isoWeekRange, operatorDateOf, operatorDayStartOf } from "@server/operator-day";
import { percentOf, scoreWeek, type WeekScore } from "@server/personal-scorecard";
import { readSetting } from "@server/personal-settings";
import { EXECUTION_BENCHMARK } from "@server/personal-thresholds";
import { and, asc, count, desc, eq, gte, inArray, isNotNull, isNull, lte } from "drizzle-orm";
import { slugify } from "utils/slugify";
import { z } from "zod";
import { authed } from "./base";
import { day_schema, freeSlug, mapTask } from "./personal-tasks";

type GoalRow = typeof personalGoal.$inferSelect;
type CycleRow = typeof personalCycle.$inferSelect;
type PracticeRow = typeof personalPractice.$inferSelect;
type AntiGoalRow = typeof personalAntiGoal.$inferSelect;

// mysql2 hands decimals back as strings; Number() here and nowhere else.
const mapGoal = (row: GoalRow) => ({
  id: row.id,
  area_id: row.area_id,
  slug: row.slug,
  title: row.title,
  kind: row.kind,
  metric: row.metric,
  direction: row.direction,
  baseline: row.baseline === null ? null : Number(row.baseline),
  target: row.target === null ? null : Number(row.target),
  unit: row.unit,
  starts_on: row.starts_on,
  due_on: row.due_on,
  status: row.status,
  cycle_id: row.cycle_id,
  sort_order: row.sort_order,
  created_at: row.createdAt.toISOString(),
});

const mapCycle = (row: CycleRow, today: string) => ({
  id: row.id,
  area_id: row.area_id,
  number: row.number,
  starts_on: row.starts_on,
  ends_on: row.ends_on,
  suspended_at: row.suspended_at?.toISOString() ?? null,
  resumed_at: row.resumed_at?.toISOString() ?? null,
  note: row.note,
  is_suspended: row.suspended_at !== null && row.resumed_at === null,
  // 1 on the first day; the status line reads "week n of 12".
  week_number: Math.floor((operatorDayStartOf(today).getTime() - operatorDayStartOf(row.starts_on).getTime()) / (7 * DAY_MS)) + 1,
});

const mapPractice = (row: PracticeRow) => ({
  id: row.id,
  area_id: row.area_id,
  goal_id: row.goal_id,
  name: row.name,
  freq_num: row.freq_num,
  freq_den: row.freq_den,
  trigger: row.trigger,
  retired_at: row.retired_at?.toISOString() ?? null,
  sort_order: row.sort_order,
});

const mapAntiGoal = (row: AntiGoalRow) => ({
  id: row.id,
  area_id: row.area_id,
  cycle_id: row.cycle_id,
  constraint_text: row.constraint_text,
  status: row.status,
  sort_order: row.sort_order,
});

const id_schema = z.object({ id: z.string().min(1) });
const week_schema = z.string().regex(/^\d{4}-W\d{2}$/);
const goal_kind_schema = z.enum(["stretch", "boundary"]);
const direction_schema = z.enum(["up", "down"]);
const goal_status_schema = z.enum(["active", "achieved", "dropped", "suspended"]);
const entry_status_schema = z.enum(["done", "missed", "skipped", "not_expected"]);
const anti_goal_status_schema = z.enum(["holding", "breached", "retired"]);
const slug_schema = z
  .string()
  .min(1)
  .max(191)
  .regex(/^[a-z0-9-]+$/);
const short_text_schema = z.string().min(1).max(191);
const note_schema = z.string().max(512).nullable();
// decimal(12,2) holds ten integer digits.
const amount_schema = z.number().finite().min(-9_999_999_999.99).max(9_999_999_999.99);
const frequency_schema = z.number().int().min(1).max(365);
const sort_order_schema = z.number().int().min(0);

// Spec 5.1's tagged union, the two kinds in use before stage 7.
const trigger_schema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("time"), at: short_text_schema }),
  z.object({ kind: z.literal("event"), event: short_text_schema }),
]);

// drizzle types a decimal column as a string on the way in as well as out.
const toDecimal = (value: number | null | undefined): string | null | undefined => {
  if (value === null || value === undefined) {
    return value;
  }

  return value.toFixed(2);
};

const CYCLE_LENGTH_DAYS = 84;

const addDays = (day: string, days: number): string =>
  new Date(operatorDayStartOf(day).getTime() + days * DAY_MS + DAY_MS / 2).toISOString().slice(0, 10);

// The instants a week spans, `to` exclusive, so a completion stamped in the small hours of Monday
// belongs to the week that just began rather than the one that ended.
const weekInstants = (week: string): { from: Date; to: Date } => {
  const range = isoWeekRange(week);

  return { from: operatorDayStartOf(range.from), to: new Date(operatorDayStartOf(range.to).getTime() + DAY_MS) };
};

// A cycle counts as running from the day it is scheduled until its last day, whether or not it is
// suspended: two of those on one area is what startCycle refuses.
const runningCycleOf = async (area_id: string, today: string): Promise<CycleRow | undefined> => {
  const [row] = await db
    .select()
    .from(personalCycle)
    .where(and(eq(personalCycle.area_id, area_id), gte(personalCycle.ends_on, today)))
    .orderBy(desc(personalCycle.number))
    .limit(1);

  return row;
};

const cycleOrThrow = async (id: string): Promise<CycleRow> => {
  const [row] = await db.select().from(personalCycle).where(eq(personalCycle.id, id)).limit(1);

  if (!row) {
    throw new ORPCError("NOT_FOUND");
  }

  return row;
};

// The expected count for the week, per the brief: a per-week frequency as written, anything else
// scaled to seven days and rounded.
const expectedThisWeek = (practice: PracticeRow): number =>
  practice.freq_den === 7 ? practice.freq_num : Math.round((practice.freq_num * 7) / practice.freq_den);

const computeWeekScore = async (week: string): Promise<WeekScore> => {
  const rows = await db
    .select({ plan_week: personalTask.plan_week, goal_id: personalTask.goal_id, completed_at: personalTask.completed_at })
    .from(personalTask)
    .where(and(eq(personalTask.plan_week, week), isNotNull(personalTask.goal_id)));

  return scoreWeek(rows, week, weekInstants(week));
};

// Shared with personalReview.complete. Null when the week has no review row: completing a review that
// was never opened is already a no-op there, and the freeze follows the same rule. Overwrites on a
// repeat call, because complete() overwrites completed_at too and the freeze follows the latest one.
export const freezeExecutionCounts = async (plan_week: string): Promise<WeekScore | null> => {
  const [review] = await db.select({ id: personalReview.id }).from(personalReview).where(eq(personalReview.plan_week, plan_week)).limit(1);

  if (!review) {
    return null;
  }

  const score = await computeWeekScore(plan_week);

  await db
    .update(personalReview)
    .set({ planned_count: score.planned, completed_count: score.completed, updatedAt: new Date() })
    .where(eq(personalReview.id, review.id));

  return score;
};

// Five weeks, oldest first, ending on `week`. A week whose review froze its counts reads them back so
// history never shifts (spec decision 2); every other week is computed from the tasks as they stand.
const scorecardStrip = async (week: string): Promise<Array<{ week: string } & WeekScore>> => {
  const monday = operatorDayStartOf(isoWeekRange(week).from);
  const weeks = [4, 3, 2, 1, 0].map((back) => isoWeekOf(new Date(monday.getTime() + DAY_MS / 2 - back * 7 * DAY_MS)));

  const [tasks, reviews] = await Promise.all([
    db
      .select({ plan_week: personalTask.plan_week, goal_id: personalTask.goal_id, completed_at: personalTask.completed_at })
      .from(personalTask)
      .where(and(inArray(personalTask.plan_week, weeks), isNotNull(personalTask.goal_id))),
    db
      .select({
        plan_week: personalReview.plan_week,
        planned_count: personalReview.planned_count,
        completed_count: personalReview.completed_count,
      })
      .from(personalReview)
      .where(and(inArray(personalReview.plan_week, weeks), isNotNull(personalReview.planned_count))),
  ]);

  const frozen = new Map(reviews.map((review) => [review.plan_week, review]));

  return weeks.map((strip_week) => {
    const review = frozen.get(strip_week);

    if (review !== undefined && review.planned_count !== null && review.completed_count !== null) {
      const { planned_count: planned, completed_count: completed } = review;

      return { week: strip_week, planned, completed, percent: percentOf(planned, completed) };
    }

    return { week: strip_week, ...scoreWeek(tasks, strip_week, weekInstants(strip_week)) };
  });
};

export const personalGoalProcedures = {
  // Everything the Goals screen renders, in one round trip. One query per table and assembled here, as
  // listAreas does: five areas, a handful of goals each, and a join would only be unpicked again.
  overview: authed.input(z.object({ week: week_schema.optional() }).default({})).handler(async ({ input }) => {
    const now = new Date();
    const week = input.week ?? isoWeekOf(now);
    const today = operatorDateOf(now);
    const range = isoWeekRange(week);
    const instants = weekInstants(week);

    const [areas, cycles, goals, practices, anti_goals, tactic_rows, strip, benchmark] = await Promise.all([
      db.select().from(personalArea).where(isNull(personalArea.archived_at)).orderBy(asc(personalArea.sort_order), asc(personalArea.name)),
      db.select().from(personalCycle).where(gte(personalCycle.ends_on, today)).orderBy(desc(personalCycle.number)),
      db.select().from(personalGoal).orderBy(asc(personalGoal.sort_order), asc(personalGoal.createdAt)),
      db
        .select()
        .from(personalPractice)
        .where(isNull(personalPractice.retired_at))
        .orderBy(asc(personalPractice.sort_order), asc(personalPractice.name)),
      db.select().from(personalAntiGoal).orderBy(asc(personalAntiGoal.sort_order), asc(personalAntiGoal.createdAt)),
      db
        .select()
        .from(personalTask)
        .where(and(eq(personalTask.plan_week, week), isNotNull(personalTask.goal_id)))
        .orderBy(asc(personalTask.pool_order), asc(personalTask.createdAt)),
      scorecardStrip(week),
      readSetting("execution_benchmark", EXECUTION_BENCHMARK),
    ]);

    const [progress, entries] = await Promise.all([
      goals.length === 0
        ? Promise.resolve([])
        : db
            .select()
            .from(personalGoalProgress)
            .where(
              inArray(
                personalGoalProgress.goal_id,
                goals.map((goal) => goal.id),
              ),
            )
            .orderBy(desc(personalGoalProgress.recorded_on), desc(personalGoalProgress.createdAt)),
      practices.length === 0
        ? Promise.resolve([])
        : db
            .select({ practice_id: personalPracticeEntry.practice_id, done: count() })
            .from(personalPracticeEntry)
            .where(
              and(
                inArray(
                  personalPracticeEntry.practice_id,
                  practices.map((practice) => practice.id),
                ),
                eq(personalPracticeEntry.status, "done"),
                gte(personalPracticeEntry.occurred_on, range.from),
                lte(personalPracticeEntry.occurred_on, range.to),
              ),
            )
            .groupBy(personalPracticeEntry.practice_id),
    ]);

    const latest_progress = new Map<string, (typeof progress)[number]>();
    for (const row of progress) {
      if (!latest_progress.has(row.goal_id)) {
        latest_progress.set(row.goal_id, row);
      }
    }

    const done_by_practice = new Map(entries.map((entry) => [entry.practice_id, Number(entry.done)]));
    const current_cycle = new Map<string, CycleRow>();
    for (const cycle of cycles) {
      if (!current_cycle.has(cycle.area_id)) {
        current_cycle.set(cycle.area_id, cycle);
      }
    }

    return {
      week,
      week_range: range,
      benchmark,
      areas: areas.map((area) => {
        const cycle = current_cycle.get(area.id);

        return {
          id: area.id,
          name: area.name,
          slug: area.slug,
          mode: area.mode,
          cycle: cycle === undefined ? null : mapCycle(cycle, today),
          goals: goals
            .filter((goal) => goal.area_id === area.id)
            .map((goal) => {
              const latest = latest_progress.get(goal.id);

              return {
                ...mapGoal(goal),
                latest_value: latest === undefined ? null : Number(latest.value),
                latest_recorded_on: latest?.recorded_on ?? null,
              };
            }),
          practices: practices
            .filter((practice) => practice.area_id === area.id)
            .map((practice) => ({
              ...mapPractice(practice),
              expected: expectedThisWeek(practice),
              done: done_by_practice.get(practice.id) ?? 0,
            })),
          anti_goals: anti_goals.filter((anti_goal) => anti_goal.area_id === area.id).map(mapAntiGoal),
        };
      }),
      tactics: tactic_rows.map((row) => ({
        ...mapTask(row),
        completed: row.completed_at !== null && row.completed_at >= instants.from && row.completed_at < instants.to,
      })),
      scorecard: strip,
    };
  }),

  createGoal: authed
    .input(
      z.object({
        area_id: z.string().min(1),
        title: short_text_schema,
        kind: goal_kind_schema,
        metric: short_text_schema,
        direction: direction_schema.default("up"),
        baseline: amount_schema.nullable().default(null),
        target: amount_schema.nullable().default(null),
        unit: short_text_schema.nullable().default(null),
        starts_on: day_schema.nullable().default(null),
        due_on: day_schema.nullable().default(null),
        cycle_id: z.string().min(1).nullable().default(null),
        sort_order: sort_order_schema.default(0),
      }),
    )
    .handler(async ({ input }) => {
      const id = crypto.randomUUID();
      const slug = await freeSlug(slugify(input.title), personalGoal, personalGoal.slug);

      await db.insert(personalGoal).values({
        id,
        ...input,
        slug,
        baseline: toDecimal(input.baseline),
        target: toDecimal(input.target),
        updatedAt: new Date(),
      });

      return { id, slug };
    }),

  // Partial: an absent key is untouched, a null clears the column. The slug is only ever changed on
  // purpose, since a brain file points at it; a title edit leaves it alone.
  updateGoal: authed
    .input(
      id_schema.extend({
        area_id: z.string().min(1).optional(),
        slug: slug_schema.optional(),
        title: short_text_schema.optional(),
        kind: goal_kind_schema.optional(),
        metric: short_text_schema.optional(),
        direction: direction_schema.optional(),
        baseline: amount_schema.nullable().optional(),
        target: amount_schema.nullable().optional(),
        unit: short_text_schema.nullable().optional(),
        starts_on: day_schema.nullable().optional(),
        due_on: day_schema.nullable().optional(),
        cycle_id: z.string().min(1).nullable().optional(),
        sort_order: sort_order_schema.optional(),
      }),
    )
    .handler(async ({ input }) => {
      const { id, ...fields } = input;

      await db
        .update(personalGoal)
        .set({ ...fields, baseline: toDecimal(fields.baseline), target: toDecimal(fields.target), updatedAt: new Date() })
        .where(eq(personalGoal.id, id));

      return { id };
    }),

  setGoalStatus: authed.input(id_schema.extend({ status: goal_status_schema })).handler(async ({ input }) => {
    await db.update(personalGoal).set({ status: input.status, updatedAt: new Date() }).where(eq(personalGoal.id, input.id));

    return { id: input.id, status: input.status };
  }),

  recordProgress: authed
    .input(z.object({ goal_id: z.string().min(1), recorded_on: day_schema, value: amount_schema, note: note_schema.default(null) }))
    .handler(async ({ input }) => {
      const id = crypto.randomUUID();

      await db.insert(personalGoalProgress).values({
        id,
        goal_id: input.goal_id,
        recorded_on: input.recorded_on,
        value: input.value.toFixed(2),
        note: input.note,
      });

      return { id };
    }),

  startCycle: authed
    .input(z.object({ area_id: z.string().min(1), starts_on: day_schema, ends_on: day_schema.optional(), note: note_schema.default(null) }))
    .handler(async ({ input }) => {
      const running = await runningCycleOf(input.area_id, operatorDateOf());

      if (running !== undefined) {
        throw new ORPCError("BAD_REQUEST", { message: `cycle ${running.number} is still running until ${running.ends_on}` });
      }

      const [previous] = await db.select({ total: count() }).from(personalCycle).where(eq(personalCycle.area_id, input.area_id));
      const id = crypto.randomUUID();
      const number = Number(previous?.total ?? 0) + 1;
      const ends_on = input.ends_on ?? addDays(input.starts_on, CYCLE_LENGTH_DAYS);

      await db.insert(personalCycle).values({
        id,
        area_id: input.area_id,
        number,
        starts_on: input.starts_on,
        ends_on,
        note: input.note,
        updatedAt: new Date(),
      });

      return { id, number, starts_on: input.starts_on, ends_on };
    }),

  // One suspension window at a time: suspending again after a resume starts a fresh window and the
  // earlier one is not kept. Spec 4.4 needs paused-versus-missed, which the open window answers.
  suspendCycle: authed.input(id_schema).handler(async ({ input }) => {
    const cycle = await cycleOrThrow(input.id);

    if (cycle.suspended_at !== null && cycle.resumed_at === null) {
      throw new ORPCError("BAD_REQUEST", { message: "cycle is already suspended" });
    }

    const now = new Date();

    await db.update(personalCycle).set({ suspended_at: now, resumed_at: null, updatedAt: now }).where(eq(personalCycle.id, cycle.id));

    return { id: cycle.id, suspended_at: now.toISOString() };
  }),

  resumeCycle: authed.input(id_schema).handler(async ({ input }) => {
    const cycle = await cycleOrThrow(input.id);

    if (cycle.suspended_at === null || cycle.resumed_at !== null) {
      throw new ORPCError("BAD_REQUEST", { message: "cycle is not suspended" });
    }

    const now = new Date();

    await db.update(personalCycle).set({ resumed_at: now, updatedAt: now }).where(eq(personalCycle.id, cycle.id));

    return { id: cycle.id, resumed_at: now.toISOString() };
  }),

  createPractice: authed
    .input(
      z.object({
        area_id: z.string().min(1),
        goal_id: z.string().min(1).nullable().default(null),
        name: short_text_schema,
        freq_num: frequency_schema,
        freq_den: frequency_schema.default(7),
        trigger: trigger_schema.nullable().default(null),
        sort_order: sort_order_schema.default(0),
      }),
    )
    .handler(async ({ input }) => {
      const id = crypto.randomUUID();

      await db.insert(personalPractice).values({ id, ...input, updatedAt: new Date() });

      return { id };
    }),

  updatePractice: authed
    .input(
      id_schema.extend({
        area_id: z.string().min(1).optional(),
        goal_id: z.string().min(1).nullable().optional(),
        name: short_text_schema.optional(),
        freq_num: frequency_schema.optional(),
        freq_den: frequency_schema.optional(),
        trigger: trigger_schema.nullable().optional(),
        sort_order: sort_order_schema.optional(),
      }),
    )
    .handler(async ({ input }) => {
      const { id, ...fields } = input;

      await db
        .update(personalPractice)
        .set({ ...fields, updatedAt: new Date() })
        .where(eq(personalPractice.id, id));

      return { id };
    }),

  // Retired, never deleted: the entries are the history a later stage reads for automaticity.
  retirePractice: authed.input(id_schema).handler(async ({ input }) => {
    const now = new Date();

    await db.update(personalPractice).set({ retired_at: now, updatedAt: now }).where(eq(personalPractice.id, input.id));

    return { id: input.id, retired_at: now.toISOString() };
  }),

  logPractice: authed
    .input(
      z.object({ practice_id: z.string().min(1), occurred_on: day_schema, status: entry_status_schema, note: note_schema.default(null) }),
    )
    .handler(async ({ input }) => {
      const id = crypto.randomUUID();

      await db.insert(personalPracticeEntry).values({ id, ...input });

      return { id };
    }),

  createAntiGoal: authed
    .input(
      z.object({
        area_id: z.string().min(1),
        cycle_id: z.string().min(1).nullable().default(null),
        constraint_text: short_text_schema,
        sort_order: sort_order_schema.default(0),
      }),
    )
    .handler(async ({ input }) => {
      const id = crypto.randomUUID();

      await db.insert(personalAntiGoal).values({ id, ...input, updatedAt: new Date() });

      return { id };
    }),

  updateAntiGoal: authed
    .input(
      id_schema.extend({
        area_id: z.string().min(1).optional(),
        cycle_id: z.string().min(1).nullable().optional(),
        constraint_text: short_text_schema.optional(),
        status: anti_goal_status_schema.optional(),
        sort_order: sort_order_schema.optional(),
      }),
    )
    .handler(async ({ input }) => {
      const { id, ...fields } = input;

      await db
        .update(personalAntiGoal)
        .set({ ...fields, updatedAt: new Date() })
        .where(eq(personalAntiGoal.id, id));

      return { id };
    }),

  // The filing notice: only what is still holding, since a breached or retired constraint is history.
  listAntiGoalsForArea: authed.input(z.object({ area_id: z.string().min(1) })).handler(async ({ input }) => {
    const rows = await db
      .select()
      .from(personalAntiGoal)
      .where(and(eq(personalAntiGoal.area_id, input.area_id), eq(personalAntiGoal.status, "holding")))
      .orderBy(asc(personalAntiGoal.sort_order), asc(personalAntiGoal.createdAt));

    return rows.map(mapAntiGoal);
  }),

  freezeExecution: authed.input(z.object({ plan_week: week_schema })).handler(async ({ input }) => {
    const score = await freezeExecutionCounts(input.plan_week);

    if (score === null) {
      throw new ORPCError("NOT_FOUND", { message: "no review for that week" });
    }

    return { plan_week: input.plan_week, ...score };
  }),
};
