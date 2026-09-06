import { db } from "@server/db/drizzle";
import { activityBucket } from "@server/db/schema";
import { DAY_MS, OPERATOR_UTC_OFFSET_MINUTES, operatorDayStartOf } from "@server/operator-day";
import { resolveStreams, type Stream } from "@server/personal-streams";
import { normaliseProjectName, UNKNOWN_PROJECT } from "@server/wakatime/bucket-heartbeats";
import { and, gte, lt, sql } from "drizzle-orm";
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

type StreamKey = { key: string; project: string; label: string; palette_slot: number | null; mapped: boolean; floor_hours: number | null };

// A stream is a project. Every bucket name mapped to one folds into a single row, so a project answering to
// two upstream names is charged its floor once rather than once per name. A name with no live project is
// its own stream, labelled by the name. `key` is stable across renames — the project id, or `waka:<name>`
// for a name with no project — and is what the screens key on; `project` still carries the normalised name
// for the review screen until it moves over.
const streamOf = (bucket_name: string, by_waka_name: Map<string, Stream>): StreamKey => {
  const stream = by_waka_name.get(bucket_name);

  if (stream === undefined) {
    return { key: `waka:${bucket_name}`, project: bucket_name, label: bucket_name, palette_slot: null, mapped: false, floor_hours: null };
  }

  return {
    key: stream.project_id,
    project: normaliseProjectName(stream.project_name),
    label: stream.project_name,
    palette_slot: stream.palette_slot,
    mapped: true,
    floor_hours: stream.soft_floor_hours,
  };
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
    const { by_waka_name } = await resolveStreams();
    const by_stream = new Map<string, { stream: StreamKey; per_day: Map<string, number> }>();

    for (const row of rows) {
      const stream = streamOf(row.project, by_waka_name);
      const entry = by_stream.get(stream.key) ?? { stream, per_day: new Map<string, number>() };
      const date = String(row.date).slice(0, 10);

      // mysql2 returns SUM as a string. Every read of an aggregate in this codebase goes through Number()
      // at the mapping boundary, and `seconds` is no exception.
      entry.per_day.set(date, (entry.per_day.get(date) ?? 0) + Number(row.seconds));
      by_stream.set(stream.key, entry);
    }

    const streams = [...by_stream.values()]
      .map(({ stream, per_day }) => {
        const total_seconds = [...per_day.values()].reduce((sum, seconds) => sum + seconds, 0);

        return {
          key: stream.key,
          project: stream.project,
          label: stream.label,
          palette_slot: stream.palette_slot,
          mapped: stream.mapped,
          // null, not zero, for a day with nothing recorded. Absent and zero are different claims and the
          // screen has to be able to tell them apart to draw a dash instead of a bar.
          per_day: dates.map((date) => per_day.get(date) ?? null),
          total_seconds,
          floor_hours: stream.floor_hours,
          deficit_seconds: stream.floor_hours === null ? null : Math.max(0, stream.floor_hours * 3600 - total_seconds),
        };
      })
      .sort((left, right) => right.total_seconds - left.total_seconds);

    return {
      dates,
      streams,
      total_seconds: streams.reduce((sum, stream) => sum + stream.total_seconds, 0),
      // The `unknown` bucket holds heartbeats that named no project at all; nothing on the Areas screen can
      // assign it, so counting it would promise a fix the screen cannot deliver.
      unmapped_count: streams.filter((stream) => !stream.mapped && stream.project !== UNKNOWN_PROJECT).length,
    };
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

    const { by_waka_name } = await resolveStreams();
    const by_stream = new Map<string, { stream: StreamKey; seconds: number }>();

    for (const row of rows) {
      const stream = streamOf(row.project, by_waka_name);
      const entry = by_stream.get(stream.key) ?? { stream, seconds: 0 };

      entry.seconds += Number(row.seconds);
      by_stream.set(stream.key, entry);
    }

    const streams = [...by_stream.values()]
      .map(({ stream, seconds }) => ({
        key: stream.key,
        project: stream.project,
        label: stream.label,
        palette_slot: stream.palette_slot,
        mapped: stream.mapped,
        seconds,
      }))
      .sort((left, right) => right.seconds - left.seconds);

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
