import { applyDigestLink, digestLinkStatus, renderDigestLinkPage } from "@server/mail/digest/link-action";
import { createFileRoute } from "@tanstack/react-router";

// No bearer: the signature in the token is the authorisation, because the tap comes from a mail client
// that cannot send a header. Single-purpose but not single-use; both actions are idempotent.
async function handleGet({ request }: { request: Request }) {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const result = await applyDigestLink({ token, now: new Date() });

  return new Response(renderDigestLinkPage(result), {
    status: digestLinkStatus(result),
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

export const Route = createFileRoute("/api/digest-link")({
  server: { handlers: { GET: handleGet } },
});
