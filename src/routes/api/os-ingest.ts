import { timingSafeEqual } from "node:crypto";
import { serverEnv } from "@server/env";
import { WakaConfigError } from "@server/wakatime/client";
import { runHeartbeatIngest } from "@server/wakatime/ingest";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

// Three days of overlap by default: enough to catch a laptop that was offline over a weekend, cheap
// enough to run hourly because the unique index on source_id turns a re-read into an update.
const ingest_days_schema = z.coerce.number().int().min(1).max(14).default(3);

// serverEnv(), never the root env.ts — that one validates ~40 variables at import time and calls
// process.exit(1) on a miss, which from a route would read environment during the Docker build and kill
// the container over variables this endpoint never touches.
function matchesSecret(provided: string | null, expected_secret: string): boolean {
  if (provided === null) {
    return false;
  }
  const expected = Buffer.from(`Bearer ${expected_secret}`, "utf8");
  const candidate = Buffer.from(provided, "utf8");
  if (expected.length !== candidate.length) {
    return false;
  }
  return timingSafeEqual(expected, candidate);
}

async function handle({ request }: { request: Request }) {
  const secret = serverEnv().SCRIPT_SECRET;

  if (secret === undefined) {
    return Response.json({ error: "SCRIPT_SECRET is not configured on this deployment" }, { status: 503 });
  }

  if (!matchesSecret(request.headers.get("authorization"), secret)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const days = ingest_days_schema.safeParse(new URL(request.url).searchParams.get("days") ?? undefined);

  if (!days.success) {
    return Response.json({ error: "days must be a whole number between 1 and 14" }, { status: 400 });
  }

  try {
    return Response.json(await runHeartbeatIngest({ days: days.data }));
  } catch (error) {
    // 503 rather than 500 for a missing configuration, on the same rule mail-sync follows: the job did not
    // fail, a human has to act. Turning the scheduled task red is the only alerting this deployment has.
    if (error instanceof WakaConfigError) {
      return Response.json({ error: error.message }, { status: 503 });
    }
    throw error;
  }
}

export const Route = createFileRoute("/api/os-ingest")({
  server: { handlers: { POST: handle } },
});
