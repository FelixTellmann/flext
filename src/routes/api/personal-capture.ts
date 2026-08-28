import { timingSafeEqual } from "node:crypto";
import { serverEnv } from "@server/env";
import { capture_input_schema, insertCapturedTask } from "@server/orpc/personal-tasks";
import { createFileRoute } from "@tanstack/react-router";

// Same shape as src/routes/api/mail-sync.ts, and for the same reason: serverEnv() rather than the root
// env.ts, whose ~40-variable validation runs at import time and would take the container down over
// variables this endpoint never reads.
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
