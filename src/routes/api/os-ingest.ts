import { requireScriptSecret } from "@server/script-auth";
import { WakaConfigError } from "@server/wakatime/client";
import { runHeartbeatIngest } from "@server/wakatime/ingest";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

// Three days of overlap by default: enough to catch a laptop that was offline over a weekend, cheap
// enough to run hourly because the unique index on source_id turns a re-read into an update.
const ingest_days_schema = z.coerce.number().int().min(1).max(14).default(3);

async function handle({ request }: { request: Request }) {
  const refusal = requireScriptSecret(request);
  if (refusal !== null) {
    return refusal;
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
