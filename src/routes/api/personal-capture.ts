import { serverEnv } from "@server/env";
import { capture_input_schema, insertCapturedTask } from "@server/orpc/personal-tasks";
import { matchesScriptSecret } from "@server/script-auth";
import { createFileRoute } from "@tanstack/react-router";

// Same shape as src/routes/api/mail-sync.ts, and for the same reason: serverEnv() rather than the root
// env.ts, whose ~40-variable validation runs at import time and would take the container down over
// variables this endpoint never reads.

async function handle({ request }: { request: Request }) {
  const secret = serverEnv().SCRIPT_SECRET;

  if (secret === undefined) {
    return Response.json({ error: "SCRIPT_SECRET is not configured on this deployment" }, { status: 503 });
  }

  if (!matchesScriptSecret(request.headers.get("authorization"), secret)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const body = capture_input_schema.safeParse(await request.json().catch(() => null));

  if (!body.success) {
    return Response.json({ error: "body must be { title: string } of 1 to 512 characters" }, { status: 400 });
  }

  const { id } = await insertCapturedTask(body.data.title);

  return Response.json({ id });
}

export const Route = createFileRoute("/api/personal-capture")({
  server: { handlers: { POST: handle } },
});
