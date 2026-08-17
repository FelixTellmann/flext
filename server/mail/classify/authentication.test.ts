import { expect, test } from "bun:test";
import { dkimAligned } from "./authentication";

test("a passing signature from the From domain is aligned", () => {
  expect(dkimAligned("mx.google.com; dkim=pass header.i=@acmecorp.com header.d=acmecorp.com; spf=pass", "acmecorp.com")).toBe(true);
});

test("a passing signature from a different domain is not aligned", () => {
  expect(dkimAligned("mx.google.com; dkim=pass header.d=sendgrid.net; spf=pass", "acmecorp.com")).toBe(false);
});

test("a failing signature is not aligned", () => {
  expect(dkimAligned("mx.google.com; dkim=fail header.d=acmecorp.com", "acmecorp.com")).toBe(false);
});

test("an absent or unparseable header is unknown, not false", () => {
  expect(dkimAligned(null, "acmecorp.com")).toBeNull();
  expect(dkimAligned("spf=pass smtp.mailfrom=acmecorp.com", "acmecorp.com")).toBeNull();
});

// Real header captured from imap.gmail.com on 2026-08-17. Gmail names the identity header.i, never
// header.d, which is why every one of 14479 synced messages came back null.
test("gmail's header.i identity counts as the signing domain", () => {
  const gmail = "mx.google.com; dkim=pass header.i=@accounts.google.com header.s=20251104 header.b=f2BVYibd; spf=pass";

  expect(dkimAligned(gmail, "accounts.google.com")).toBe(true);
});

test("any passing signature on the From domain aligns, whatever order the verifier lists them in", () => {
  const esp_first = "mx.google.com; dkim=pass header.i=@sendgrid.info header.s=smtpapi; dkim=pass header.i=@email.openai.com header.s=s1";

  expect(dkimAligned(esp_first, "email.openai.com")).toBe(true);
  expect(dkimAligned(esp_first, "impersonated.com")).toBe(false);
});

test("a bare user@domain identity is reduced to its domain", () => {
  expect(dkimAligned("dkim=pass header.i=noreply@acmecorp.com", "acmecorp.com")).toBe(true);
});

test("relaxed alignment still accepts a parent signing domain", () => {
  expect(dkimAligned("dkim=pass header.i=@acmecorp.com", "mail.acmecorp.com")).toBe(true);
});
