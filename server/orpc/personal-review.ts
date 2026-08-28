import { db } from "@server/db/drizzle";
import { personalReview, personalTask, personalTaskDeferral } from "@server/db/schema";
import { DAY_MS, isoWeekOf, operatorDayStart } from "@server/operator-day";
import { DEFERRAL_LIMIT, SOMEDAY_AGE_DAYS } from "@server/personal-thresholds";
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, lte, or } from "drizzle-orm";
import { z } from "zod";
import { authed } from "./base";

const ACTIVE_STATES = ["inbox", "open"] as const;

// Exactly four exits and no fifth. Auto-filing to someday without a decision would BE the silent
// escape the three-strike block exists to prevent — a nicer folder is still a backlog.
const disposition_exit_schema = z.enum(["do_today", "schedule", "someday", "cancel"]);

const dispose_schema = z
  .object({
    id: z.string().min(1),
    exit: disposition_exit_schema,
    when_date: z.string().datetime().optional(),
    reason: z.string().min(1).max(512).optional(),
  })
  // The reason is the whole point of this exit: it is what lets a later read tell scheduling from
  // avoidance without asking. Without it "schedule" is just a deferral wearing a better name.
  .refine((input) => input.exit !== "schedule" || (input.when_date !== undefined && input.reason !== undefined), {
    message: "schedule requires both a when_date and a reason",
  });

// Ageing is silent by design (§16 rule 4): items move to someday searchable and revivable, never as
// a badge and never as a notification. It runs when the review opens rather than on the daily
// surface, so nothing ever disappears out from under a day in progress.
const ageOutStale = async (now: Date): Promise<number> => {
  const cutoff = new Date(now.getTime() - SOMEDAY_AGE_DAYS * DAY_MS);

  const stale = await db
    .select({ id: personalTask.id })
    .from(personalTask)
    .where(and(inArray(personalTask.state, [...ACTIVE_STATES]), isNull(personalTask.when_date), lt(personalTask.updatedAt, cutoff)));

  if (stale.length === 0) {
    return 0;
  }

  await db
    .update(personalTask)
    .set({ state: "someday", updatedAt: now })
    .where(
      inArray(
        personalTask.id,
        stale.map((row) => row.id),
      ),
    );

  return stale.length;
};

export const personalReviewProcedures = {
  // Idempotent, and safe to call on every load of the screen. Opening a review is not an event —
  // it is the week acquiring a place to record what was decided.
  openCurrent: authed.handler(async () => {
    const now = new Date();
    const plan_week = isoWeekOf(now);

    const [existing] = await db.select().from(personalReview).where(eq(personalReview.plan_week, plan_week)).limit(1);

    if (existing === undefined) {
      await db.insert(personalReview).values({ id: crypto.randomUUID(), plan_week, opened_at: now, updatedAt: now });
      await ageOutStale(now);
    }

    const [row] = await db.select().from(personalReview).where(eq(personalReview.plan_week, plan_week)).limit(1);

    const [previous] = await db
      .select({ completed_at: personalReview.completed_at })
      .from(personalReview)
      .where(eq(personalReview.plan_week, isoWeekOf(new Date(now.getTime() - 7 * DAY_MS))))
      .limit(1);

    return {
      plan_week,
      opened_at: row?.opened_at.toISOString() ?? now.toISOString(),
      completed_at: row?.completed_at?.toISOString() ?? null,
      someday_swept_at: row?.someday_swept_at?.toISOString() ?? null,
      note: row?.note ?? null,
      // One line of secondary text and nothing else — no link, no retrospective review, nothing
      // accumulating. §16 rule 5 forbids a streak; it does not forbid a fact.
      previous_week: isoWeekOf(new Date(now.getTime() - 7 * DAY_MS)),
      previous_week_unreviewed: previous === undefined || previous.completed_at === null,
    };
  }),

  // A task owes a disposition when its last movement was an unexplained push-out. Once a reason has
  // been given the debt is settled, even though deferral_count keeps its history — the count means
  // "how many times did I promise this and not do it", and that never stops being true.
  listDispositionsRequired: authed.handler(async () => {
    const candidates = await db
      .select()
      .from(personalTask)
      .where(and(inArray(personalTask.state, [...ACTIVE_STATES]), gte(personalTask.deferral_count, DEFERRAL_LIMIT)))
      .orderBy(desc(personalTask.deferral_count), asc(personalTask.createdAt));

    if (candidates.length === 0) {
      return [];
    }

    const history = await db
      .select()
      .from(personalTaskDeferral)
      .where(
        inArray(
          personalTaskDeferral.task_id,
          candidates.map((row) => row.id),
        ),
      )
      .orderBy(desc(personalTaskDeferral.createdAt));

    const latest = new Map<string, (typeof history)[number]>();
    for (const row of history) {
      if (!latest.has(row.task_id)) {
        latest.set(row.task_id, row);
      }
    }

    return candidates
      .filter((task) => (latest.get(task.id)?.reason ?? null) === null)
      .map((task) => ({
        id: task.id,
        title: task.title,
        deferral_count: task.deferral_count,
        when_date: task.when_date?.toISOString() ?? null,
      }));
  }),

  dispose: authed.input(dispose_schema).handler(async ({ input }) => {
    const now = new Date();
    const [task] = await db.select().from(personalTask).where(eq(personalTask.id, input.id)).limit(1);

    if (task === undefined) {
      return { id: input.id, exit: input.exit, applied: false };
    }

    if (input.exit === "do_today") {
      await db
        .update(personalTask)
        .set({ when_date: operatorDayStart(now), plan_week: null, state: "open", updatedAt: now })
        .where(eq(personalTask.id, task.id));
    }

    // The only exit that records history, because it is the only one that defers. Writing a
    // cancellation into a table named PersonalTaskDeferral would be dishonest data, and the
    // discriminator this table exists for only ever reads deferrals.
    if (input.exit === "schedule" && input.when_date !== undefined) {
      const to_date = new Date(input.when_date);

      await db.insert(personalTaskDeferral).values({
        id: crypto.randomUUID(),
        task_id: task.id,
        from_date: task.when_date,
        to_date,
        reason: input.reason ?? null,
      });
      // deferral_count is deliberately not incremented. The block already forced the decision, and
      // a reasoned reschedule is the sanctioned way out of it — charging for it twice would make
      // the honest exit the expensive one.
      await db
        .update(personalTask)
        .set({ when_date: to_date, plan_week: null, state: "open", updatedAt: now })
        .where(eq(personalTask.id, task.id));
    }

    if (input.exit === "someday" || input.exit === "cancel") {
      const state = input.exit === "someday" ? "someday" : "cancelled";

      await db
        .update(personalTask)
        .set({
          state,
          when_date: null,
          plan_week: null,
          cancelled_at: input.exit === "cancel" ? now : null,
          updatedAt: now,
        })
        .where(eq(personalTask.id, task.id));
    }

    return { id: task.id, exit: input.exit, applied: true };
  }),

  listSomedaySweep: authed.handler(async () => {
    const rows = await db.select().from(personalTask).where(eq(personalTask.state, "someday")).orderBy(asc(personalTask.updatedAt));

    // The most recent sweep across every week, not this week's — this week's is null until the
    // sweep happens, and the useful fact is how long the pile has been sitting.
    const [last_swept] = await db
      .select({ someday_swept_at: personalReview.someday_swept_at })
      .from(personalReview)
      .where(isNotNull(personalReview.someday_swept_at))
      .orderBy(desc(personalReview.someday_swept_at))
      .limit(1);

    return {
      items: rows.map((row) => ({ id: row.id, title: row.title, updated_at: row.updatedAt.toISOString() })),
      last_swept_at: last_swept?.someday_swept_at?.toISOString() ?? null,
    };
  }),

  sweepSomeday: authed.handler(async () => {
    const now = new Date();

    await db
      .update(personalReview)
      .set({ someday_swept_at: now, updatedAt: now })
      .where(eq(personalReview.plan_week, isoWeekOf(now)));

    return { someday_swept_at: now.toISOString() };
  }),

  complete: authed.input(z.object({ note: z.string().max(4000).optional() })).handler(async ({ input }) => {
    const now = new Date();

    await db
      .update(personalReview)
      .set({ completed_at: now, note: input.note ?? null, updatedAt: now })
      .where(eq(personalReview.plan_week, isoWeekOf(now)));

    return { completed_at: now.toISOString() };
  }),

  // Cancelling is only a real exit if there is somewhere to land. Without this, "cancel to logbook"
  // is indistinguishable from deleting, which makes the honest choice the frightening one.
  listLogbook: authed
    .input(z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }))
    .handler(async ({ input }) => {
      const from = new Date(`${input.from}T00:00:00.000Z`);
      const to = new Date(new Date(`${input.to}T00:00:00.000Z`).getTime() + DAY_MS);

      const rows = await db
        .select()
        .from(personalTask)
        .where(
          or(
            and(gte(personalTask.completed_at, from), lte(personalTask.completed_at, to)),
            and(gte(personalTask.cancelled_at, from), lte(personalTask.cancelled_at, to)),
          ),
        )
        .orderBy(desc(personalTask.updatedAt));

      return rows.map((row) => ({
        id: row.id,
        title: row.title,
        state: row.state,
        deferral_count: row.deferral_count,
        settled_at: (row.completed_at ?? row.cancelled_at)?.toISOString() ?? null,
      }));
    }),
};
