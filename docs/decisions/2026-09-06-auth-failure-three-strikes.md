**2026-09-06** — an IMAP authentication failure disables a mailbox only after three consecutive failures on separate scheduled runs.

**Lost:** disabling on the first failure.

**Why:** on 2026-09-04 xneelo refused connections for an hour, then answered one login with an auth error, and the mailbox stayed off for two days with the stored password still valid. Auth errors from that host are not evidence of a changed password until they repeat.
