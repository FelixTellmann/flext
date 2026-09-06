# Email noise rules — spam, subscriptions, notifications, and the repairs found on the way

**Goal:** spam on tellmann.co.za is quarantined and marked read the moment it arrives and never deleted; subscriptions can be dropped in bulk from one page and from a Monday email; notifications leave the inbox read and filed; reference mail (travel, finances, clients) is filed flat where it can be found again.

**Decisions:** all settled on 2026-09-06 in `docs/decisions/2026-09-06-*.md`. Nothing here restates them.

**Spec:** none open. Every fork was closed in `docs/decisions/`.

**Precondition:** the deploy handover (`claude-run FLEXT-email-flow-improvements`) has run, `main` serves the engine, and this checkout is on `main`. Every phase below commits to `main` directly.

**Register:** calls made without asking go to `docs/plans/active/2026-09-06-email-noise-rules-decisions.txt`.

## Global constraints

- No `any`; `type` over `interface`; named exports; Biome line width 140.
- Never run a dev server. Verify with `bun run tsc`, `bun test`, `bunx biome check <files>`.
- Never `db:push` / `db:migrate` / raw DML against the live database. Schema change: edit `server/db/schema.ts`, `bun run db:generate`, surface the SQL.
- A scheduled stage that writes to a mailbox needs a rescue path (re-opening a moved message suspends what moved it), and journals at `shadow` until the operator promotes it. Junk-to-Quarantine is the one exception, decided 2026-09-06: it moves mail the host already judged, into a folder we own, and marks it read.
- Every folder path is one segment. No rule may render a slash.

## Phases

Each phase is one subagent, fresh context, one commit, type-check and one review pass before the next starts.

### Phase 1 — repairs
- [ ] IMAP auth failures disable a mailbox only after three consecutive failures on separate scheduled runs (`server/mail/errors.ts`, `server/mail/sync/run.ts`; a counter on `Mailbox`, migration).
- [ ] Session evidence pooled across all mailboxes over a rolling two-hour window before the two-event threshold applies (`server/mail/attention/session.ts`, `record.ts`, the call site in `sync/run.ts`). Tests from fixtures: three single reads across three mailboxes inside two hours make one session; one read alone does not.
- [ ] `bun tmp/attention-report.ts` shows sessions within a day of deploy.

### Phase 2 — Junk to Quarantine
- [ ] A stage in the incremental sync for generic mailboxes: any message whose folder is the host's Junk or spambucket is moved to Quarantine with `\Seen` set. Uses the existing quarantine plan shape (`pre_mutations` flag write, then move).
- [ ] Journaled as an applied action with its own source so the journal page shows it and the inverse restores to Junk.
- [ ] A keep-inbox address rule wins over it (a whitelisted false positive is never moved twice).

### Phase 3 — flat filing
- [ ] `server/mail/filing/paths.ts` renders one segment: client rules to `<Client>`, topic rules to `<Topic>`; a rule carrying both renders the client. Slashes in `topic` are rejected at the ORPC boundary.
- [ ] Existing policy `noreply@booking.com` topic `Personal/Travel` becomes `Travel` (script, `--write`).
- [ ] Rename on the server: `Clients.Listify` to `Listify`, `Ops.Shopify` to `Shopify`, `Personal.Restaurants` to `Restaurants`, `Personal.Tennis` to `Tennis`, and the matching `Message.folder` rows. Handover file, DESTRUCTIVE step, 723 messages.
- [ ] `/admin/filing` shows flat paths.

### Phase 4 — first contact and mark-read rules
- [ ] `decide()` first-contact rung splits: human-shaped stays (`keep_inbox`, source `first_contact_human`), machine-shaped quarantines. Signals already exist: `is_bulk`, `is_automated`, `dkim_aligned`, `addressed_to_me`.
- [ ] `SenderPolicy.mark_read` boolean (migration). When set, `file` and `archive` plans carry the same `\Seen` pre-mutation quarantine uses. `/admin/senders` exposes it.
- [ ] Promote first-contact quarantine to `auto` for felix@tellmann.co.za only (script, `--write`).

### Phase 5 — the rules themselves
- [ ] Scripts, dry-run by default, `--write` to apply. Domain rules: logalert.app, github.com, npmjs.com, vercel.com, planetscale.com, wakatime.com to `Notifications`, mark read. booking.com domain to `Travel`; `noreply-iam@booking.com` address to `auto_trash`. fnb.co.za, standardbank.co.za, bobpay.co.za to `Finances`. Housing and VitaminShoppe rules from 2026-08-26 promoted.
- [ ] Every rule starts `shadow`; the script prints what each would have done to the last 30 days before `--write`.

### Phase 6 — one-click unsubscribe
- [ ] Fetch and store `List-Unsubscribe-Post` (new header in `providers/headers.ts`, column on `Message`, migration, reclassify backfill).
- [ ] ORPC `unsubscribeBulk`: for each selected sender with a one-click target, POST `List-Unsubscribe=One-Click` from the server; record the outcome on the sender. Mail-to targets wait for phase 7.
- [ ] `/admin/unsubscribe` gains checkboxes, select-all for the one-click group, one button.

### Phase 7 — SMTP and the Monday digest
- [ ] `server/mail/send/` : SMTP over 465 to mail.tellmann.co.za with the mailbox's stored credentials and the same SPKI pin. One function: `sendMail`.
- [ ] Mail-to unsubscribes send through it.
- [ ] `/api/mail-digest`: bearer-secret endpoint; renders senders unopened for 30 days by volume, each row with a signed `unsubscribe` and `file` link back to the server; sends to felix@tellmann.co.za. Coolify scheduled task, Monday 07:00.

### Review
- [ ] One review agent over the whole diff: cross-phase assumptions, duplicated helpers, convention drift, and the question for each phase: would a fix commit follow this?
