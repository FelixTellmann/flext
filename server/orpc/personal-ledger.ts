import { db } from "@server/db/drizzle";
import { activityBucket, personalArea, personalProject } from "@server/db/schema";
import { DAY_MS, OPERATOR_UTC_OFFSET_MINUTES, operatorDayStartOf } from "@server/operator-day";
import { normaliseProjectName } from "@server/wakatime/bucket-heartbeats";
import { and, eq, gte, isNull, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { authed } from "./base";

// Not derived from anything — the spec fixes prime focus as running until roughly 16:00–18:00 and says the
// US overlap falls after it, but never pins a clock window. 16:00–22:00 local covers US Eastern 09:00–15:00
// across both DST halves without claiming the operator works to midnight. It is a number to correct once
// there are actuals to correct it against, not one to defend.
const OVERLAP_START_HOUR = 16;
const OVERLAP_END_HOUR = 22;

const range_schema = z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });

const operatorDayStart = (date: string): Date =>
  new Date(new Date(`${date}T00:00:00.000Z`).getTime() - OPERATOR_UTC_OFFSET_MINUTES * 60_000);

// Buckets are stored as UTC instants, so every date and hour comparison has to be shifted into the
// operator's day first. Grouping on the raw column would file an evening after 22:00 under tomorrow.
const local_date = sql<string>`DATE(${activityBucket.bucket_start} + INTERVAL ${sql.raw(String(OPERATOR_UTC_OFFSET_MINUTES))} MINUTE)`;
const local_hour = sql<number>`HOUR(${activityBucket.bucket_start} + INTERVAL ${sql.raw(String(OPERATOR_UTC_OFFSET_MINUTES))} MINUTE)`;

const eachDate = (from: string, to: string): string[] => {
  const dates: string[] = [];

  for (let at = new Date(`${from}T00:00:00.000Z`); at <= new Date(`${to}T00:00:00.000Z`); at = new Date(at.getTime() + DAY_MS)) {
    dates.push(at.toISOString().slice(0, 10));
  }

  return dates;
};

// A soft floor lives on an Area, while a bucket is keyed by a tracker project name. The two are joined by
// name: an area whose name matches the stream (Listify), or a project carrying waka_project. That is
// enough for the streams that exist today and visibly not a general solution — PersonalProject.waka_project
// is a single column, so a project answering to several upstream names can only record one of them.
const floorsByStream = async (): Promise<Map<string, number>> => {
  const [areas, projects] = await Promise.all([
    db
      .select({ name: personalArea.name, soft_floor_hours: personalArea.soft_floor_hours })
      .from(personalArea)
      .where(isNull(personalArea.archived_at)),
    db
      .select({ soft_floor_hours: personalArea.soft_floor_hours, waka_project: personalProject.waka_project })
      .from(personalProject)
      .innerJoin(personalArea, eq(personalProject.area_id, personalArea.id))
      .where(isNull(personalProject.archived_at)),
  ]);

  const floors = new Map<string, number>();

  for (const area of areas) {
    if (area.soft_floor_hours !== null) {
      floors.set(normaliseProjectName(area.name), area.soft_floor_hours);
    }
  }

  for (const project of projects) {
    if (project.waka_project !== null && project.soft_floor_hours !== null) {
      floors.set(normaliseProjectName(project.waka_project), project.soft_floor_hours);
    }
  }

  return floors;
};

export const personalLedgerProcedures = {
  // Seconds per stream per operator-day. The screen renders both the day strip and the table from this one
  // shape, which is what keeps the two from ever disagreeing about a number.
  listRange: authed.input(range_schema).handler(async ({ input }) => {
    const from = operatorDayStartOf(input.from);
    const to = new Date(operatorDayStartOf(input.to).getTime() + DAY_MS);

    const rows = await db
      .select({ date: local_date, project: activityBucket.project, seconds: sql<number>`SUM(${activityBucket.seconds})` })
      .from(activityBucket)
      .where(and(gte(activityBucket.bucket_start, from), lt(activityBucket.bucket_start, to)))
      .groupBy(local_date, activityBucket.project);

    const dates = eachDate(input.from, input.to);
    const floors = await floorsByStream();
    const by_stream = new Map<string, Map<string, number>>();

    for (const row of rows) {
      // mysql2 returns SUM as a string. Every read of an aggregate in this codebase goes through Number()
      // at the mapping boundary, and `seconds` is no exception.
      const per_day = by_stream.get(row.project) ?? new Map<string, number>();
      per_day.set(String(row.date).slice(0, 10), Number(row.seconds));
      by_stream.set(row.project, per_day);
    }

    const streams = [...by_stream.entries()]
      .map(([project, per_day]) => {
        const total_seconds = [...per_day.values()].reduce((sum, seconds) => sum + seconds, 0);
        const floor_hours = floors.get(project) ?? null;

        return {
          project,
          // null, not zero, for a day with nothing recorded. Absent and zero are different claims and the
          // screen has to be able to tell them apart to draw a dash instead of a bar.
          per_day: dates.map((date) => per_day.get(date) ?? null),
          total_seconds,
          floor_hours,
          deficit_seconds: floor_hours === null ? null : Math.max(0, floor_hours * 3600 - total_seconds),
        };
      })
      .sort((left, right) => right.total_seconds - left.total_seconds);

    return { dates, streams, total_seconds: streams.reduce((sum, stream) => sum + stream.total_seconds, 0) };
  }),

  // The second resource dimension. Hour-fairness is not slot-fairness for this operator: the US streams can
  // only consume this window, so hours given to them there cost the local streams nothing — while local
  // work taking the best morning hours does cost the US ones. Counting only totals hides that entirely.
  listOverlap: authed.input(range_schema).handler(async ({ input }) => {
    const from = operatorDayStartOf(input.from);
    const to = new Date(operatorDayStartOf(input.to).getTime() + DAY_MS);

    const rows = await db
      .select({ project: activityBucket.project, seconds: sql<number>`SUM(${activityBucket.seconds})` })
      .from(activityBucket)
      .where(
        and(
          gte(activityBucket.bucket_start, from),
          lt(activityBucket.bucket_start, to),
          gte(local_hour, OVERLAP_START_HOUR),
          lt(local_hour, OVERLAP_END_HOUR),
        ),
      )
      .groupBy(activityBucket.project);

    const streams = rows.map((row) => ({ project: row.project, seconds: Number(row.seconds) })).sort((l, r) => r.seconds - l.seconds);

    return {
      window: { end_hour: OVERLAP_END_HOUR, start_hour: OVERLAP_START_HOUR },
      streams,
      total_seconds: streams.reduce((sum, stream) => sum + stream.seconds, 0),
    };
  }),

  // Every bucket of one day, for reading a day that looks wrong. The share column is the one place the
  // proportional split is visible, which is what makes a surprising total explainable rather than magic.
  listDay: authed.input(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })).handler(async ({ input }) => {
    const from = operatorDayStartOf(input.date);
    const to = new Date(from.getTime() + DAY_MS);

    const rows = await db
      .select()
      .from(activityBucket)
      .where(and(gte(activityBucket.bucket_start, from), lt(activityBucket.bucket_start, to)))
      .orderBy(activityBucket.bucket_start, activityBucket.project);

    return rows.map((row) => ({
      bucket_start: row.bucket_start.toISOString(),
      project: row.project,
      seconds: row.seconds,
      // decimal comes back from mysql2 as a string, the only column in this database that does.
      share: Number(row.share),
    }));
  }),
};
