import { capture_input_schema, insertCapturedTask } from "@server/orpc/personal-tasks";
import { requireScriptSecret } from "@server/script-auth";
import { createFileRoute } from "@tanstack/react-router";

async function handle({ request }: { request: Request }) {
  const refusal = requireScriptSecret(request);
  if (refusal !== null) {
    return refusal;
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
