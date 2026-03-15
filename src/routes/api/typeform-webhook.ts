import { createFileRoute } from "@tanstack/react-router";

async function handle({ request }: { request: Request }) {
  console.log("Typeform webhook received");
  return Response.json({ name: "John Doe" });
}

export const Route = createFileRoute("/api/typeform-webhook")({
  server: { handlers: { POST: handle } },
});
