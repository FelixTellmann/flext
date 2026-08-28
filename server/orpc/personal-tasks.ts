import { ORPCError } from "@orpc/server";
import { db } from "@server/db/drizzle";
import { personalTask } from "@server/db/schema";
import { and, asc, eq, gte, inArray, isNotNull, isNull, lt, or } from "drizzle-orm";
import { z } from "zod";
import { authed } from "./base";

// South Africa observes no daylight saving, so a fixed offset is correct year-round and spares us a
// date library. "Today" must be the operator's day, not the container's — the container runs UTC, and
// a UTC day would start at 02:00 local, quietly reclassifying the small hours as yesterday.
const OPERATOR_UTC_OFFSET_MINUTES = 120;
const DAY_MS = 24 * 60 * 60 * 1000;

// The states a task is still live in. `someday` is live but deliberately out of sight, and it is
// therefore excluded here and surfaced only through listHidden.
const ACTIVE_STATES = ["inbox", "open"] as const;

const task_id_schema = z.object({ id: z.string().min(1) });

const operatorDayStart = (at: Date = new Date()): Date => {
  const shifted = new Date(at.getTime() + OPERATOR_UTC_OFFSET_MINUTES * 60_000);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - OPERATOR_UTC_OFFSET_MINUTES * 60_000);
};

const isoWeekOf = (at: Date = new Date()): string => {
  const shifted = new Date(at.getTime() + OPERATOR_UTC_OFFSET_MINUTES * 60_000);
  shifted.setUTCHours(0, 0, 0, 0);
  // ISO 8601 pins a week to the year containing its Thursday, which is why the year cannot simply be
  // read off the date: 2026-12-31 can belong to week 1 of 2027.
  shifted.setUTCDate(shifted.getUTCDate() + 4 - (shifted.getUTCDay() || 7));
  const year = shifted.getUTCFullYear();
  const first_thursday = Date.UTC(year, 0, 1);
  const week = Math.ceil(((shifted.getTime() - first_thursday) / DAY_MS + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
};

type TaskRow = typeof personalTask.$inferSelect;

const mapTask = (row: TaskRow) => ({
  id: row.id,
  area_id: row.area_id,
  project_id: row.project_id,
  title: row.title,
  notes: row.notes,
  state: row.state,
  when_date: row.when_date?.toISOString() ?? null,
  deadline: row.deadline?.toISOString() ?? null,
  plan_week: row.plan_week,
  pool_order: row.pool_order,
  deferral_count: row.deferral_count,
  estimate_minutes: row.estimate_minutes,
  focus: row.focus,
  completed_at: row.completed_at?.toISOString() ?? null,
  cancelled_at: row.cancelled_at?.toISOString() ?? null,
  created_at: row.createdAt.toISOString(),
});

// Three strikes and the task stops moving. It owes a disposition — drop it, shrink it, or schedule it
// for real — and the system refuses to let it bounce a fourth time.
const DEFERRAL_LIMIT = 3;

export const capture_input_schema = z.object({ title: z.string().min(1).max(512) });

// Shared with src/routes/api/personal-capture.ts, which the iOS Shortcut posts to with a bearer token and
// no session — it cannot reach an `authed` procedure, and capture is the one thing that must work from
// wherever the thought turns up.
export const insertCapturedTask = async (title: string): Promise<{ id: string }> => {
  const id = crypto.randomUUID();

  await db.insert(personalTask).values({ id, title, state: "inbox", updatedAt: new Date() });

  return { id };
};

export const personalTaskProcedures = {
  listToday: authed.handler(async () => {
    const day_start = operatorDayStart();
    const day_end = new Date(day_start.getTime() + DAY_MS);

    const rows = await db
      .select()
      .from(personalTask)
      .where(and(inArray(personalTask.state, [...ACTIVE_STATES]), isNotNull(personalTask.when_date), lt(personalTask.when_date, day_end)))
      .orderBy(asc(personalTask.when_date), asc(personalTask.pool_order));

    const hidden = await db
      .select({ id: personalTask.id })
      .from(personalTask)
      .where(
        or(eq(personalTask.state, "someday"), and(inArray(personalTask.state, [...ACTIVE_STATES]), gte(personalTask.when_date, day_end))),
      );

    return {
      committed: rows.filter((row) => row.when_date !== null && row.when_date >= day_start).map(mapTask),
      // Carries its original date, untouched. Nothing rolls a missed day forward on the operator's
      // behalf — a task that did not happen should look like a task that did not happen.
      overdue: rows.filter((row) => row.when_date !== null && row.when_date < day_start).map(mapTask),
      hidden_count: hidden.length,
    };
  }),

  listPool: authed.input(z.object({ plan_week: z.string().min(1).max(16) })).handler(async ({ input }) => {
    const rows = await db
      .select()
      .from(personalTask)
      .where(
        and(eq(personalTask.plan_week, input.plan_week), inArray(personalTask.state, [...ACTIVE_STATES]), isNull(personalTask.when_date)),
      )
      .orderBy(asc(personalTask.pool_order), asc(personalTask.createdAt));

    return rows.map(mapTask);
  }),

  listHidden: authed.handler(async () => {
    const day_end = new Date(operatorDayStart().getTime() + DAY_MS);

    const rows = await db
      .select()
      .from(personalTask)
      .where(
        or(eq(personalTask.state, "someday"), and(inArray(personalTask.state, [...ACTIVE_STATES]), gte(personalTask.when_date, day_end))),
      )
      .orderBy(asc(personalTask.when_date), asc(personalTask.createdAt));

    return rows.map(mapTask);
  }),

  capture: authed.input(capture_input_schema).handler(async ({ input }) => insertCapturedTask(input.title)),

  pullToToday: authed.input(task_id_schema).handler(async ({ input }) => {
    const when_date = operatorDayStart();
    const now = new Date();

    // The commitment, and the only thing that counts as one. Leaving the pool is what makes it real,
    // so plan_week goes with it.
    await db.update(personalTask).set({ when_date, plan_week: null, state: "open", updatedAt: now }).where(eq(personalTask.id, input.id));

    return { id: input.id, when_date: when_date.toISOString() };
  }),

  pushOut: authed.input(task_id_schema).handler(async ({ input }) => {
    const [row] = await db.select().from(personalTask).where(eq(personalTask.id, input.id)).limit(1);

    if (!row) {
      throw new ORPCError("NOT_FOUND");
    }

    if (row.deferral_count >= DEFERRAL_LIMIT) {
      return { id: row.id, deferral_count: row.deferral_count, blocked: true };
    }

    const deferral_count = row.deferral_count + 1;

    await db
      .update(personalTask)
      .set({ deferral_count, when_date: null, plan_week: isoWeekOf(), updatedAt: new Date() })
      .where(eq(personalTask.id, row.id));

    return { id: row.id, deferral_count, blocked: false };
  }),

  setState: authed
    .input(task_id_schema.extend({ state: z.enum(["open", "someday", "completed", "cancelled"]) }))
    .handler(async ({ input }) => {
      const now = new Date();

      await db
        .update(personalTask)
        .set({
          state: input.state,
          completed_at: input.state === "completed" ? now : null,
          cancelled_at: input.state === "cancelled" ? now : null,
          updatedAt: now,
        })
        .where(eq(personalTask.id, input.id));

      return { id: input.id, state: input.state };
    }),

  reorderPool: authed.input(z.object({ ids: z.array(z.string().min(1)).max(500) })).handler(async ({ input }) => {
    const now = new Date();

    // Only pool_order moves. Reordering is planning, not avoidance, so deferral_count is untouched —
    // a task can be dragged to the bottom every day without ever counting as deferred.
    for (const [index, id] of input.ids.entries()) {
      await db.update(personalTask).set({ pool_order: index, updatedAt: now }).where(eq(personalTask.id, id));
    }

    return { count: input.ids.length };
  }),

  currentWeek: authed.handler(async () => ({ plan_week: isoWeekOf() })),
};
