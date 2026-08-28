import { ORPCError } from "@orpc/server";
import { db } from "@server/db/drizzle";
import { personalArea, personalProject, personalTask } from "@server/db/schema";
import { DAY_MS, isoWeekOf, operatorDayStart } from "@server/operator-day";
import { DEFERRAL_LIMIT } from "@server/personal-thresholds";
import { and, asc, count, desc, eq, gte, inArray, isNotNull, isNull, lt, or } from "drizzle-orm";
import { z } from "zod";
import { authed } from "./base";

// The states a task is still live in. `someday` is live but deliberately out of sight, and it is
// therefore excluded here and surfaced only through listHidden.
const ACTIVE_STATES = ["inbox", "open"] as const;

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

// A steady weekly budget would fire a warning most weeks and be dismissed most weeks, because the work
// genuinely arrives in bursts. The mode is what lets a zero-hour fortnight on a dormant area read as
// normal rather than as a deficit. Validated here rather than as a DB enum so adding a fifth mode is a
// code change, not a migration.
const area_mode_schema = z.enum(["dormant", "maintenance", "sprint", "always_on"]);

const id_schema = z.object({ id: z.string().min(1) });

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

  // A captured thought matches none of the lists above on purpose: it carries no date and belongs to no
  // week yet, which is exactly the combination each of them excludes. Without this it would be written and
  // never seen again. The inbox is a holding pen to be emptied, never a working list — nothing in it is
  // scheduled, and everything in it is one action away from leaving.
  listInbox: authed.handler(async () => {
    const rows = await db
      .select()
      .from(personalTask)
      .where(and(eq(personalTask.state, "inbox"), isNull(personalTask.when_date), isNull(personalTask.plan_week)))
      .orderBy(desc(personalTask.createdAt));

    return rows.map(mapTask);
  }),

  // The other half of triage. pullToToday is a promise about today; this one only says "this week", which
  // is why it sets plan_week and leaves when_date alone.
  sendToPool: authed.input(id_schema).handler(async ({ input }) => {
    const plan_week = isoWeekOf();

    await db
      .update(personalTask)
      .set({ plan_week, when_date: null, state: "open", updatedAt: new Date() })
      .where(eq(personalTask.id, input.id));

    return { id: input.id, plan_week };
  }),

  capture: authed.input(capture_input_schema).handler(async ({ input }) => insertCapturedTask(input.title)),

  pullToToday: authed.input(id_schema).handler(async ({ input }) => {
    const when_date = operatorDayStart();
    const now = new Date();

    // The commitment, and the only thing that counts as one. Leaving the pool is what makes it real,
    // so plan_week goes with it.
    await db.update(personalTask).set({ when_date, plan_week: null, state: "open", updatedAt: now }).where(eq(personalTask.id, input.id));

    return { id: input.id, when_date: when_date.toISOString() };
  }),

  pushOut: authed.input(id_schema).handler(async ({ input }) => {
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

  setState: authed.input(id_schema.extend({ state: z.enum(["open", "someday", "completed", "cancelled"]) })).handler(async ({ input }) => {
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

  // One query per table rather than a join, then assembled here: the tree is five areas deep at most, and
  // a join would repeat every area row once per project only to be unpicked again on this side.
  listAreas: authed.handler(async () => {
    const [areas, projects, open_rows] = await Promise.all([
      db.select().from(personalArea).where(isNull(personalArea.archived_at)).orderBy(asc(personalArea.sort_order), asc(personalArea.name)),
      db
        .select()
        .from(personalProject)
        .where(isNull(personalProject.archived_at))
        .orderBy(asc(personalProject.sort_order), asc(personalProject.name)),
      db
        .select({ area_id: personalTask.area_id, project_id: personalTask.project_id, open: count() })
        .from(personalTask)
        .where(inArray(personalTask.state, [...ACTIVE_STATES]))
        .groupBy(personalTask.area_id, personalTask.project_id),
    ]);

    const area_open = new Map<string, number>();
    const project_open = new Map<string, number>();

    for (const row of open_rows) {
      if (row.area_id !== null) {
        area_open.set(row.area_id, (area_open.get(row.area_id) ?? 0) + row.open);
      }
      if (row.project_id !== null) {
        project_open.set(row.project_id, (project_open.get(row.project_id) ?? 0) + row.open);
      }
    }

    return areas.map((area) => ({
      id: area.id,
      name: area.name,
      mode: area.mode,
      soft_floor_hours: area.soft_floor_hours,
      sort_order: area.sort_order,
      // Counts every open task filed to the area, including the ones sitting directly under it with no
      // project — so an area total is never smaller than the projects listed beneath it.
      open_count: area_open.get(area.id) ?? 0,
      projects: projects
        .filter((project) => project.area_id === area.id)
        .map((project) => ({
          id: project.id,
          name: project.name,
          waka_project: project.waka_project,
          sort_order: project.sort_order,
          open_count: project_open.get(project.id) ?? 0,
        })),
    }));
  }),

  createArea: authed
    .input(
      z.object({ name: z.string().min(1).max(191), mode: area_mode_schema.default("always_on"), sort_order: z.number().int().default(0) }),
    )
    .handler(async ({ input }) => {
      const id = crypto.randomUUID();

      await db.insert(personalArea).values({ id, name: input.name, mode: input.mode, sort_order: input.sort_order, updatedAt: new Date() });

      return { id };
    }),

  updateArea: authed
    .input(
      id_schema.extend({
        name: z.string().min(1).max(191).optional(),
        mode: area_mode_schema.optional(),
        soft_floor_hours: z.number().int().min(0).max(168).nullable().optional(),
      }),
    )
    .handler(async ({ input }) => {
      const { id, ...fields } = input;

      await db
        .update(personalArea)
        .set({ ...fields, updatedAt: new Date() })
        .where(eq(personalArea.id, id));

      return { id };
    }),

  // Archived, never deleted. An area that stops mattering still owns the history of everything filed to
  // it, and the allocation ledger reads that history backwards.
  archiveArea: authed.input(id_schema).handler(async ({ input }) => {
    const now = new Date();

    await db.update(personalArea).set({ archived_at: now, updatedAt: now }).where(eq(personalArea.id, input.id));

    return { id: input.id };
  }),

  createProject: authed
    .input(
      z.object({
        area_id: z.string().min(1),
        name: z.string().min(1).max(191),
        waka_project: z.string().min(1).max(191).nullable().default(null),
      }),
    )
    .handler(async ({ input }) => {
      const id = crypto.randomUUID();

      await db
        .insert(personalProject)
        .values({ id, area_id: input.area_id, name: input.name, waka_project: input.waka_project, updatedAt: new Date() });

      return { id };
    }),

  updateProject: authed
    .input(
      id_schema.extend({
        area_id: z.string().min(1).optional(),
        name: z.string().min(1).max(191).optional(),
        waka_project: z.string().min(1).max(191).nullable().optional(),
      }),
    )
    .handler(async ({ input }) => {
      const { id, ...fields } = input;

      await db
        .update(personalProject)
        .set({ ...fields, updatedAt: new Date() })
        .where(eq(personalProject.id, id));

      return { id };
    }),

  archiveProject: authed.input(id_schema).handler(async ({ input }) => {
    const now = new Date();

    await db.update(personalProject).set({ archived_at: now, updatedAt: now }).where(eq(personalProject.id, input.id));

    return { id: input.id };
  }),
};
