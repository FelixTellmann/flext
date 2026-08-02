import { createFileRoute } from "@tanstack/react-router";

// Deliberately does not touch the database. This answers "is the process serving HTTP", which is
// what the container HEALTHCHECK acts on — a restart cannot fix an unreachable database, so failing
// this on a database blip would turn one outage into a restart loop.
function handle() {
  return Response.json({ ok: true });
}

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: handle,
    },
  },
});
