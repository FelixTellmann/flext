import { db } from "@server/db/drizzle";
import { activityBucket, wakaHeartbeat } from "@server/db/schema";
import { bucketHeartbeats } from "@server/wakatime/bucket-heartbeats";
import { fetchHeartbeats } from "@server/wakatime/client";
import { and, asc, gte, lt, sql } from "drizzle-orm";

const INSERT_CHUNK_SIZE = 200;
const DAY_MS = 24 * 60 * 60 * 1000;

// The tracker records in the operator's own timezone (Africa/Johannesburg, fixed at +02:00 — South Africa
// observes no daylight saving). Asking Wakapi for a UTC date would fetch a window shifted two hours off
// the day the operator actually worked, splitting every late evening across two requests.
const OPERATOR_UTC_OFFSET_MINUTES = 120;

const operatorDate = (at: Date): string => new Date(at.getTime() + OPERATOR_UTC_OFFSET_MINUTES * 60_000).toISOString().slice(0, 10);

// Local midnight expressed as the UTC instant it actually is: 2026-08-28 in Johannesburg begins at
// 2026-08-27T22:00Z, which is the boundary the bucket rows are stored against.
const operatorDayStart = (date: string): Date =>
  new Date(new Date(`${date}T00:00:00.000Z`).getTime() - OPERATOR_UTC_OFFSET_MINUTES * 60_000);

const clamp = (value: string | null, length: number): string | null => (value === null ? null : value.slice(0, length));

export type IngestSummary = { buckets_written: number; days: string[]; heartbeats_seen: number };

// Deliberately overlapping windows. A heartbeat can arrive at Wakapi late — a laptop that was offline, a
// dual-write that retried — so re-reading the last few days is the only way an hourly job notices. The
// unique index on source_id is what makes that free: a re-read of the same heartbeat is an update, not a
// duplicate.
export const runHeartbeatIngest = async (input: { days: number; now?: Date }): Promise<IngestSummary> => {
  const now = input.now ?? new Date();
  const dates = Array.from({ length: input.days }, (_, offset) => operatorDate(new Date(now.getTime() - offset * DAY_MS))).reverse();

  let heartbeats_seen = 0;

  for (const date of dates) {
    const payload = await fetchHeartbeats(date);
    heartbeats_seen += payload.length;

    const rows = payload
      .filter((beat) => typeof beat.time === "number" && Number.isFinite(beat.time))
      .map((beat) => ({
        id: crypto.randomUUID(),
        source_id: beat.id,
        project: clamp(beat.project, 191),
        language: clamp(beat.language, 191),
        entity: beat.entity,
        is_write: beat.is_write ?? false,
        occurred_at: new Date(beat.time * 1000),
        updatedAt: now,
      }));

    for (let offset = 0; offset < rows.length; offset += INSERT_CHUNK_SIZE) {
      await db
        .insert(wakaHeartbeat)
        .values(rows.slice(offset, offset + INSERT_CHUNK_SIZE))
        .onDuplicateKeyUpdate({
          set: {
            project: sql`VALUES(\`project\`)`,
            language: sql`VALUES(\`language\`)`,
            entity: sql`VALUES(\`entity\`)`,
            is_write: sql`VALUES(\`isWrite\`)`,
            occurred_at: sql`VALUES(\`occurredAt\`)`,
            updatedAt: now,
          },
        });
    }
  }

  const buckets_written = await rebucketRange({
    from: operatorDayStart(dates[0] ?? operatorDate(now)),
    now,
    to: new Date(operatorDayStart(dates.at(-1) ?? operatorDate(now)).getTime() + DAY_MS),
  });

  return { buckets_written, days: dates, heartbeats_seen };
};

// Buckets are derived, so the window is rebuilt rather than patched. Patching would leave a bucket whose
// shares no longer sum to one the moment a normalisation rule changes — and the alias map is expected to
// change, because it is the part a human corrects.
export const rebucketRange = async (input: { from: Date; now?: Date; to: Date }): Promise<number> => {
  const now = input.now ?? new Date();

  const heartbeats = await db
    .select({ occurred_at: wakaHeartbeat.occurred_at, project: wakaHeartbeat.project })
    .from(wakaHeartbeat)
    .where(and(gte(wakaHeartbeat.occurred_at, input.from), lt(wakaHeartbeat.occurred_at, input.to)))
    .orderBy(asc(wakaHeartbeat.occurred_at));

  const rows = bucketHeartbeats({ heartbeats });

  await db.delete(activityBucket).where(and(gte(activityBucket.bucket_start, input.from), lt(activityBucket.bucket_start, input.to)));

  for (let offset = 0; offset < rows.length; offset += INSERT_CHUNK_SIZE) {
    await db
      .insert(activityBucket)
      .values(
        rows.slice(offset, offset + INSERT_CHUNK_SIZE).map((row) => ({
          id: crypto.randomUUID(),
          bucket_start: row.bucket_start,
          project: row.project,
          // decimal columns go to mysql2 as strings; sending a JS number risks the driver's own formatting
          // rather than the 4dp the column declares.
          share: row.share.toFixed(4),
          seconds: row.seconds,
          updatedAt: now,
        })),
      )
      .onDuplicateKeyUpdate({ set: { seconds: sql`VALUES(\`seconds\`)`, share: sql`VALUES(\`share\`)`, updatedAt: now } });
  }

  return rows.length;
};
