import { RPCHandler } from "@orpc/server/fetch";
import { orpcRouter } from "@server/orpc";
import { createFileRoute } from "@tanstack/react-router";

const handler = new RPCHandler(orpcRouter);

async function handle({ request }: { request: Request }) {
  const { response } = await handler.handle(request, {
    prefix: "/api/orpc",
    context: {},
  });
  return response ?? new Response("Not Found", { status: 404 });
}

export const Route = createFileRoute("/api/orpc/$")({
  server: {
    handlers: {
      GET: handle,
      POST: handle,
      PUT: handle,
      DELETE: handle,
      OPTIONS: handle,
    },
  },
});
