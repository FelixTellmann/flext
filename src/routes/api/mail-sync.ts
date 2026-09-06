import { timingSafeEqual } from "node:crypto";
import { serverEnv } from "@server/env";
import { listMailboxesNeedingOperator, runSyncForAllMailboxes } from "@server/mail/sync/run";
import { sync_mode_schema } from "@server/mail/types";
import { createFileRoute } from "@tanstack/react-router";

// serverEnv(), never the root env.ts: that one validates ~40 variables at import time and calls
// process.exit(1) on a miss, so importing it from a route would both read environment during the Docker
// build and kill the container at runtime over PlanetScale-era variables that no longer exist.
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

  const mode = sync_mode_schema.safeParse(new URL(request.url).searchParams.get("mode") ?? "incremental");
  if (!mode.success) {
    return Response.json({ error: "mode must be incremental, reconcile, backfill, repair or reclassify" }, { status: 400 });
  }

  const summaries = await runSyncForAllMailboxes({ mode: mode.data });
  const failed = summaries.filter((summary) => summary.status === "failed").length;
  const needs_operator = await listMailboxesNeedingOperator();

  const body = { mode: mode.data, mailboxes: summaries.length, failed, needs_operator, summaries };

  // A disabled mailbox is the one failure that never heals on its own, and until now this endpoint
  // answered 200 whatever happened — so felix@tellmann.co.za dropped off after a routine certificate
  // rotation on 2026-08-24 and stayed off, silently, with 8,864 decisions waiting behind it. Nothing was
  // broken; nothing said so either.
  //
  // 503 rather than 500: the sync itself worked, a mailbox is unavailable and a human has to act. That
  // makes the scheduled job go red wherever it runs, which is the only alerting channel this deployment
  // actually has. A network blip stays 200 on purpose — it re-connects by itself and a cron that cries
  // wolf on transient errors gets muted, which would lose the signal this exists to send.
  if (needs_operator.length > 0) {
    return Response.json(body, { status: 503 });
  }
  return Response.json(body);
}

export const Route = createFileRoute("/api/mail-sync")({
  server: { handlers: { POST: handle } },
});
