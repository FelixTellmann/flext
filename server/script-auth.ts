import { timingSafeEqual } from "node:crypto";

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
