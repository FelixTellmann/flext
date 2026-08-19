# Email Suite Phase 3: Rules + Shadow — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decide what should happen to every message — as a pure function over stored signals and operator-created policy — and journal those decisions without touching a single mailbox.

**Architecture:** `server/mail/classify/rules.ts` and `guards.ts` join `signals.ts` (built in Phase 2) as pure, IO-free modules; together they answer `(signals, policy, thread_state, guards) → decision`. Five new tables carry operator intent (`sender_policy`, `never_touch_rule`, `sender_suppression`, `thread_state`) and the decision journal (`action`). A shadow runner walks stored messages and writes `action` rows with `status = 'shadow'` — no IMAP connection is opened at any point in this phase. Three surfaces gain write paths: Needs Action gets snooze/done/dismiss, Sender Policy gets policy assignment and guard-suppression display, and a new Shadow Report shows what a policy would have done.

**Tech Stack:** Drizzle + `mysql2` (MySQL 8.4 on Coolify), ORPC + Zod v3, TanStack Start file routes with `validateSearch`, Tailwind v3, `bun test` for the pure modules.

**Spec:** `docs/plans/specs/active/2026-07-27-email-management-design.md` — §1.9 (Needs Action + the feedback loop), §3 (data model), §5 in full (signals, resolution order, scoped guards, derived defaults), §8 (autonomy ladder, rescue detection), §9 (surfaces).

## Global Constraints

- **Never run `bun run dev`** or any watch/long-running server. Verification is `bun run tsc`, `bunx biome check --fix <file>`, `bun test <file>`, and `bun run build` where the route tree must regenerate.
- **Never run `bun run db:push`, `db:migrate`, or any INSERT/UPDATE/DELETE against the database.** Schema changes: edit `server/db/schema.ts`, run `bun run db:generate`, then surface the generated SQL for the operator to apply. `DATABASE_URL`, `DATABASE_URL_DEV` and `DATABASE_URL_PROD` all point at the **same production** MySQL.
- **This phase opens no mailbox.** Shadow classification runs entirely over stored metadata; that is what makes it free and risk-free (§2). There is no reason for any file in this phase to import a provider. The five read-only-contract greps must stay clean.
- **Nothing in this phase mutates a mailbox, and no `action` row may reach `status = 'pending'` or `'applied'`.** Shadow is the only status this phase writes for decisions. The executor is Phase 4.
- TypeScript strict + `verbatimModuleSyntax`; `import type` for type-only imports. No `any` — `unknown` plus narrowing.
- Named exports only, never `export default`. `type` over `interface`. Functions over classes. Two `if` blocks over `if/else` unless trivial.
- Biome: line width 140, double quotes, spaces. Run `bunx biome check --fix <file>` after editing.
- Comments: default to none. Only a non-obvious *why* earns one. Never narrate the edit.
- `snake_case` variables and object fields, `camelCase` functions.
- DB tables PascalCase, columns camelCase passed explicitly as strings, `updatedAt` has no DB default and must be set on every insert.
- **UI conventions, verified in Phase 2:** `clsx()` inline in the JSX prop (never `cn()`, never a template literal); top-level route components are plain `function` declarations, not arrow `FC`; shared primitives come from `src/routes/admin/-ui.tsx`; `bg-accent` must never pair with `text-accent-contrast` (same RGB, invisible text); grep `tailwind.config.mjs` for a token before any sized or coloured class, and bare `Npx` suffixes are invalid; interactive controls must be real `<button>`/`<input>` with a `focus-visible:ring-2 focus-visible:ring-info`, because Biome's `useSemanticElements` rejects ARIA roles standing in for elements.
- Git: never `git add -A` / `git add .` — stage specific files by name. No `Co-Authored-By`. Never push to `main`. **This repository has concurrent sessions**: other agents edit unrelated files in the same working tree, so always `git diff <file>` in an earlier tool call than the commit, and commit pathspec-limited.

## What Phase 2 already delivered that this phase builds on

- `server/mail/classify/signals.ts` — `deriveSignals(input): MessageSignals` and `volumeBucket`, pure and tested. `BULK_PRECEDENCE_VALUES` is the single source of the bulk-precedence rule, consumed by both the pure function and the SQL in `server/mail/query/signal-sql.ts`. **Rules must consume this module, never re-derive a signal.** Phase 2's final review found the same rule implemented three ways and two of them disagreeing; do not reintroduce that.
- `server/mail/query/senders.ts` — `listSenders`, `getSenderProfile`, `getDashboardSummary`.
- `server/mail/query/needs-action.ts` — `listNeedsAction({ mailbox_id, max_age_days, limit, offset })`, one row per thread via `ROW_NUMBER() OVER (PARTITION BY group_key ORDER BY internalDate DESC, id DESC)`, with `reasons`.
- `/admin/senders` and `/admin/needs-action`, both read-only, with URL-param state.

## Live data this phase must work against (measured 2026-08-18, after the operator run)

| Fact | Value |
|---|---|
| Messages | ~14,600 across four mailboxes |
| Senders | 1,749, of which **1,394 have never been replied to** |
| Needs Action, 30-day window | 611 threads |
| Needs Action, unfiltered | 7,694 threads |
| Top 100 senders | 69% of all mail |

**Two facts that change the design and are easy to get wrong:**

1. **`dkim_aligned` is null on most of `felix@tellmann.co.za`** — 9,443 of ~10,100 rows, because its xneelo/Dovecot server does not stamp `Authentication-Results`. A rule that treats null as "failed" would mis-handle the largest mailbox. Null means *unknown* and must never itself trigger a destructive decision.
2. **The Needs Action queue is 7,694 threads unfiltered** precisely because §1.9's predicate is missing `thread_state` and `sender_suppression`. This phase adds both, and the queue shrinking is the measurable outcome — record the before number and compare.

## Seed data already prepared

`tmp/2026-08-18-mail-triage-run-1.md` (gitignored) contains a hand-built classification of **90 senders covering 7,056 messages, 49% of all mail**, grouped into archive-safe, file-to-records, and keep-in-inbox sets, each with a rationale. That document was produced by the same reasoning `sender_policy` encodes, and Task 12 imports it as seed rows — all at autonomy `shadow`, per §8, exactly as if a human had entered them.

## File structure

| File | Responsibility |
|---|---|
| `server/db/schema.ts` | **Modify.** Five new tables: `sender_policy`, `never_touch_rule`, `sender_suppression`, `thread_state`, `action`. |
| `server/mail/classify/guards.ts` | **New.** Pure. `§5.3`'s three absolute and three scoped guards, returning which action classes each blocks. |
| `server/mail/classify/guards.test.ts` | **New.** Fixture set per guard, including the scoping that Phase 3 exists to get right. |
| `server/mail/classify/rules.ts` | **New.** Pure. `§5.2` resolution order and `§5.4` derived defaults over signals + policy + thread state + guards. |
| `server/mail/classify/rules.test.ts` | **New.** Golden-file style: header/policy fixtures in, expected decisions out, no database. |
| `server/mail/shadow/run.ts` | **New.** Walks stored messages, applies `rules.ts`, writes `action` rows with `status = 'shadow'`. No IMAP. |
| `server/mail/query/policies.ts` | **New.** Reads and writes `sender_policy`, `never_touch_rule`, `sender_suppression`. |
| `server/mail/query/shadow.ts` | **New.** `getShadowReport(policy_id)` and the aggregate counts for the report surface. |
| `server/mail/query/threads.ts` | **New.** `thread_state` writes: snooze, done, dismiss. |
| `server/mail/query/needs-action.ts` | **Modify.** Add the two missing `§1.9` clauses now that their tables exist. |
| `server/orpc/mail.ts` | **Modify.** Policy CRUD, thread actions, shadow report, shadow run trigger. |
| `src/routes/admin/senders.tsx` | **Modify.** Policy and autonomy columns, bulk assignment, guard-suppression rendering. |
| `src/routes/admin/needs-action.tsx` | **Modify.** Snooze / done / "shouldn't be here" controls. |
| `src/routes/admin/shadow.tsx` | **New.** The shadow report surface. |

## Deliberately out of scope

- **The executor.** No `action` row leaves `shadow`. Applying decisions, `COPYUID` handling, undo and the Action Journal are Phase 4 (§7).
- **Filing and clients.** `sender_policy.client` exists as a nullable column so Phase 5 can populate it, but there is no `client` table, no folder resolution and no DKIM filing gate here (§6).
- **Autonomy promotion.** `sender_policy.autonomy` is written and displayed, but nothing may set it to `auto` in this phase — promotion needs the executor to promote *into*. §8's rescue detection lands with Phase 6.
- **`last_in_thread_is_mine`.** Phase 2's review established that the Sent-folder exclusion does not implement it. `thread_state` gives the machinery to do it properly; if it does not fit cleanly inside a task here, leave it to Phase 4 rather than claiming an approximation again.

---

### Task 1: The five tables

**Files:**
- Modify: `server/db/schema.ts`
- Generated: `server/db/migrations/0003_*.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: `senderPolicy`, `neverTouchRule`, `senderSuppression`, `threadState`, `action` Drizzle tables, imported by every later task.

Follow the existing table conventions exactly: PascalCase table names, camelCase columns passed as explicit strings, `id` as `varchar(191)` primary key defaulting to `(UUID())`, `createdAt` defaulting to `CURRENT_TIMESTAMP(3)`, and `updatedAt` with **no** DB default.

**`sender_policy`** — scope (`address` | `domain`), value, action (`keep_inbox` | `archive` | `file` | `auto_trash`), nullable `client` and `topic`, autonomy (`shadow` | `propose` | `auto`, defaulting to `shadow`), source (`operator` | `proposal` | `derived`), `suspended_at`, `suspension_reason`. Unique on `(scope, value)`.

**`never_touch_rule`** — kind (`address` | `domain` | `subject_pattern`), value, note.

**`sender_suppression`** — `sender_address`, `reason`, `created_at`. Written by Needs Action dismissals (§1.9).

**`thread_state`** — `thread_key`, `mailbox_id`, state (`open` | `snoozed` | `done` | `dismissed`), `snoozed_until`. Unique on `(mailbox_id, thread_key)`.

**`action`** — the single journal for both shadow and (later) real decisions: `message_id`, `sender_policy_id` (nullable), `kind` (the decision), `status` (`shadow` | `pending` | `applied` | `failed` | `undone`), `from_state_json`, `to_state_json`, `run_id`, `decided_at`, `applied_at`, `error`.

Two columns are load-bearing beyond this phase and must exist now even though Phase 3 only writes the first: **`sender_policy_id` on every row** is what makes §7's bulk-undo-by-rule and §10's `get_shadow_report(policy_id)` possible at all, and `from_state_json` is what makes Phase 4's undo an exact restore rather than a reconstruction.

Index `action` on `(status, decided_at)` and on `sender_policy_id`; index `thread_state` on `(state, snoozed_until)`.

- [ ] **Step 1: Add the five tables to `server/db/schema.ts`**

- [ ] **Step 2: Generate the migration**

Run: `bun run db:generate`
Expected: a single `0003_*.sql` containing five `CREATE TABLE` statements and their indexes, and nothing else. If it contains an `ALTER` or `DROP` against an existing table, STOP and report BLOCKED with the full SQL — the schema file has drifted from the live database.

- [ ] **Step 3: Verify and surface**

Run: `bun run tsc && bunx biome check --fix server/db/schema.ts && cat server/db/migrations/0003_*.sql`
Print the SQL for the operator. **Do not run `db:migrate`.**

- [ ] **Step 4: Commit**

```bash
git diff server/db/schema.ts
git add server/db/schema.ts server/db/migrations && git commit -m "feat: add the policy, guard and decision-journal tables" -- server/db/schema.ts server/db/migrations
```

---

### Task 2: Guards, as pure functions

**Files:**
- Create: `server/mail/classify/guards.ts`
- Create: `server/mail/classify/guards.test.ts`

**Interfaces:**
- Consumes: `MessageSignals` from `@server/mail/classify/signals`.
- Produces:
  - `type ActionClass = "keep_inbox" | "archive" | "file" | "auto_trash" | "purge"`
  - `type GuardName = "flagged" | "too_recent" | "never_touch" | "replied_in_thread" | "derived_allowlist" | "human_attachment"`
  - `type GuardVerdict = { name: GuardName; blocks: ActionClass[]; absolute: boolean }`
  - `evaluateGuards(input: GuardInput): GuardVerdict[]` — every guard that fired, with what it blocks.
  - `isBlocked(verdicts: GuardVerdict[], action: ActionClass, policy_is_explicit_address: boolean): GuardName | null`

**§5.3 is the single most important table in this phase, and an earlier draft of the spec got it wrong in a way that would have silently deleted half the product.** Read it before writing code.

| Guard | Blocks | Absolute |
|---|---|---|
| Flagged or starred | everything | yes |
| Arrived < 24 hours ago | everything | yes |
| Matches a `never_touch_rule` | everything | yes |
| We have sent a message in this thread | `archive`, `trash`, `purge` — **not** `file` | no |
| Sender in derived allowlist (we emailed them first) | `trash`, `purge` | no |
| Attachment from a human sender | `trash`, `purge` | no |

The three scoped guards protect against *destruction*, not *organisation* — filing an active client thread is the intended behaviour, trashing it is not. **An explicit address-level policy outranks the scoped guards but never the absolute ones**, which is what `policy_is_explicit_address` expresses. A domain-level policy does not get that override.

- [ ] **Step 1: Write the module**

- [ ] **Step 2: Write the tests**

One fixture per guard proving it fires, one proving it does not, and — the cases that matter most — a `file` decision surviving `replied_in_thread`, an `auto_trash` decision blocked by it, and an explicit address policy overriding a scoped guard while still being blocked by `flagged`.

- [ ] **Step 3: Verify**

Run: `bun test server/mail/classify/guards.test.ts && bun run tsc && bunx biome check --fix server/mail/classify/guards.ts server/mail/classify/guards.test.ts`

- [ ] **Step 4: Commit**

---

### Task 3: The rules engine

**Files:**
- Create: `server/mail/classify/rules.ts`
- Create: `server/mail/classify/rules.test.ts`

**Interfaces:**
- Consumes: `deriveSignals`/`MessageSignals` from `signals.ts`, `evaluateGuards`/`isBlocked` from `guards.ts`.
- Produces: `type Decision = { action: ActionClass | "needs_action"; source: "guard" | "thread_state" | "address_policy" | "domain_policy" | "derived" | "fallback"; policy_id: string | null; suppressed_by: GuardName | null; reasons: string[] }` and `decide(input: DecisionInput): Decision`.

**§5.2 resolution order, exactly:**

1. Absolute guards — override everything, including explicit policy
2. Thread state — `snoozed` or `done` suppresses
3. Address-level policy
4. Domain-level policy
5. Derived default
6. Fallback → `keep_inbox`

**Step 6 is the safety spine.** Anything unclassified is left alone; the system acts only where a policy explicitly says to, so silence is always the safe outcome. A `decide()` that can return anything other than `keep_inbox` when no rule matched is a Critical defect.

**§5.4 derived defaults** apply only where no explicit policy exists, and **can only ever produce `archive`, never `trash` or `purge`** — destruction requires a policy a human created:

| Condition | Decision |
|---|---|
| `is_bulk` or `is_automated`, `my_reply_count = 0`, `age_days > 30` | `archive` |
| `is_bulk` or `is_automated`, `my_reply_count = 0`, newer | `keep_inbox` (accrue evidence) |
| Needs-action signal set (§1.9) | `needs_action` |
| anything else | `keep_inbox` |

**`dkim_aligned` is a tri-state and null means unknown.** 9,443 rows on `felix@tellmann.co.za` are null because its server does not stamp `Authentication-Results`. Null must never itself justify a destructive decision; where a rule wants DKIM evidence and has none, it declines to act rather than assuming failure.

`suppressed_by` is not decoration: §5.3 requires the Sender Policy surface to render `suppressed by guard: <name>`, because an inert policy must never be indistinguishable from an active one.

- [ ] **Step 1: Write the module**

- [ ] **Step 2: Write the tests**

Golden-file style, per §12: fixture structs in, expected decisions out, no mail server and no database. Cover every branch of the resolution order, both derived-default rows, the fallback, and — explicitly — that no input combination yields `trash` or `purge` from a derived default.

- [ ] **Step 3: Verify**

Run: `bun test server/mail/classify/rules.test.ts && bun run tsc && bunx biome check --fix server/mail/classify/rules.ts server/mail/classify/rules.test.ts`

- [ ] **Step 4: Commit**

---

### Task 4: Policy storage

**Files:**
- Create: `server/mail/query/policies.ts`

**Interfaces:**
- Produces: `listPolicies(filter)`, `upsertPolicy(input)`, `deletePolicy(id)`, `listNeverTouchRules()`, `upsertNeverTouchRule(input)`, `deleteNeverTouchRule(id)`, `listSuppressions()`, `addSuppression(input)`, and `loadPolicyIndex()` returning `{ by_address: Map<string, PolicyRow>; by_domain: Map<string, PolicyRow>; never_touch: NeverTouchRow[]; suppressed: Set<string> }` for the shadow runner to consume once per run rather than per message.

**Every policy is born in `shadow` (§8), without exception** — `upsertPolicy` must not accept `autonomy: "auto"` in this phase. Reject it rather than silently downgrading, so a caller's mistake surfaces.

Keys are matched case-insensitively; store the operator's casing.

- [ ] **Step 1: Write the module**
- [ ] **Step 2: Read-only sanity check against production** — `loadPolicyIndex()` on an empty table returns empty maps without throwing.
- [ ] **Step 3: Verify** — `bun run tsc && bunx biome check --fix server/mail/query/policies.ts && bun test`
- [ ] **Step 4: Commit**

---

### Task 5: The shadow runner

**Files:**
- Create: `server/mail/shadow/run.ts`

**Interfaces:**
- Consumes: `decide` from `rules.ts`, `loadPolicyIndex` from `policies.ts`, `deriveSignals` from `signals.ts`.
- Produces: `runShadowPass({ mailbox_id, batch_size }): Promise<{ examined: number; journaled: number; by_decision: Record<string, number> }>`.

**This opens no mailbox.** It reads `Message` joined to `Sender`, computes a decision per row, and writes an `action` row with `status = 'shadow'`. That is exactly what makes shadow free and risk-free (§2): the identical pure function that Phase 4 will execute runs here over historical data with no mailbox access and no risk.

Requirements:
- Load the policy index **once per run**, not per message. There are ~14,600 messages and 1,749 senders.
- Batch inserts; the run must be re-runnable. Key `action` on `(message_id, kind, run_id)` so a retry cannot double-journal.
- Record `sender_policy_id` on every row where a policy drove the decision — §7's bulk-undo-by-rule and §10's shadow report both depend on it and neither can be written later without it.
- **No row may be written with any status other than `shadow`.** Assert it in code, not just by convention.
- Report `by_decision` counts so the operator sees the shape of the outcome immediately.

- [ ] **Step 1: Write the module**
- [ ] **Step 2: Verify** — `bun run tsc`, biome, `bun test`, plus the five read-only-contract greps, which must stay clean.
- [ ] **Step 3: Commit**

---

### Task 6: Thread state and suppression writes

**Files:**
- Create: `server/mail/query/threads.ts`
- Modify: `server/mail/query/needs-action.ts`

**Interfaces:**
- Produces: `snoozeThread({ mailbox_id, thread_key, until })`, `markThreadDone(...)`, `dismissThread({ mailbox_id, thread_key, sender_address, reason })`.

`dismissThread` writes **both** a `thread_state` row and a `sender_suppression` row — §1.9's growth path is that every "this shouldn't be here" dismissal generates training signal for free, which Claude Code later reviews to propose policy refinements.

Then add the two clauses `needs-action.ts` has been missing since Phase 2, now that their tables exist:

```
AND thread_state = 'open'          -- or absent; a snoozed thread returns when snoozed_until passes
AND sender NOT IN sender_suppression
```

Both must be real SQL applied before pagination and identically to the `total`, exactly as `max_age_days` is. Phase 2 found and fixed a post-fetch filtering bug in this file; do not reintroduce it.

**Record the queue size before and after.** It is 7,694 unfiltered and 611 at 30 days today; this task is the one that makes those numbers fall, and the drop is the phase's most legible outcome.

- [ ] **Step 1: Write `threads.ts`**
- [ ] **Step 2: Extend `needs-action.ts`, minimally**
- [ ] **Step 3: Verify, including read-only before/after counts**
- [ ] **Step 4: Commit**

---

### Task 7: Shadow report query

**Files:**
- Create: `server/mail/query/shadow.ts`

**Interfaces:**
- Produces: `getShadowReport({ policy_id })` — what that policy would have done, with counts by decision and a sample of affected messages — and `getShadowSummary()` for the whole most-recent run.

§8's promotion gates are decided from this surface: `archive` and `file` need operator review of the shadow record, and `auto_trash` needs a full shadow cycle with **zero rescues**. The report must therefore make "what would this rule have destroyed?" answerable at a glance, not just "how many rows did it match".

- [ ] **Step 1: Write the module**
- [ ] **Step 2: Verify** — tsc, biome, `bun test`
- [ ] **Step 3: Commit**

---

### Task 8: ORPC surface

**Files:**
- Modify: `server/orpc/mail.ts`

All procedures use the existing `authed` base from `server/orpc/base.ts:6`. Cap every `limit` with `.max(200)`, as Phase 2 does.

Add: `listPolicies`, `upsertPolicy`, `deletePolicy`, `listNeverTouchRules`, `upsertNeverTouchRule`, `deleteNeverTouchRule`, `snoozeThread`, `markThreadDone`, `dismissThread`, `getShadowReport`, `getShadowSummary`, `runShadowPass`.

`upsertPolicy` must reject `autonomy: "auto"` at the schema level in this phase, so the constraint is enforced where a caller can see it.

- [ ] **Step 1: Add the procedures**
- [ ] **Step 2: Verify** — tsc, biome
- [ ] **Step 3: Commit**

---

### Task 9: Sender Policy surface gains its policy column

**Files:**
- Modify: `src/routes/admin/senders.tsx`

Add the columns §9 asks for and Phase 2 deferred: policy, autonomy, and any guard suppression, rendered as `suppressed by guard: <name>`. Add bulk assignment — selecting several senders and applying one policy — because 1,394 never-replied senders is the actual workload and one-at-a-time will not survive contact with it.

**Sender display names and subjects remain attacker-controlled text**: React children only, never `dangerouslySetInnerHTML`, CSS truncation rather than `.slice()`.

Pagination in this file uses `patchSearch(patch, reset_offset)`; Phase 2's final review found the caller-supplied offset being overwritten there. If you touch that helper, re-check both Prev/Next and filter-change paths.

- [ ] **Step 1: Write it**
- [ ] **Step 2: Verify** — tsc, biome, `bun test`, `bun run build`
- [ ] **Step 3: Commit**

---

### Task 10: Needs Action gains its write path

**Files:**
- Modify: `src/routes/admin/needs-action.tsx`

Add snooze / done / "shouldn't be here". The page currently states these arrive in Phase 3 — **remove that line as part of this task**, or it becomes exactly the kind of stale copy Phase 2's review flagged on the admin index.

Every control is a real `<button>` with a visible `focus-visible:` ring. Snooze needs a duration choice; keep it to a few sensible presets rather than a date picker.

- [ ] **Step 1: Write it**
- [ ] **Step 2: Verify** — tsc, biome, `bun test`, `bun run build`
- [ ] **Step 3: Commit**

---

### Task 11: The shadow report surface

**Files:**
- Create: `src/routes/admin/shadow.tsx`
- Modify: `src/routes/admin/index.tsx`

One row per policy: what it would have done, how many messages, and a drill-down into a sample. A prominent trigger for `runShadowPass`, and a clear statement that nothing here has touched a mailbox — the operator needs to trust that before they will ever promote a policy.

- [ ] **Step 1: Write it and link it from the admin index**
- [ ] **Step 2: Verify** — tsc, biome, `bun test`, `bun run build`
- [ ] **Step 3: Commit**

---

### Task 12: Seed the policy table from the triage run

**Files:**
- Create: `scripts/seed-sender-policies.ts`

`tmp/2026-08-18-mail-triage-run-1.md` classifies 90 senders covering 7,056 messages — 49% of all mail — into archive-safe, file-to-records and keep-in-inbox groups, each with a rationale. Encode those as `sender_policy` rows.

Rules for the seed:
- **Every row enters at `autonomy: 'shadow'` and `source: 'operator'`.** §8 admits no exception; the triage was human reasoning, so `operator` is the honest provenance.
- The financial-records and business-operations groups map to `file` with `client` left null — Phase 5 assigns clients. **They must not map to `archive`**; the whole point of that distinction is that those 2,304 messages are a tax and accounting trail, and archiving them was the naive answer the triage explicitly rejected.
- `alerts@logalert.app` is deliberately unclassified — the operator has not decided. Do not guess.
- The script is idempotent: re-running updates rather than duplicating.
- **It prints what it would do and requires an explicit `--apply` flag to write.** The operator runs it; the implementer must not.

- [ ] **Step 1: Write the script**
- [ ] **Step 2: Dry-run it** (no `--apply`) and report the counts per action
- [ ] **Step 3: Verify and commit**

---

### Task 13: Runbook and ship

**Files:**
- Modify: `docs/runbooks/2026-08-17-mail-sync-schedules.txt`
- Move: this plan to `docs/plans/completed/`

Document: applying migration `0003`, running the seed script with `--apply`, triggering a shadow pass, and reading the shadow report. State plainly that **a shadow pass touches no mailbox and changes no mail** — that is the property which makes it safe to run repeatedly.

Carry forward the two operational lessons already in that file: pass an explicit long timeout on any long-running request, and check `SyncRun`/cursors before assuming a timed-out client means a dead run.

- [ ] **Step 1: Document the sequence**
- [ ] **Step 2: Full verification** — `bun run tsc`, `bunx biome check`, `bun test`, `bun run build`, and the five read-only-contract greps
- [ ] **Step 3: `git mv` the plan to `completed/` and append the closing marker**
- [ ] **Step 4: Commit**

---

## Self-review

| Spec section | Covered by |
|---|---|
| §1.9 Needs Action predicate, completed | Task 6 (`thread_state`, `sender_suppression`) |
| §1.9 feedback loop | Task 6 (dismissal writes suppression) |
| §3 data model | Task 1 (five tables; `client` deferred to Phase 5) |
| §5.1 signals | Reused from Phase 2, not re-derived |
| §5.2 resolution order | Task 3 |
| §5.3 scoped guards | Task 2, with the file-survives-replied-in-thread case tested explicitly |
| §5.4 derived defaults | Task 3, including the never-trash constraint |
| §8 autonomy ladder | Tasks 4 and 8 (born in shadow, `auto` rejected this phase) |
| §9 Sender Policy surface | Task 9 |
| §9 shadow report | Tasks 7 and 11 |
| §12 golden-file tests | Tasks 2 and 3 |

**Known gaps, stated rather than hidden:**

- **`last_in_thread_is_mine` IS implemented, on both sides.** Phase 2's review established that the Sent-folder exclusion does not approximate it, and this phase closed that: the shadow runner computes it in `server/mail/shadow/run.ts:77` as `MAX(CASE WHEN row_number = 1 THEN mine END)`, and the queue builds its half in `server/mail/query/needs-action.ts` via the `thread_head` CTE, consumed in the ranked predicate. Both rank over every live message in the thread — not over the filtered candidate pool, whose newest message is frequently one the `WHERE` clause excludes, the operator's own reply above all — and both share one definition of the two terms involved, `threadGroupKeySql()` and `isSentByMeSql()`. (Corrected 2026-08-19: this entry previously claimed the term was unimplemented, which would have sent Phase 4 rebuilding it.)
- **No test covers the shadow runner end to end** — it needs a database and there is no dev database. The pure modules it composes are golden-file tested; the runner's own evidence is a read-only count comparison.
- **`getShadowSummary()` has no mailbox attribution.** `runShadowPass` is strictly per-mailbox, `latestRunId()` picks a single run, and `Action` carries no `mailboxId` — so after passing four mailboxes the report silently shows only the last, and §8 promotion evidence for a cross-mailbox sender policy is one mailbox deep with nothing on the page disclosing which. Deliberately deferred: fixing it needs either a `mailboxId` column on `Action` or a different query shape, which is Phase 4 work.
- **`dkim_aligned` remains unknown for most of the largest mailbox.** Rules treat null as unknown, but that means DKIM-dependent logic is effectively unavailable on `felix@tellmann.co.za` until Phase 5 decides how to handle a server that does not stamp `Authentication-Results`.

**Completed: 2026-08-19**
- Verified: `sh tmp/tsc-mine.sh` (clean in scope; 22 pre-existing errors in `content/travel.tsx`, `content/travel-routes.ts`, `src/components/travel/`, owned by a concurrent session, filtered out — nothing in Phase 3 touches those files). `bunx biome check` (exit 0, 213 files checked, 0 errors — 15 pre-existing warnings / 53 infos in unrelated files such as `utils/scroll-to.tsx`'s `useDateNow` suggestions, none introduced by this phase). `bun test` (136 pass, 0 fail, across 12 files, 446,459 `expect()` calls). `bun run build` (succeeded; output includes `shadow-*.mjs`, `senders-*.mjs` and `needs-action-*.mjs` chunks, confirming `/admin/shadow`, `/admin/senders` and `/admin/needs-action` all registered).

  The four read-only-contract greps: `getMailboxLock` outside `readOnly: true` — nothing. Mailbox-mutating IMAP calls (`messageFlagsAdd/Set`, `messageMove`, `messageCopy`, `messageDelete`, `.append(`) in `server/mail` — nothing; Phase 3 ships no executor, so this is expected to stay empty until Phase 4. `rejectUnauthorized` outside `true` — nothing live; the three hits are comments in `server/mail/providers/tls.ts` and `server/db/drizzle.ts` warning against ever setting it `false`. `db.delete` in `server/mail` — two hits, both `server/mail/query/policies.ts:225,253`, deleting the operator's own `SenderPolicy`/`NeverTouchRule` config rows, not a mailbox or `message` row — this is the drift Task 5's review already flagged and is not a violation.

  Ruling R7 closed for the remaining two functions: ran a read-only script (`tmp/task13-verify-shadow.ts`, gitignored) against production. `getShadowSummary()` and `getShadowReport({ policy_id })` both executed with no runtime SQL error and returned the empty-state shape (`Action` holds 0 rows, `SenderPolicy` holds 0 rows — migration 0004 unapplied, seed unapplied): `{"run_id":null,"examined":0,"by_kind":{},"by_source":{},"destructive_count":0,"organisational_count":0,"retained_count":0,"destructive_sample":[],"sample":[]}` for both. Because `Action` is empty, `latestRunId()` short-circuits before either function's grouped/joined query touches the not-yet-existing `Action.source` column, which is exactly the empty-state shape the brief anticipated. `getShadowReport` was also probed with a synthetic `policy_id` (no real policy rows exist yet) and produced the same shape with no error, confirming the query path is sound independent of whether a matching policy exists.

  Documented the operator sequence (migrate 0004 → seed `--apply` → shadow pass per mailbox → read report), the ordering hazard (0004 must precede any shadow pass because `Action.source` is `NOT NULL` with no default), the seed's 86-policy breakdown, the `no-reply@lunalemon.dev` judgement call, the shadow pass's no-mailbox/no-mutation guarantee, and the queue-numbers-won't-move-until-you-act note, all in `docs/runbooks/2026-08-17-mail-sync-schedules.txt`.

  Architectural lesson for the next phase: four separate times this phase, one semantic acquired two spellings across SQL and TypeScript — §1.9's needs-action predicate, "sent by me", thread-open, and the thread key itself — each costing a fix round. The cause was consistent: a rule that has to exist in both SQL and TypeScript, with nothing forcing the two to agree. The remedy that worked was extracting one definition into `server/mail/query/signal-sql.ts` and having every consumer import it rather than re-deriving the predicate locally. Treat any new cross-layer predicate as needing exactly one home from the start.

- Open: no browser has rendered `/admin/shadow`, or the new controls on `/admin/senders` and `/admin/needs-action` — only `tsc`, `bun test`, and the production build confirm they compile and bundle. No shadow pass has ever run. Migration 0004 is unapplied (`Action.source` does not exist in the live schema yet). The seed script has never been run with `--apply` (`SenderPolicy` holds 0 rows). No mutating procedure was invoked against the live database at any point in this task. Silence = confirmed.
