import { describe, expect, test } from "bun:test";
import { parseCopyUid, zipCopyUid } from "@server/mail/actions/copyuid";

describe("parseCopyUid", () => {
  test("a single UID on each side", () => {
    expect(parseCopyUid("A1 OK [COPYUID 38505 5 105] Completed")).toEqual({
      uidvalidity: 38505,
      source_set: [5],
      destination_set: [105],
    });
  });

  test("a contiguous range on each side", () => {
    expect(parseCopyUid("* OK [COPYUID 1 10:12 200:202]")).toEqual({
      uidvalidity: 1,
      source_set: [10, 11, 12],
      destination_set: [200, 201, 202],
    });
  });

  test("mixed singles and ranges, RFC 4315's own example shape", () => {
    expect(parseCopyUid("[COPYUID 38505 304,319:320 3956:3958,3960]")).toEqual({
      uidvalidity: 38505,
      source_set: [304, 319, 320],
      destination_set: [3956, 3957, 3958, 3960],
    });
  });

  test("out-of-order UIDs are kept in the order the server sent them, not sorted", () => {
    expect(parseCopyUid("[COPYUID 1 9,1,5 109,101,105]")).toEqual({
      uidvalidity: 1,
      source_set: [9, 1, 5],
      destination_set: [109, 101, 105],
    });
  });

  test("a descending range expands in the direction it was sent, not ascending", () => {
    expect(parseCopyUid("[COPYUID 1 5:3 105:103]")).toEqual({
      uidvalidity: 1,
      source_set: [5, 4, 3],
      destination_set: [105, 104, 103],
    });
  });

  test("a large range expands fully and in order without being capped or truncated", () => {
    const parsed = parseCopyUid("[COPYUID 1 1:100000 500001:600000]");
    expect(parsed.source_set.length).toBe(100000);
    expect(parsed.destination_set.length).toBe(100000);
    expect(parsed.source_set[0]).toBe(1);
    expect(parsed.source_set[99999]).toBe(100000);
    expect(parsed.destination_set[0]).toBe(500001);
    expect(parsed.destination_set[99999]).toBe(600000);
  });

  test("no COPYUID code in the response is a hard error, not an empty result", () => {
    expect(() => parseCopyUid("A1 OK Completed")).toThrow(/no COPYUID response code/);
  });

  test("a malformed uid-set token is a hard error", () => {
    expect(() => parseCopyUid("[COPYUID 1 1,x,3 101,102,103]")).toThrow(/is not a UID or a UID range/);
  });
});

describe("zipCopyUid", () => {
  test("pairs source and destination UIDs positionally, preserving given order", () => {
    expect(zipCopyUid([9, 1, 5], [109, 101, 105])).toEqual([
      { source_uid: 9, destination_uid: 109 },
      { source_uid: 1, destination_uid: 101 },
      { source_uid: 5, destination_uid: 105 },
    ]);
  });

  test("an empty set on both sides zips to no pairs, not an error", () => {
    expect(zipCopyUid([], [])).toEqual([]);
  });

  test("a length mismatch raises rather than silently truncating to the shorter side", () => {
    expect(() => zipCopyUid([1, 2, 3], [101, 102])).toThrow(/3 UID\(s\).*2/);
    expect(() => zipCopyUid([1], [101, 102])).toThrow(/1 UID\(s\).*2/);
  });

  test("parseCopyUid and zipCopyUid compose end to end", () => {
    const parsed = parseCopyUid("[COPYUID 38505 304,319:320 3956:3958]");
    expect(zipCopyUid(parsed.source_set, parsed.destination_set)).toEqual([
      { source_uid: 304, destination_uid: 3956 },
      { source_uid: 319, destination_uid: 3957 },
      { source_uid: 320, destination_uid: 3958 },
    ]);
  });
});
