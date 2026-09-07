import { ORPCError } from "@orpc/server";
import { db } from "@server/db/drizzle";
import {
  activityBucket,
  personalArea,
  personalProject,
  personalProjectWakaName,
  personalTask,
  personalTaskDeferral,
} from "@server/db/schema";
import { DAY_MS, isoWeekOf, operatorDayStart, operatorDayStartOf, operatorWeekRange } from "@server/operator-day";
import { readSetting } from "@server/personal-settings";
import { resolveStreams } from "@server/personal-streams";
import { DEFERRAL_LIMIT } from "@server/personal-thresholds";
import { normaliseProjectName, UNKNOWN_PROJECT } from "@server/wakatime/bucket-heartbeats";
import { and, asc, count, desc, eq, gte, inArray, isNotNull, isNull, like, lt, ne, or, sql } from "drizzle-orm";
import { slugify } from "utils/slugify";
import { z } from "zod";
import { authed } from "./base";

// The states a task is still live in. `someday` is live but deliberately out of sight: excluded here, and
// reached only through the hidden panel, the Someday screen and the palette search.
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
// genuinely arrives in bursts. The mode is what lets a zero-hour fortnight on a dormant stream read as
// normal rather than as a deficit. Validated here rather than as a DB enum so adding a fifth mode is a
// code change, not a migration. Shared by areas and projects; a project's null mode inherits its area's.
const mode_schema = z.enum(["dormant", "maintenance", "sprint", "always_on"]);

const soft_floor_hours_schema = z.number().int().min(0).max(168).nullable();

// The stable pointer brain files use to name an area. Derived from the name once on create and only ever
// changed on purpose after that: renaming an area must not move every pointer to it.
const slug_schema = z
  .string()
  .min(1)
  .max(191)
  .regex(/^[a-z0-9-]+$/);

// Unmapped names older than this are noise from a machine long since wiped, not a stream to assign.
const UNMAPPED_LOOKBACK_DAYS = 90;

const deleteWakaNameRows = async (normalised_name: string): Promise<void> => {
  const rows = await db
    .select({ id: personalProjectWakaName.id, waka_name: personalProjectWakaName.waka_name })
    .from(personalProjectWakaName);
  const ids = rows.filter((row) => normaliseProjectName(row.waka_name) === normalised_name).map((row) => row.id);

  if (ids.length > 0) {
    await db.delete(personalProjectWakaName).where(inArray(personalProjectWakaName.id, ids));
  }
};

// The unique index covers archived areas too, so the collision check does not filter on archived_at. A
// name with nothing slug-worthy in it gets no slug rather than an empty one the index would reject twice.
const freeSlug = async (base: string): Promise<string | null> => {
  if (base === "") {
    return null;
  }

  const rows = await db
    .select({ slug: personalArea.slug })
    .from(personalArea)
    .where(like(personalArea.slug, `${base}%`));
  const taken = new Set(rows.map((row) => row.slug));

  if (!taken.has(base)) {
    return base;
  }

  let suffix = 2;

  while (taken.has(`${base}-${suffix}`)) {
    suffix += 1;
  }

  return `${base}-${suffix}`;
};

const id_schema = z.object({ id: z.string().min(1) });

const settable_state_schema = z.enum(["open", "someday", "completed", "cancelled"]);

// The one place a state change decides its timestamps, shared by setState and updateTask: completed_at
// and cancelled_at are set on the way in and cleared on the way out, so a revived task carries neither.
const stateColumns = (state: z.infer<typeof settable_state_schema>, now: Date) => ({
  state,
  completed_at: state === "completed" ? now : null,
  cancelled_at: state === "cancelled" ? now : null,
});

// A calendar day from the editor, YYYY-MM-DD. Converted to the operator's midnight on this side so a
// `when` of today lands exactly where pullToToday puts it and the screens agree about which day it is.
// The round trip through Date is the calendar check: "2026-13-45" matches the pattern and comes back as
// something else.
const day_schema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((day) => new Date(`${day}T00:00:00.000Z`).toISOString().slice(0, 10) === day, { message: "not a calendar day" });

const dayToInstant = (day: string | null | undefined): Date | null | undefined => {
  if (day === undefined || day === null) {
    return day;
  }

  return operatorDayStartOf(day);
};

export const capture_input_schema = z.object({ title: z.string().min(1).max(512) });

// One past the highest position in the same set listPool orders, so an appended task lands after every
// task already there. mysql2 hands MAX back as a string; Number() at the boundary, as everywhere else.
const nextPoolOrder = async (plan_week: string): Promise<number> => {
  const [row] = await db
    .select({ highest: sql<number | string | null>`MAX(${personalTask.pool_order})` })
    .from(personalTask)
    .where(and(eq(personalTask.plan_week, plan_week), inArray(personalTask.state, [...ACTIVE_STATES]), isNull(personalTask.when_date)));

  return row?.highest === null || row?.highest === undefined ? 0 : Number(row.highest) + 1;
};

// Shared with src/routes/api/personal-capture.ts, which the iOS Shortcut posts to with a bearer token and
// no session — it cannot reach an `authed` procedure, and capture is the one thing that must work from
// wherever the thought turns up.
export const insertCapturedTask = async (title: string): Promise<{ id: string }> => {
  const id = crypto.randomUUID();

  await db.insert(personalTask).values({ id, title, state: "inbox", updatedAt: new Date() });

  return { id };
};

// The one way back out of someday, shared by revive and the review sweep's reviveToPool. It clears the
// date and the week so the task lands in Anytime (or the pool it is given) and nothing else: notes,
// filing, deadline and the deferral count are history the task keeps. A task revived into a pool joins
// the end of it — the order in that pool was decided on purpose, and a revival should not jump it.
export const reviveSomedayTask = async (id: string, plan_week: string | null): Promise<void> => {
  const [row] = await db.select({ state: personalTask.state }).from(personalTask).where(eq(personalTask.id, id)).limit(1);

  if (!row) {
    throw new ORPCError("NOT_FOUND");
  }

  if (row.state !== "someday") {
    throw new ORPCError("BAD_REQUEST", { message: "only a someday task can be revived" });
  }

  const pool_order = plan_week === null ? 0 : await nextPoolOrder(plan_week);

  await db
    .update(personalTask)
    .set({ state: "open", when_date: null, plan_week, pool_order, updatedAt: new Date() })
    .where(eq(personalTask.id, id));
};

// Searched across every state so a someday item is findable by name, which is the promise the ageing rule
// makes. The order groups live work first and settled work last; LIKE is escaped so a title with a literal
// percent sign is searchable by it.
const SEARCH_STATE_ORDER = ["open", "inbox", "someday", "completed", "cancelled"] as const;

const escapeLike = (query: string): string => query.replace(/[\\%_]/g, (character) => `\\${character}`);

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

    const deferral_limit = await readSetting("deferral_limit", DEFERRAL_LIMIT);

    if (row.deferral_count >= deferral_limit) {
      return { id: row.id, deferral_count: row.deferral_count, blocked: true };
    }

    const deferral_count = row.deferral_count + 1;
    const now = new Date();

    // Recorded with no reason on purpose: an unexplained push-out is exactly what the review later
    // asks a task to account for. A row whose reason is set marks a debt already settled.
    await db
      .insert(personalTaskDeferral)
      .values({ id: crypto.randomUUID(), task_id: row.id, from_date: row.when_date, to_date: null, reason: null });

    await db
      .update(personalTask)
      .set({ deferral_count, when_date: null, plan_week: isoWeekOf(), state: "open", updatedAt: now })
      .where(eq(personalTask.id, row.id));

    return { id: row.id, deferral_count, blocked: false };
  }),

  revive: authed.input(id_schema).handler(async ({ input }) => {
    await reviveSomedayTask(input.id, null);

    return { id: input.id };
  }),

  // Oldest first: the item that has sat longest is the one a sweep should meet first. Age is measured from
  // the last touch rather than from entering someday, which the row does not record.
  listSomeday: authed.handler(async () => {
    const now = Date.now();
    const rows = await db.select().from(personalTask).where(eq(personalTask.state, "someday")).orderBy(asc(personalTask.updatedAt));

    return rows.map((row) => ({ ...mapTask(row), someday_days: Math.floor((now - row.updatedAt.getTime()) / DAY_MS) }));
  }),

  searchTasks: authed.input(z.object({ query: z.string().trim().min(2).max(191) })).handler(async ({ input }) => {
    const pattern = `%${escapeLike(input.query.toLowerCase())}%`;
    const rows = await db
      .select()
      .from(personalTask)
      .where(sql`LOWER(${personalTask.title}) LIKE ${pattern}`)
      .orderBy(
        sql`FIELD(${personalTask.state}, ${sql.join(
          SEARCH_STATE_ORDER.map((state) => sql`${state}`),
          sql`, `,
        )})`,
        desc(personalTask.updatedAt),
      )
      .limit(20);

    return rows.map(mapTask);
  }),

  setState: authed.input(id_schema.extend({ state: settable_state_schema })).handler(async ({ input }) => {
    const now = new Date();

    await db
      .update(personalTask)
      .set({ ...stateColumns(input.state, now), updatedAt: now })
      .where(eq(personalTask.id, input.id));

    return { id: input.id, state: input.state };
  }),

  // The task detail editor's one write. Partial: an absent key is untouched, a null clears the column.
  // Filing does not triage — an inbox task given an area is still in the inbox — but a `when` is the
  // commitment pullToToday makes, so it opens an inbox task. It leaves plan_week alone, since the pool
  // already excludes anything dated.
  updateTask: authed
    .input(
      id_schema.extend({
        title: z.string().min(1).max(512).optional(),
        notes: z.string().max(20_000).nullable().optional(),
        area_id: z.string().min(1).nullable().optional(),
        project_id: z.string().min(1).nullable().optional(),
        when_date: day_schema.nullable().optional(),
        deadline: day_schema.nullable().optional(),
        estimate_minutes: z.number().int().min(0).max(100_000).nullable().optional(),
        focus: z.boolean().optional(),
        state: settable_state_schema.optional(),
      }),
    )
    .handler(async ({ input }) => {
      const [row] = await db.select().from(personalTask).where(eq(personalTask.id, input.id)).limit(1);

      if (!row) {
        throw new ORPCError("NOT_FOUND");
      }

      const { id, state, when_date, deadline, area_id, project_id, ...fields } = input;
      const filing =
        area_id !== undefined || project_id !== undefined
          ? { area_id: area_id === undefined ? row.area_id : area_id, project_id: project_id === undefined ? row.project_id : project_id }
          : null;

      // A project belongs to exactly one area, so the pair is checked as a pair, and only when the pair
      // is what changed — a title edit on a task filed to an archived project must not unfile it. A
      // project named explicitly must sit under the effective area; one the task already had is dropped
      // rather than kept when the area moves out from under it.
      if (filing !== null && filing.project_id !== null) {
        const [project] = await db
          .select({ area_id: personalProject.area_id })
          .from(personalProject)
          .where(eq(personalProject.id, filing.project_id))
          .limit(1);
        const belongs = project !== undefined && project.area_id === filing.area_id;

        if (!belongs && project_id !== undefined) {
          throw new ORPCError("BAD_REQUEST", { message: "project does not belong to the area" });
        }

        if (!belongs) {
          filing.project_id = null;
        }
      }

      const now = new Date();
      const dated_out_of_inbox = state === undefined && row.state === "inbox" && when_date !== undefined && when_date !== null;

      await db
        .update(personalTask)
        .set({
          ...fields,
          ...(filing ?? {}),
          when_date: dayToInstant(when_date),
          deadline: dayToInstant(deadline),
          ...(state === undefined ? {} : stateColumns(state, now)),
          ...(dated_out_of_inbox ? { state: "open" as const } : {}),
          updatedAt: now,
        })
        .where(eq(personalTask.id, id));

      const [updated] = await db.select().from(personalTask).where(eq(personalTask.id, id)).limit(1);

      if (!updated) {
        throw new ORPCError("NOT_FOUND");
      }

      return mapTask(updated);
    }),

  // Everything the detail screen shows in one round trip. Null rather than NOT_FOUND so the loader can
  // answer with the router's own not-found page, as the other dynamic routes do.
  getTask: authed.input(id_schema).handler(async ({ input }) => {
    const [row] = await db.select().from(personalTask).where(eq(personalTask.id, input.id)).limit(1);

    if (!row) {
      return null;
    }

    const [area, project, deferrals, deferral_limit] = await Promise.all([
      row.area_id === null
        ? Promise.resolve([])
        : db.select({ name: personalArea.name }).from(personalArea).where(eq(personalArea.id, row.area_id)).limit(1),
      row.project_id === null
        ? Promise.resolve([])
        : db.select({ name: personalProject.name }).from(personalProject).where(eq(personalProject.id, row.project_id)).limit(1),
      db.select().from(personalTaskDeferral).where(eq(personalTaskDeferral.task_id, row.id)).orderBy(desc(personalTaskDeferral.createdAt)),
      readSetting("deferral_limit", DEFERRAL_LIMIT),
    ]);

    return {
      task: mapTask(row),
      area_name: area[0]?.name ?? null,
      project_name: project[0]?.name ?? null,
      deferral_limit,
      deferrals: deferrals.map((deferral) => ({
        id: deferral.id,
        from_date: deferral.from_date?.toISOString() ?? null,
        to_date: deferral.to_date?.toISOString() ?? null,
        reason: deferral.reason,
        created_at: deferral.createdAt.toISOString(),
      })),
    };
  }),

  // Undated tasks whose deadline falls before the end of the operator's current week, past ones included:
  // a deadline never hides, so one that was missed last week is still owed and still listed. Read-only by
  // design — a deadline schedules nothing, so this never puts a task into Today. Someday is included
  // because a deadline is imposed from outside and does not care what state the task is parked in.
  listDeadlines: authed.handler(async () => {
    const { to } = operatorWeekRange();
    const week_end = new Date(operatorDayStartOf(to).getTime() + DAY_MS);
    const day_start = operatorDayStart();

    const rows = await db
      .select()
      .from(personalTask)
      .where(
        and(inArray(personalTask.state, ["inbox", "open", "someday"]), isNull(personalTask.when_date), lt(personalTask.deadline, week_end)),
      )
      .orderBy(asc(personalTask.deadline), asc(personalTask.createdAt));

    // Today's deadline is due, not past; the row paints due itself.
    return rows.map((row) => ({ ...mapTask(row), is_past: row.deadline !== null && row.deadline < day_start }));
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
    const [areas, projects, open_rows, waka_names] = await Promise.all([
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
      db.select().from(personalProjectWakaName).orderBy(asc(personalProjectWakaName.waka_name)),
    ]);

    const area_open = new Map<string, number>();
    const project_open = new Map<string, number>();
    const names_by_project = new Map<string, string[]>();

    for (const row of waka_names) {
      names_by_project.set(row.project_id, [...(names_by_project.get(row.project_id) ?? []), row.waka_name]);
    }

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
      slug: area.slug,
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
          mode: project.mode,
          soft_floor_hours: project.soft_floor_hours,
          palette_slot: project.palette_slot,
          waka_names: names_by_project.get(project.id) ?? [],
          sort_order: project.sort_order,
          open_count: project_open.get(project.id) ?? 0,
        })),
    }));
  }),

  createArea: authed
    .input(z.object({ name: z.string().min(1).max(191), mode: mode_schema.default("always_on"), sort_order: z.number().int().default(0) }))
    .handler(async ({ input }) => {
      const id = crypto.randomUUID();
      const slug = await freeSlug(slugify(input.name));

      await db
        .insert(personalArea)
        .values({ id, name: input.name, slug, mode: input.mode, sort_order: input.sort_order, updatedAt: new Date() });

      return { id };
    }),

  updateArea: authed
    .input(
      id_schema.extend({
        name: z.string().min(1).max(191).optional(),
        slug: slug_schema.optional(),
        mode: mode_schema.optional(),
        soft_floor_hours: soft_floor_hours_schema.optional(),
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

  createProject: authed.input(z.object({ area_id: z.string().min(1), name: z.string().min(1).max(191) })).handler(async ({ input }) => {
    const id = crypto.randomUUID();

    await db.insert(personalProject).values({ id, area_id: input.area_id, name: input.name, updatedAt: new Date() });

    return { id };
  }),

  // palette_slot is unique among unarchived projects by contract (spec §3), not by index — an archived
  // project keeps its slot in history, which a unique index could not allow. Assigning a slot another live
  // project holds moves it: one slot, one colour, one project, and the select that serves this is a
  // reassignment by nature. `cleared_from` names the project that lost it.
  updateProject: authed
    .input(
      id_schema.extend({
        area_id: z.string().min(1).optional(),
        name: z.string().min(1).max(191).optional(),
        mode: mode_schema.nullable().optional(),
        soft_floor_hours: soft_floor_hours_schema.optional(),
        palette_slot: z.number().int().min(1).max(4).nullable().optional(),
      }),
    )
    .handler(async ({ input }) => {
      const { id, ...fields } = input;
      const now = new Date();
      let cleared_from: string | null = null;

      if (fields.palette_slot !== undefined && fields.palette_slot !== null) {
        const holders = await db
          .select({ id: personalProject.id })
          .from(personalProject)
          .where(
            and(eq(personalProject.palette_slot, fields.palette_slot), isNull(personalProject.archived_at), ne(personalProject.id, id)),
          );

        if (holders.length > 0) {
          const holder_ids = holders.map((holder) => holder.id);

          await db.update(personalProject).set({ palette_slot: null, updatedAt: now }).where(inArray(personalProject.id, holder_ids));
          cleared_from = holder_ids[0] ?? null;
        }
      }

      await db
        .update(personalProject)
        .set({ ...fields, updatedAt: now })
        .where(eq(personalProject.id, id));

      return { id, cleared_from };
    }),

  archiveProject: authed.input(id_schema).handler(async ({ input }) => {
    const now = new Date();

    await db.update(personalProject).set({ archived_at: now, updatedAt: now }).where(eq(personalProject.id, input.id));

    return { id: input.id };
  }),

  // Every name the tracker has reported lately that resolves to no live project. Bucket names are already
  // normalised, so this is the exact set the ledger will render as its own streams — minus the `unknown`
  // bucket, which is where heartbeats with no project at all land and is not a name anyone could assign.
  listUnmappedWakaNames: authed.handler(async () => {
    const since = new Date(operatorDayStart().getTime() - UNMAPPED_LOOKBACK_DAYS * DAY_MS);

    const [rows, { by_waka_name }] = await Promise.all([
      db
        .select({ project: activityBucket.project, seconds: sql<number>`SUM(${activityBucket.seconds})` })
        .from(activityBucket)
        .where(gte(activityBucket.bucket_start, since))
        .groupBy(activityBucket.project),
      resolveStreams(),
    ]);

    return (
      rows
        .filter((row) => row.project !== UNKNOWN_PROJECT && !by_waka_name.has(row.project))
        // mysql2 returns SUM as a string; Number() at the mapping boundary, as everywhere else.
        .map((row) => ({ waka_name: row.project, total_seconds: Number(row.seconds) }))
        .sort((left, right) => right.total_seconds - left.total_seconds)
    );
  }),

  // Stored normalised so the ledger's lookup is an equality. Rows the migration copied from waka_project
  // are verbatim, so a match is by normalised form rather than by the column, and assigning a name
  // another project holds moves it: the select this serves is a reassignment.
  assignWakaName: authed
    .input(z.object({ project_id: z.string().min(1), waka_name: z.string().min(1).max(191) }))
    .handler(async ({ input }) => {
      const waka_name = normaliseProjectName(input.waka_name);

      await deleteWakaNameRows(waka_name);
      await db
        .insert(personalProjectWakaName)
        .values({ id: crypto.randomUUID(), project_id: input.project_id, waka_name, updatedAt: new Date() });

      return { project_id: input.project_id, waka_name };
    }),

  unassignWakaName: authed.input(z.object({ waka_name: z.string().min(1).max(191) })).handler(async ({ input }) => {
    const waka_name = normaliseProjectName(input.waka_name);

    await deleteWakaNameRows(waka_name);

    return { waka_name };
  }),
};
