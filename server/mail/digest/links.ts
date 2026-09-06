import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

// A digest link is a claim the email carries back to the server: "the operator tapped File for this
// address". The HMAC is what makes that claim the server's own rather than anyone's who read the email;
// the expiry is what stops a forwarded digest carrying a working rule-creating link forever (register:
// phase 7 digest links). Signed with SCRIPT_SECRET because it is the one secret every scheduled job
// already shares.
//
// Pure. No IO; the secret and the clock come in as arguments.

export const DIGEST_LINK_TTL_MS = 14 * 24 * 60 * 60 * 1000;

// No env variable names the site's own origin (server/env.ts validates none), and the digest is the
// first outbound mail that links back to it.
export const SITE_ORIGIN = "https://flext.dev";

export const DIGEST_LINK_PATH = "/api/digest-link";

export type DigestLinkAction = "unsubscribe" | "file";

export type DigestLinkPayload = {
  action: DigestLinkAction;
  address: string;
  expires_at: string;
};

export type DigestLinkVerification =
  | { ok: true; payload: DigestLinkPayload }
  | { ok: false; reason: "malformed" | "bad_signature" | "expired" };

const payload_schema = z.object({
  action: z.enum(["unsubscribe", "file"]),
  address: z.string().min(3).max(320),
  expires_at: z.string().datetime(),
});

function signature(body: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(body, "utf8").digest();
}

export function signDigestLink(payload: DigestLinkPayload, secret: string): string {
  // Built here, key order fixed, so the signed bytes are exactly the bytes the verifier reads back.
  const body = JSON.stringify({ action: payload.action, address: payload.address, expires_at: payload.expires_at });
  return `${Buffer.from(body, "utf8").toString("base64url")}.${signature(body, secret).toString("base64url")}`;
}

export function verifyDigestLink(token: string, input: { secret: string; now: Date }): DigestLinkVerification {
  const parts = token.split(".");
  if (parts.length !== 2 || parts[0].length === 0 || parts[1].length === 0) {
    return { ok: false, reason: "malformed" };
  }

  const body = Buffer.from(parts[0], "base64url").toString("utf8");
  const provided = Buffer.from(parts[1], "base64url");
  const expected = signature(body, input.secret);
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return { ok: false, reason: "bad_signature" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { ok: false, reason: "malformed" };
  }
  const payload = payload_schema.safeParse(parsed);
  if (!payload.success) {
    return { ok: false, reason: "malformed" };
  }

  if (new Date(payload.data.expires_at).getTime() <= input.now.getTime()) {
    return { ok: false, reason: "expired" };
  }

  return { ok: true, payload: payload.data };
}

export function digestLinkUrl(token: string, origin: string = SITE_ORIGIN): string {
  return `${origin}${DIGEST_LINK_PATH}?token=${encodeURIComponent(token)}`;
}

export type DigestLinks = { unsubscribe: string; file: string };

export function buildDigestLinks(input: { address: string; now: Date; secret: string; origin?: string }): DigestLinks {
  const expires_at = new Date(input.now.getTime() + DIGEST_LINK_TTL_MS).toISOString();
  const link = (action: DigestLinkAction) =>
    digestLinkUrl(signDigestLink({ action, address: input.address, expires_at }, input.secret), input.origin);
  return { unsubscribe: link("unsubscribe"), file: link("file") };
}
