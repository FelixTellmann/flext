export type HeartbeatForBucketing = { occurred_at: Date; project: string | null };

export type ActivityBucketRow = { bucket_start: Date; project: string; seconds: number; share: number };

// Fifteen minutes: the scheduler's grid and the ledger's grain are deliberately the same number, so a
// bucket is never split across two reads or displayed at a resolution it was not measured at.
export const BUCKET_SECONDS = 900;
const BUCKET_MS = BUCKET_SECONDS * 1000;

// share is stored as decimal(5,4), so a share is a whole number of ten-thousandths.
const SHARE_UNITS = 10_000;

// The name in a heartbeat is not the name of the project. The same work arrives as `doveras` and
// `doveras-donor-parser`, and as `listify`, `listify-2` and `C:\development\listify` — measured on the
// 2026 data, treating them as distinct under-reported Doveras by roughly 40%. The mechanical rules below
// catch the path and the numeric-suffix cases; anything requiring judgement goes in the alias map, where
// it is visible and correctable rather than inferred.
const PROJECT_ALIASES: Record<string, string> = {
  "doveras-donor-parser": "doveras",
};

export const UNKNOWN_PROJECT = "unknown";

export const normaliseProjectName = (raw: string | null): string => {
  if (raw === null) {
    return UNKNOWN_PROJECT;
  }

  // Editors report a workspace path on some machines and a bare name on others, so the last segment of
  // either separator is the only part that is consistently the project.
  const last_segment = raw.split(/[/\\]/).at(-1) ?? "";
  const trimmed = last_segment.trim().toLowerCase();

  if (trimmed === "") {
    return UNKNOWN_PROJECT;
  }

  // `listify-2` is the same project as `listify`. A trailing number is how a second checkout announces
  // itself, never how a project is named.
  const without_copy_suffix = trimmed.replace(/[-_]\d+$/, "");

  return PROJECT_ALIASES[without_copy_suffix] ?? without_copy_suffix;
};

const bucketStartOf = (at: Date): Date => new Date(Math.floor(at.getTime() / BUCKET_MS) * BUCKET_MS);

// Whole units, summing to exactly `into`, apportioned by weight. Largest-remainder rather than rounding
// each value independently: independent rounding both leaks and loses, and it does not merely drift — six
// equal projects each round 0.16667 up to 0.1667, and the six sum to 1.0002. A share total above one is
// the one direction this must never fail in, because it is the claim that the bucket held more time than
// it had. Measured on real heartbeats, five buckets in three days did exactly that.
const apportion = (weights: number[], into: number): number[] => {
  const total = weights.reduce((sum, weight) => sum + weight, 0);

  if (total === 0) {
    return weights.map(() => 0);
  }

  const exact = weights.map((weight) => (into * weight) / total);
  const floored = exact.map((value) => Math.floor(value));
  let remainder = into - floored.reduce((sum, value) => sum + value, 0);

  const by_largest_remainder = exact
    .map((value, index) => ({ fraction: value - floored[index]!, index }))
    .sort((left, right) => right.fraction - left.fraction || left.index - right.index);

  for (const entry of by_largest_remainder) {
    if (remainder <= 0) {
      break;
    }
    floored[entry.index] = floored[entry.index]! + 1;
    remainder -= 1;
  }

  return floored;
};

// Pure by design — no database, no clock, no configuration. The whole point of the 15-minute grid is an
// invariant that can be checked by reading it: every bucket distributes exactly BUCKET_SECONDS, so a day
// can never report more hours than it physically contained however many editors were open at once.
//
// A bucket nobody worked in is absent from the result, never present with zero. Absent and zero are
// different claims and only one of them is true.
export const bucketHeartbeats = (input: { heartbeats: HeartbeatForBucketing[] }): ActivityBucketRow[] => {
  const counts_by_bucket = new Map<number, Map<string, number>>();

  for (const heartbeat of input.heartbeats) {
    const bucket_key = bucketStartOf(heartbeat.occurred_at).getTime();
    const project = normaliseProjectName(heartbeat.project);
    const projects = counts_by_bucket.get(bucket_key) ?? new Map<string, number>();

    projects.set(project, (projects.get(project) ?? 0) + 1);
    counts_by_bucket.set(bucket_key, projects);
  }

  const rows: ActivityBucketRow[] = [];

  for (const [bucket_key, projects] of [...counts_by_bucket.entries()].sort(([left], [right]) => left - right)) {
    const entries = [...projects.entries()].sort(([left], [right]) => left.localeCompare(right));
    const seconds = apportion(
      entries.map(([, count]) => count),
      BUCKET_SECONDS,
    );
    // Apportioned from the seconds rather than divided out of them, so the two can never disagree AND the
    // rounded shares still sum to exactly one. Dividing and rounding gives one or the other, never both.
    const share_units = apportion(seconds, SHARE_UNITS);

    for (const [index, [project]] of entries.entries()) {
      rows.push({
        bucket_start: new Date(bucket_key),
        project,
        seconds: seconds[index]!,
        share: share_units[index]! / SHARE_UNITS,
      });
    }
  }

  return rows;
};
