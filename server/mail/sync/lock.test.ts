import { expect, test } from "bun:test";
import { STALE_SYNC_LOCK_MS, tryAcquireSyncLock } from "./lock";

const T0 = Date.UTC(2026, 8, 6, 14, 45, 1);

test("acquire, release, acquire again", () => {
  const first = tryAcquireSyncLock("incremental", T0);
  expect(first.acquired).toBe(true);
  if (!first.acquired) {
    return;
  }
  first.release();

  const second = tryAcquireSyncLock("incremental", T0 + 1000);
  expect(second.acquired).toBe(true);
  if (second.acquired) {
    second.release();
  }
});

test("a second acquire while held is refused and names the holder", () => {
  const first = tryAcquireSyncLock("reclassify", T0);
  expect(first.acquired).toBe(true);

  const second = tryAcquireSyncLock("incremental", T0 + 5000);
  expect(second).toEqual({ acquired: false, held: { mode: "reclassify", started_at: new Date(T0).toISOString() } });

  if (first.acquired) {
    first.release();
  }
});

test("a lock older than the stale window is treated as free", () => {
  expect(STALE_SYNC_LOCK_MS).toBe(2 * 60 * 60 * 1000);

  const crashed = tryAcquireSyncLock("backfill", T0);
  expect(crashed.acquired).toBe(true);

  // A full backfill runs every mailbox in sequence and can pass 30 minutes; it must still hold the lock.
  const still_held = tryAcquireSyncLock("incremental", T0 + 45 * 60 * 1000);
  expect(still_held.acquired).toBe(false);

  const still_held_at_edge = tryAcquireSyncLock("incremental", T0 + STALE_SYNC_LOCK_MS - 1);
  expect(still_held_at_edge.acquired).toBe(false);

  const taken_over = tryAcquireSyncLock("incremental", T0 + STALE_SYNC_LOCK_MS);
  expect(taken_over.acquired).toBe(true);

  // The stale holder's release must not free the lock the new run now owns.
  if (crashed.acquired) {
    crashed.release();
  }
  const refused = tryAcquireSyncLock("incremental", T0 + STALE_SYNC_LOCK_MS + 1);
  expect(refused.acquired).toBe(false);

  if (taken_over.acquired) {
    taken_over.release();
  }
});
