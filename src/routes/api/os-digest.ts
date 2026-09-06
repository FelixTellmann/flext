import { db } from "@server/db/drizzle";
import { activityBucket, personalTask } from "@server/db/schema";
import { DAY_MS, isoWeekOf, operatorDayStart } from "@server/operator-day";
import { requireScriptSecret } from "@server/script-auth";
import { createFileRoute } from "@tanstack/react-router";
import { and, count, eq, gte, inArray, isNotNull, lt, sql } from "drizzle-orm";

const hours = (seconds: number): string => `${Math.floor(seconds / 3600)}h${String(Math.round((seconds % 3600) / 60)).padStart(2, "0")}`;

// Rendered text, not a payload. §6.6 makes this the only push the system sends and requires the
// content to live in the notification itself — the operator is usually out in the evening, and a
// message that needs a screen opened to mean anything would simply be ignored.
//
// One-way by construction: nothing here asks for a decision, and there are no actions to take. A
// notification that wanted something back would become an obligation, which is the one thing §6.6
// says it must never be.
async function renderDigest(now: Date): Promise<string> {
  const day_start = operatorDayStart(now);
  const day_end = new Date(day_start.getTime() + DAY_MS);

  const [committed] = await db
    .select({ n: count() })
    .from(personalTask)
    .where(
      and(
        inArray(personalTask.state, ["inbox", "open"]),
        isNotNull(personalTask.when_date),
        gte(personalTask.when_date, day_start),
        lt(personalTask.when_date, day_end),
      ),
    );

  const [done] = await db
    .select({ n: count() })
    .from(personalTask)
    .where(and(eq(personalTask.state, "completed"), gte(personalTask.completed_at, day_start), lt(personalTask.completed_at, day_end)));

  const [tracked] = await db
    .select({ seconds: sql<number>`SUM(${activityBucket.seconds})` })
    .from(activityBucket)
    .where(and(gte(activityBucket.bucket_start, day_start), lt(activityBucket.bucket_start, day_end)));

  const still_open = Number(committed?.n ?? 0);
  const completed_today = Number(done?.n ?? 0);
  // mysql2 returns SUM as a string, and as null when no rows matched.
  const tracked_seconds = Number(tracked?.seconds ?? 0);

  const lines = [
    completed_today === 0 && still_open === 0 ? "Nothing was committed today." : `${completed_today} done, ${still_open} still open.`,
    tracked_seconds > 0 ? `${hours(tracked_seconds)} tracked.` : "No tracked work.",
  ];

  // Availability, never an obligation — the review is offered on Sunday and stays offered. It is
  // not late on Monday, so this never says "due" or "overdue".
  if (now.getUTCDay() === 0) {
    lines.push(`The ${isoWeekOf(now)} review is open when you want it.`);
  }

  return lines.join(" ");
}

async function handle({ request }: { request: Request }) {
  const refusal = requireScriptSecret(request);
  if (refusal !== null) {
    return refusal;
  }

  // text/plain so a Shortcut can show the body directly without parsing anything.
  return new Response(await renderDigest(new Date()), { headers: { "content-type": "text/plain; charset=utf-8" } });
}

export const Route = createFileRoute("/api/os-digest")({
  server: { handlers: { GET: handle, POST: handle } },
});
