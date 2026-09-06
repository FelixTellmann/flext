import type { SyncMode } from "@server/mail/types";

export type HeldSyncLock = { mode: SyncMode; started_at: string };

export type SyncLockResult = { acquired: true; release: () => void } | { acquired: false; held: HeldSyncLock };

// A run that crashed without reaching its finally (process killed mid-sync, container restart) would
// otherwise hold the lock until the next deploy; nothing legitimate runs longer than this.
export const STALE_SYNC_LOCK_MS = 30 * 60 * 1000;

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
