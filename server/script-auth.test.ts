import { describe, expect, test } from "bun:test";
import { matchesScriptSecret, requireScriptSecret } from "@server/script-auth";

const SECRET = "0123456789abcdef0123456789abcdef";

function requestWith(authorization: string | null): Request {
  return new Request("http://127.0.0.1:3000/api/anything", {
    method: "POST",
    headers: authorization === null ? {} : { authorization },
  });
}

describe("matchesScriptSecret", () => {
  test("the exact bearer matches", () => {
    expect(matchesScriptSecret(`Bearer ${SECRET}`, SECRET)).toBe(true);
  });

  test("a missing header, a different length and a same-length mismatch all refuse", () => {
    expect(matchesScriptSecret(null, SECRET)).toBe(false);
    expect(matchesScriptSecret("Bearer short", SECRET)).toBe(false);
    expect(matchesScriptSecret(`Bearer ${SECRET.slice(0, -1)}x`, SECRET)).toBe(false);
    expect(matchesScriptSecret(SECRET, SECRET)).toBe(false);
  });
});

describe("requireScriptSecret", () => {
  test("503 when the deployment has no secret, whatever the caller sent", async () => {
    const response = requireScriptSecret(requestWith(`Bearer ${SECRET}`), { secret: undefined });

    expect(response?.status).toBe(503);
    expect(await response?.json()).toEqual({ error: "SCRIPT_SECRET is not configured on this deployment" });
  });

  test("401 on a missing or wrong bearer", () => {
    expect(requireScriptSecret(requestWith(null), { secret: SECRET })?.status).toBe(401);
    expect(requireScriptSecret(requestWith("Bearer nope"), { secret: SECRET })?.status).toBe(401);
  });

  test("null when the bearer matches", () => {
    expect(requireScriptSecret(requestWith(`Bearer ${SECRET}`), { secret: SECRET })).toBeNull();
  });
});
