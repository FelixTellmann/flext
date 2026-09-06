**2026-09-06** — triage-session evidence (reads, flag changes, replies) is pooled across all mailboxes over a rolling two-hour window before the two-event threshold is applied.

**Lost:** judging each mailbox's 15-minute sync window on its own, as built on 2026-08-27.

**Why:** five days of real usage produced zero sessions. The operator's pattern is one to three reads an hour spread across four mailboxes, so no single window ever held two events and every one was discarded as a possible phone preview. The threshold was right; the bucket was wrong.
