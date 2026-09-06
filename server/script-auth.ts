import { timingSafeEqual } from "node:crypto";
import { serverEnv } from "@server/env";

// The bearer check every script-facing endpoint uses. Length is compared first because
// timingSafeEqual throws on a length mismatch rather than returning false.
//
// Callers must read the secret through serverEnv(), never the root env.ts: that one validates ~40
// variables at import time and calls process.exit(1) on a miss, so importing it from a route would
// both read environment during the Docker build and kill the container at runtime over variables
// that no longer exist.
export function matchesScriptSecret(provided: string | null, expected_secret: string): boolean {
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

// The whole gate in one call: the response to send when the request may not proceed, null when it may.
// 503 rather than 401 for a missing secret because the deployment, not the caller, is what is wrong,
// and a red scheduled task is the only alerting this deployment has.
export function requireScriptSecret(
  request: Request,
  options: { secret: string | undefined } = { secret: serverEnv().SCRIPT_SECRET },
): Response | null {
  const { secret } = options;
  if (secret === undefined) {
    return Response.json({ error: "SCRIPT_SECRET is not configured on this deployment" }, { status: 503 });
  }

  if (!matchesScriptSecret(request.headers.get("authorization"), secret)) {
    return new Response("Unauthorized", { status: 401 });
  }

  return null;
}
