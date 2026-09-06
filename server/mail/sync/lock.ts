import type { SyncMode } from "@server/mail/types";

export type HeldSyncLock = { mode: SyncMode; started_at: string };

export type SyncLockResult = { acquired: true; release: () => void } | { acquired: false; held: HeldSyncLock };

// The lock is module state, so a process that dies frees it by dying; this window only covers a promise
// that hangs and never settles. Two hours clears a full backfill (about 600 s per 10k-message mailbox, run in sequence).
export const STALE_SYNC_LOCK_MS = 2 * 60 * 60 * 1000;

let held: (HeldSyncLock & { started_ms: number }) | null = null;

export function tryAcquireSyncLock(mode: SyncMode, now_ms: number = Date.now()): SyncLockResult {
  if (held !== null && now_ms - held.started_ms < STALE_SYNC_LOCK_MS) {
    return { acquired: false, held: { mode: held.mode, started_at: held.started_at } };
  }

  const lock = { mode, started_at: new Date(now_ms).toISOString(), started_ms: now_ms };
  held = lock;

  return {
    acquired: true,
    release: () => {
      if (held === lock) {
        held = null;
      }
    },
  };
}
