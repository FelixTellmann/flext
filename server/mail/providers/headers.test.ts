import { expect, test } from "bun:test";
import { extractAddresses, HEADER_FETCH_SPEC, headerValue, headerValues, parseHeaderBlock } from "./headers";

test("the fetch spec always peeks", () => {
  expect(HEADER_FETCH_SPEC.startsWith("BODY.PEEK[HEADER.FIELDS (")).toBe(true);
  expect(HEADER_FETCH_SPEC).toContain("DELIVERED-TO");
  expect(HEADER_FETCH_SPEC).toContain("AUTHENTICATION-RESULTS");
});

test("folded header lines are unfolded into a single value", () => {
  const raw = Buffer.from("List-Unsubscribe: <https://example.com/u>,\r\n <mailto:u@example.com>\r\n\r\n", "utf8");

  expect(headerValue(parseHeaderBlock(raw), "list-unsubscribe")).toBe("<https://example.com/u>, <mailto:u@example.com>");
});

test("repeated headers keep every value in order", () => {
  const raw = Buffer.from("Delivered-To: a@example.com\r\nDelivered-To: b@example.com\r\n", "utf8");

  expect(headerValues(parseHeaderBlock(raw), "Delivered-To")).toEqual(["a@example.com", "b@example.com"]);
});

test("an absent header block parses to an empty map", () => {
  expect(parseHeaderBlock(undefined)).toEqual({});
});

test("addresses are extracted from angle brackets and bare lists alike", () => {
  expect(extractAddresses('"Felix T" <Felix@Example.com>, ops@example.com')).toEqual(["felix@example.com"]);
  expect(extractAddresses("Felix@Example.com, ops@example.com")).toEqual(["felix@example.com", "ops@example.com"]);
});
