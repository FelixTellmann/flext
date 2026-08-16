import { expect, test } from "bun:test";
import { batchUidRanges, buildUidRange, dropStaleUids, highestUid } from "./uid-range";

test("the incremental range starts one past the cursor", () => {
  expect(buildUidRange(1200)).toBe("1201:*");
  expect(buildUidRange(0)).toBe("1:*");
});

test("a server echoing the highest UID for an out-of-range request is filtered out", () => {
  const returned = [{ uid: 1200 }];

  expect(dropStaleUids(returned, 1200)).toEqual([]);
  expect(dropStaleUids([{ uid: 1201 }], 1200)).toEqual([{ uid: 1201 }]);
});

test("highestUid falls back when nothing came back", () => {
  expect(highestUid([], 1200)).toBe(1200);
  expect(highestUid([{ uid: 1201 }, { uid: 1205 }], 1200)).toBe(1205);
});

test("backfill ranges cover 1..uid_next-1 in batches", () => {
  expect(batchUidRanges({ uid_next: 1201, batch_size: 500 })).toEqual(["1:500", "501:1000", "1001:1200"]);
  expect(batchUidRanges({ uid_next: 1, batch_size: 500 })).toEqual([]);
});

test("a resumed backfill skips everything below its checkpoint", () => {
  expect(batchUidRanges({ uid_next: 1201, batch_size: 500, from_uid: 501 })).toEqual(["501:1000", "1001:1200"]);
  expect(batchUidRanges({ uid_next: 1201, batch_size: 500, from_uid: 1300 })).toEqual([]);
  expect(batchUidRanges({ uid_next: 1201, batch_size: 500, from_uid: 0 })).toEqual(["1:500", "501:1000", "1001:1200"]);
});
