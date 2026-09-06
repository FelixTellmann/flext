import { sendDigest } from "@server/mail/digest/send";
import { requireScriptSecret } from "@server/script-auth";
import { createFileRoute } from "@tanstack/react-router";

async function handlePost({ request }: { request: Request }) {
  const refusal = requireScriptSecret(request);
  if (refusal !== null) {
    return refusal;
  }

  try {
    return Response.json(await sendDigest({ now: new Date() }));
  } catch (error) {
    console.error("[mail-digest] failed", error);
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

function handleGet() {
  return new Response("Method Not Allowed", { status: 405, headers: { allow: "POST" } });
}

export const Route = createFileRoute("/api/mail-digest")({
  server: { handlers: { POST: handlePost, GET: handleGet } },
});
