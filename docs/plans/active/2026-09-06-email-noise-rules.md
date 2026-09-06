# Email noise rules — spam, subscriptions, notifications, and the repairs found on the way

**Goal:** spam on tellmann.co.za is quarantined and marked read the moment it arrives and never deleted; subscriptions can be dropped in bulk from one page and from a Monday email; notifications leave the inbox read and filed; reference mail (travel, finances, clients) is filed flat where it can be found again.

**Decisions:** all settled on 2026-09-06 in `docs/decisions/2026-09-06-*.md`. Nothing here restates them.

**Spec:** none open. Every fork was closed in `docs/decisions/`.

**Precondition:** the deploy handover (`claude-run FLEXT-email-flow-improvements`) has run, `main` serves the engine, and this checkout is on `main`. Every phase below commits to `main` directly.

**Register:** calls made without asking go to `docs/plans/active/2026-09-06-email-noise-rules-decisions.txt`.

**Workflow from 2026-09-06 21:00 (operator's instruction, widget 3):** no handover files. The session runs every operator script itself after printing a dry-run summary table, batched at the end after phases 4 to 8 are built and committed. The session pushes `main`. The operator runs one command, `bun run db:migrate`, once, before that push. Anything build-blocking is asked at once.

## Global constraints

- No `any`; `type` over `interface`; named exports; Biome line width 140.
- Never run a dev server. Verify with `bun run tsc`, `bun test`, `bunx biome check <files>`.
- Never `db:push` / `db:migrate` / raw DML against the live database. Schema change: edit `server/db/schema.ts`, `bun run db:generate`, surface the SQL.
- A scheduled stage that writes to a mailbox needs a rescue path (re-opening a moved message suspends what moved it), and journals at `shadow` until the operator promotes it. Junk-to-Quarantine is the one exception, decided 2026-09-06: it moves mail the host already judged, into a folder we own, and marks it read.
- Every folder path is one segment. No rule may render a slash.

## Phases

Each phase is one subagent, fresh context, one commit, type-check and one review pass before the next starts.

### Phase 1 — repairs (done 2026-09-06, bd53165 + 7df567a, deployed 16:29 UTC)
- [x] IMAP auth failures disable a mailbox only after three consecutive failures on separate scheduled runs (`server/mail/errors.ts`, `server/mail/sync/run.ts`; a counter on `Mailbox`, migration 0018).
- [x] Session evidence pooled across all mailboxes over a rolling two-hour window before the two-event threshold applies (`server/mail/attention/session.ts`, `record.ts`, the call site in `sync/run.ts`). Tests from fixtures: three single reads across three mailboxes inside two hours make one session; one read alone does not.
- [ ] `bun tmp/attention-report.ts` shows sessions within a day of deploy.

### Phase 2 — Junk to Quarantine (done 2026-09-06, f9f223f + a47629c; first tick moved 1)
- [x] A stage in the incremental sync for generic mailboxes: any message whose folder is the host's Junk or spambucket is moved to Quarantine with `\Seen` set. Uses the existing quarantine plan shape (`pre_mutations` flag write, then move).
- [x] Journaled as an applied action with its own source so the journal page shows it and the inverse restores to Junk.
- [x] A keep-inbox address rule wins over it (a whitelisted false positive is never moved twice).

### Phase 3 — flat filing (code done 2026-09-06, 76f8433 + fe3844f; the two operator scripts are written and dry-run clean, not yet run)
- [x] `server/mail/filing/paths.ts` renders one segment: client rules to `<Client>`, topic rules to `<Topic>`; a rule carrying both renders the client. Slashes in `topic` are rejected at the ORPC boundary.
- [ ] Existing policies with nested topics (13, not 1) become their last segment (`tmp/flatten-filing-policies.ts --write`, runs AFTER the folder renames).
- [ ] Rename on the server: `Clients.Listify` to `Listify`, `Ops.Shopify` to `Shopify`, `Personal.Restaurants` to `Restaurants`, `Personal.Tennis` to `Tennis`, and the matching `Message.folder`, cursor, binding and action rows (`tmp/flatten-tellmann-folders.ts --write`). Handover file, DESTRUCTIVE step, 723 messages.
- [x] `/admin/filing` shows flat paths.

### Repairs found on the way (all done 2026-09-06, deployed)
- [x] The declined sweep journals only what it authored (2760c99); 675 duplicate proposals deleted.
- [x] tellmann.co.za UIDVALIDITY flip-and-revert: re-key planner resurrects vanished occupants (f64bd59).
- [x] `/api/mail-sync` acknowledges at once and runs in the background with a lock (76a8c53, 38413a7); Coolify tasks re-created with the reconcile at minute 7.

### Phase 4 — first contact, mark-read, per-mailbox autonomy for scheduled sources
Decisions: `2026-09-06-first-contact-human-or-machine.md`, `2026-09-06-scheduled-source-autonomy-per-mailbox.md`, `2026-09-06-mark-read-and-rule-scope.md`, `2026-09-06-declined-needs-action-archives.md`.
- [ ] `decide()` first-contact rung splits: human-shaped (`!is_bulk`, `!is_automated`, `dkim_aligned !== false`, `addressed_to_me`; done a12518c) returns `keep_inbox` with source `first_contact_human` (new `DecisionSource`); machine-shaped quarantines as today. Signals already in `deriveSignals`.
- [ ] `Mailbox` gains `first_contact_autonomy`, `settled_sweep_autonomy`, `declined_sweep_autonomy` (`shadow` | `auto`, default `shadow`) and the matching `*_autonomy_set_at` timestamps. Migration.
- [ ] A promotion path in the scheduled tick for source-carried rows: for each source at `auto` on the mailbox, shadow rows of that source whose message ARRIVED after `*_autonomy_set_at` (first contact only; the sweeps drain) move to `pending` under the same shared batch budget and the same affectedRows contract as `promoteAutoPolicies`. Rescue against a first-contact row suspends the mailbox's first-contact switch the way §1.11 suspends the sweeps.
- [ ] `SenderPolicy.mark_read` boolean (same migration). Executor: a `file` or `archive` row whose policy has `mark_read` carries the `\Seen` pre-mutation quarantine uses, and the stored-`is_seen` write from §1.5. Exposed on `/admin/senders` and `upsertPolicy`; refused on `keep_inbox` and `auto_trash`.
- [ ] Mailboxes admin page shows the three switches per mailbox with their set-at time.
- [ ] `tmp/rewrite-first-contact-backlog.ts` (dry-run, `--write`): re-runs the split over every shadow `first_contact` row and rewrites kind/source/reasons in place. Nothing deleted.
- [ ] `tmp/set-source-autonomy.ts` (dry-run, `--write`): tellmann `first_contact_autonomy = auto`; `settled_sweep_autonomy = auto` on all four. Run in the operator batch, after the deploy.

### Phase 4c — after the 4b review
Decision: `2026-09-06-clear-suspension-resets-the-window.md`.
- [ ] `Mailbox.first_contact_suspension_cleared_at` and `dwell_suspension_cleared_at` (migration); clearMailboxSuspension stamps them; rescue detection counts rescues since `max(now - 30d, cleared_at)` for each pair.
- [ ] The senders page's bulk-assign gets the same mark-read checkbox as single assign (today bulk silently resets it).

### Phase 5 — the rules themselves
- [ ] `tmp/create-noise-policies.ts`, dry-run by default, `--write` to apply, idempotent against rows that exist (noreply-iam@booking.com is also in `create-throwaway-policies.ts`). Domain rules: logalert.app, github.com, npmjs.com, vercel.com, planetscale.com, wakatime.com to `Notifications`, mark read. booking.com domain to `Travel`; `noreply-iam@booking.com` address to `auto_trash`. fnb.co.za, standardbank.co.za, bobpay.co.za to `Finances`.
- [ ] `tmp/promote-reference-policies.ts`: Housing and VitaminShoppe rules from 2026-08-26 to `auto` via `promotePolicyAutonomy`.
- [ ] Every rule starts `shadow`; the dry run prints, as a table, what each would have done to the last 30 days.
- [ ] The dry-run table for `flatten-tellmann-folders.ts` and `flatten-filing-policies.ts` is shown to the operator before the batch; both run in the batch, folders first.

### Phase 6 — one-click unsubscribe
Decision: `2026-09-06-unsubscribe-button-and-digest-links.md`.
- [ ] Fetch and store `List-Unsubscribe-Post` (new header in `providers/headers.ts`, column on `Message`, migration, reclassify backfill).
- [ ] `UnsubscribeAttempt` table (sender address, mailbox, method `http` | `mailto`, status, response code, attempted_at). Migration.
- [ ] ORPC `unsubscribeBulk`: per ticked sender, POST `List-Unsubscribe=One-Click` from the server (mailto senders wait for phase 7's sender); record the attempt; upsert an `archive` rule for the address and promote it to `auto`; journal `pending` archive rows (mark read) for the sender's inbox messages and apply them through the same path `/admin` uses for operator-approved rows.
- [ ] `/admin/unsubscribe` gains checkboxes, select-all for the one-click group, one button, and the last attempt's outcome per row.

### Phase 7 — SMTP and the Monday digest
Decisions: `2026-09-06-sending-account-and-digest.md`, `2026-09-06-unsubscribe-button-and-digest-links.md`.
- [x] `server/mail/send/` (1934cbd): SMTP over 465 to mail.tellmann.co.za with the mailbox's stored credentials and the same SPKI pin. One function: `sendMail`.
- [ ] Mail-to unsubscribes send through it, always from felix@tellmann.co.za, recorded like the http ones.
- [ ] `/api/mail-digest`: bearer-secret endpoint (shared helper, register entry); renders senders unopened for 30 days by volume (register entry for the exact set); each row carries a signed `unsubscribe` link (does what the button does) and a signed `file` link (creates a watch-only archive rule); sends to felix@tellmann.co.za. Links valid 14 days. Coolify scheduled task, `0 5 * * 1` UTC = 07:00 Africa/Johannesburg.

### Phase 8 — admin surfaces (operator's extra scope, widget 5)
- [x] Sessions strip on `/admin` (6194577): when the system last believed the operator was reading mail, on what evidence, in which mailboxes.
- [ ] `/admin/review`: one page folding together rules waiting to be switched on (top 10 by waiting count, one Switch-on button each), proposals waiting for approval grouped by rule with Approve-all / Dismiss per group, the sessions strip, and unsubscribe candidates with checkboxes and one button. Sketch: `docs/mockups/2026-09-06-first-contact-proposals/index.html`, section 5. Old pages stay.
- [x] `/admin/promote` defaults to the top 10 with samples collapsed (a03c63b).

### Review
- [ ] One review agent over the whole diff: cross-phase assumptions, duplicated helpers, convention drift, and the question for each phase: would a fix commit follow this?

### Deploy and operator batch (session-run, after the review)
- [ ] Operator runs `bun run db:migrate` once. Session pushes `main`, verifies the engine after the next quarter-hour tick.
- [ ] Batch, in this order, each with a dry-run table first: duplicate count (expect 0); `flatten-tellmann-folders.ts --write`; `flatten-filing-policies.ts --write`; `create-noise-policies.ts --write`; `promote-reference-policies.ts --write`; clear the mailer@shopify.com suspension; `set-source-autonomy.ts --write`; `record-trash-retention.ts --write`; `create-throwaway-policies.ts --write`; `draft-rules.ts --write`; POST `mode=reclassify` last.
- [ ] Coolify: add the Monday digest task, narrated in the browser.
- [ ] GitHub: disconnect the dead Vercel integration, narrated in the browser.
- [ ] `git mv` this plan to `docs/plans/completed/` with the closing marker.
