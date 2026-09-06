import { tryAcquireSyncLock } from "@server/mail/sync/lock";
import { listMailboxesNeedingOperator, runSyncForAllMailboxes } from "@server/mail/sync/run";
import { sync_mode_schema } from "@server/mail/types";
import { requireScriptSecret } from "@server/script-auth";
import { createFileRoute } from "@tanstack/react-router";

async function handle({ request }: { request: Request }) {
  const refusal = requireScriptSecret(request);
  if (refusal !== null) {
    return refusal;
  }

  const mode = sync_mode_schema.safeParse(new URL(request.url).searchParams.get("mode") ?? "incremental");
  if (!mode.success) {
    return Response.json({ error: "mode must be incremental, reconcile, backfill, repair or reclassify" }, { status: 400 });
  }

  // Read before the run starts, so the answer describes the PREVIOUS run's outcome: this response is an
  // acknowledgement, not a result. Nitro's bun preset serves without an idleTimeout, so Bun's 10 s default
  // applies and any request silent that long has its socket closed — an incremental run takes 8 to 40 s,
  // reclassify and backfill take minutes, and the Coolify tick saw ECONNRESET on every one of them while
  // the sync completed fine server-side. Per-mailbox summaries are therefore no longer in the body; the
  // SyncRun table is where a run's results live.
  //
  // Read before the lock is taken: a throw here would otherwise exit the handler with the lock held and
  // nothing left to release it until the stale window passes.
  const needs_operator = await listMailboxesNeedingOperator();

  const lock = tryAcquireSyncLock(mode.data);
  if (!lock.acquired) {
    return Response.json({ error: "a sync is already running", ...lock.held }, { status: 409 });
  }

  runSyncForAllMailboxes({ mode: mode.data })
    .catch((error: unknown) => {
      console.error(`[mail-sync] ${mode.data} run failed`, error);
    })
    .finally(() => lock.release());

  const body = { mode: mode.data, accepted: true, needs_operator };

  // A disabled mailbox is the one failure that never heals on its own, and until now this endpoint
  // answered 200 whatever happened — so felix@tellmann.co.za dropped off after a routine certificate
  // rotation on 2026-08-24 and stayed off, silently, with 8,864 decisions waiting behind it. Nothing was
  // broken; nothing said so either.
  //
  // 503 rather than 500: the sync itself worked, a mailbox is unavailable and a human has to act. That
  // makes the scheduled job go red wherever it runs, which is the only alerting channel this deployment
  // actually has. Because needs_operator is read before the run it describes, the tick that disables a
  // mailbox still answers 202 and the NEXT tick goes red — one tick of lag, which the schedule absorbs.
  // A network blip stays 200 on purpose — it re-connects by itself and a cron that cries wolf on
  // transient errors gets muted, which would lose the signal this exists to send.
  if (needs_operator.length > 0) {
    return Response.json(body, { status: 503 });
  }
  return Response.json(body, { status: 202 });
}

export const Route = createFileRoute("/api/mail-sync")({
  server: { handlers: { POST: handle } },
});
