import { describe, expect, test } from "bun:test";
import { buildDigestLinks, DIGEST_LINK_TTL_MS, digestLinkUrl, signDigestLink, verifyDigestLink } from "@server/mail/digest/links";

const SECRET = "0123456789abcdef0123456789abcdef";
const now = new Date("2026-09-07T05:00:00.000Z");
const payload = { action: "file" as const, address: "news@sender.example", expires_at: "2026-09-21T05:00:00.000Z" };

describe("signDigestLink / verifyDigestLink", () => {
  test("round trip", () => {
    const token = signDigestLink(payload, SECRET);

    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(verifyDigestLink(token, { secret: SECRET, now })).toEqual({ ok: true, payload });
  });

  test("a different secret, a tampered body and a tampered signature are all bad_signature", () => {
    const token = signDigestLink(payload, SECRET);
    const [body, signature] = token.split(".");
    const tampered_body = Buffer.from(JSON.stringify({ ...payload, action: "unsubscribe" }), "utf8").toString("base64url");

    expect(verifyDigestLink(token, { secret: "another-secret-another-secret-00", now })).toEqual({ ok: false, reason: "bad_signature" });
    expect(verifyDigestLink(`${tampered_body}.${signature}`, { secret: SECRET, now })).toEqual({ ok: false, reason: "bad_signature" });
    expect(verifyDigestLink(`${body}.${signature.slice(0, -2)}AA`, { secret: SECRET, now })).toEqual({
      ok: false,
      reason: "bad_signature",
    });
  });

  test("expired at and after the deadline, valid a second before it", () => {
    const token = signDigestLink(payload, SECRET);

    expect(verifyDigestLink(token, { secret: SECRET, now: new Date("2026-09-21T05:00:00.000Z") })).toEqual({
      ok: false,
      reason: "expired",
    });
    expect(verifyDigestLink(token, { secret: SECRET, now: new Date("2026-10-01T00:00:00.000Z") })).toEqual({
      ok: false,
      reason: "expired",
    });
    expect(verifyDigestLink(token, { secret: SECRET, now: new Date("2026-09-21T04:59:59.000Z") }).ok).toBe(true);
  });

  test("malformed tokens: empty, no dot, three parts, a signed body that is not the payload shape", () => {
    expect(verifyDigestLink("", { secret: SECRET, now })).toEqual({ ok: false, reason: "malformed" });
    expect(verifyDigestLink("abc", { secret: SECRET, now })).toEqual({ ok: false, reason: "malformed" });
    expect(verifyDigestLink("a.b.c", { secret: SECRET, now })).toEqual({ ok: false, reason: "malformed" });

    // Correctly signed, wrong shape: the signature passes, the schema does not.
    const [, signature] = signDigestLink(payload, SECRET).split(".");
    const other_body = Buffer.from(JSON.stringify({ action: "purge", address: "x", expires_at: "soon" }), "utf8").toString("base64url");
    expect(verifyDigestLink(`${other_body}.${signature}`, { secret: SECRET, now }).ok).toBe(false);
    expect(verifyDigestLink(`${Buffer.from("not json").toString("base64url")}.${signature}`, { secret: SECRET, now }).ok).toBe(false);
  });
});

describe("buildDigestLinks", () => {
  test("two links, 14 days out, on the site origin, each verifying to its own action", () => {
    const links = buildDigestLinks({ address: "news@sender.example", now, secret: SECRET });

    for (const [action, url] of [
      ["unsubscribe", links.unsubscribe],
      ["file", links.file],
    ] as const) {
      const parsed = new URL(url);
      expect(parsed.origin).toBe("https://flext.dev");
      expect(parsed.pathname).toBe("/api/digest-link");
      const verified = verifyDigestLink(parsed.searchParams.get("token") ?? "", { secret: SECRET, now });
      expect(verified).toEqual({
        ok: true,
        payload: { action, address: "news@sender.example", expires_at: new Date(now.getTime() + DIGEST_LINK_TTL_MS).toISOString() },
      });
    }
    expect(DIGEST_LINK_TTL_MS).toBe(14 * 24 * 60 * 60 * 1000);
  });

  test("the token survives the URL round trip untouched", () => {
    const token = signDigestLink(payload, SECRET);
    const url = new URL(digestLinkUrl(token, "http://127.0.0.1:3000"));

    expect(url.searchParams.get("token")).toBe(token);
  });
});
