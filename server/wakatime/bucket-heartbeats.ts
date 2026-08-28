export type HeartbeatForBucketing = { occurred_at: Date; project: string | null };

export type ActivityBucketRow = { bucket_start: Date; project: string; seconds: number; share: number };

// Fifteen minutes: the scheduler's grid and the ledger's grain are deliberately the same number, so a
// bucket is never split across two reads or displayed at a resolution it was not measured at.
export const BUCKET_SECONDS = 900;
const BUCKET_MS = BUCKET_SECONDS * 1000;

// The name in a heartbeat is not the name of the project. The same work arrives as `doveras` and
// `doveras-donor-parser`, and as `listify`, `listify-2` and `C:\development\listify` — measured on the
// 2026 data, treating them as distinct under-reported Doveras by roughly 40%. The mechanical rules below
// catch the path and the numeric-suffix cases; anything requiring judgement goes in the alias map, where
// it is visible and correctable rather than inferred.
const PROJECT_ALIASES: Record<string, string> = {
  "doveras-donor-parser": "doveras",
};

const UNKNOWN_PROJECT = "unknown";

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

// Whole seconds, summing to exactly BUCKET_SECONDS, apportioned by heartbeat count. Largest-remainder
// rather than rounding each share independently: rounding leaks or loses a second or two per bucket, and
// across a day of buckets that becomes a visible drift in the only number the ledger exists to report.
const apportionSeconds = (counts: number[]): number[] => {
  const total = counts.reduce((sum, count) => sum + count, 0);

  if (total === 0) {
    return counts.map(() => 0);
  }

  const exact = counts.map((count) => (BUCKET_SECONDS * count) / total);
  const floored = exact.map((value) => Math.floor(value));
  let remainder = BUCKET_SECONDS - floored.reduce((sum, value) => sum + value, 0);

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
    const seconds = apportionSeconds(entries.map(([, count]) => count));

    for (const [index, [project]] of entries.entries()) {
      // share is derived from the apportioned seconds rather than computed alongside them, so the two can
      // never disagree. Stored at 4dp, so three equal projects hold 0.3333 each and sum to 0.9999 — under
      // one, never over, which is the direction the invariant has to fail in. `seconds` stays the
      // authoritative figure and is what the ledger sums.
      rows.push({
        bucket_start: new Date(bucket_key),
        project,
        seconds: seconds[index]!,
        share: Math.round((seconds[index]! / BUCKET_SECONDS) * 10_000) / 10_000,
      });
    }
  }

  return rows;
};
