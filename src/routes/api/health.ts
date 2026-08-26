import { access, constants } from "node:fs/promises";
import { resolve } from "node:path";
import { createFileRoute } from "@tanstack/react-router";

// Deliberately does not touch the database. This answers "is the process serving HTTP", which is
// what the container HEALTHCHECK acts on — a restart cannot fix an unreachable database, so failing
// this on a database blip would turn one outage into a restart loop.
//
// `personal_brain_readable` is informational for the same reason: it reports whether the private
// submodule actually made it into the image (a build silently skips it when the deploy key is
// missing), without turning that into a restart loop either.
const brain_canary_path = resolve(process.cwd(), "personal/brain/README.md");

async function personalBrainReadable() {
  try {
    await access(brain_canary_path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function handle() {
  return Response.json({ ok: true, personal_brain_readable: await personalBrainReadable() });
}

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: handle,
    },
  },
});
