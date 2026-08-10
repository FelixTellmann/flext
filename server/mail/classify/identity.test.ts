import { expect, test } from "bun:test";
import { createIdentityMatcher, isAddressedToMe, isCcMe, normalizeAddress } from "./identity";

test("gmail plus-addressing normalizes to the base address, generic IMAP keeps it", () => {
  expect(normalizeAddress("Felix+Invoices@Gmail.com", "gmail")).toBe("felix@gmail.com");
  expect(normalizeAddress("Felix+Invoices@example.com", "generic")).toBe("felix+invoices@example.com");
});

test("a gmail matcher recognises a plus-alias of a listed address", () => {
  const matcher = createIdentityMatcher({ patterns: ["felix@gmail.com"], flavor: "gmail" });

  expect(matcher.matches("felix+receipts@gmail.com")).toBe(true);
  expect(matcher.matches("someoneelse@gmail.com")).toBe(false);
});

test("a catch-all pattern matches any local part on the domain", () => {
  const matcher = createIdentityMatcher({ patterns: ["*@flext.dev"], flavor: "generic" });

  expect(matcher.matches("anything@flext.dev")).toBe(true);
  expect(matcher.matches("anything@other.dev")).toBe(false);
});

test("Delivered-To alone is enough to count as addressed to me", () => {
  const matcher = createIdentityMatcher({ patterns: ["felix@flext.dev"], flavor: "generic" });

  expect(isAddressedToMe({ to: ["list@example.com"], delivered_to: ["felix@flext.dev"], x_original_to: [] }, matcher)).toBe(true);
  expect(isAddressedToMe({ to: ["list@example.com"], delivered_to: [], x_original_to: [] }, matcher)).toBe(false);
});

test("Cc is tracked separately from addressed-to-me", () => {
  const matcher = createIdentityMatcher({ patterns: ["felix@flext.dev"], flavor: "generic" });

  expect(isCcMe(["felix@flext.dev"], matcher)).toBe(true);
  expect(isAddressedToMe({ to: [], delivered_to: [], x_original_to: [] }, matcher)).toBe(false);
});
