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
