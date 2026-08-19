# Email Suite Phase 4: Actions + Undo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn a journalled decision into a mailbox mutation the operator explicitly approved — and make every one of them exactly reversible.

**Architecture:** `MailboxProvider` gains its first mutating methods; that contract change is the deliberate, narrow breach of a read-only invariant that has held since Phase 1, and it happens in exactly one implementation file. `server/mail/actions/executor.ts` follows §7.1's ordering without exception: read server state, journal `from_state_json` with status `pending`, mutate, then record `to_state_json` and mark `applied`. `COPYUID` parsing is a pure, tested function because zipping a batched response back onto its source UIDs is the subtlest thing in the phase. `undo.ts` reads `from_state_json` and issues the inverse, and bulk-undo-by-rule replays those inverses newest-first over `action.sender_policy_id` — a column Phase 3 populated precisely so this could be written. An Action Journal surface makes every mutation visible and reversible.

**Tech Stack:** `imapflow` 1.6.1 (UID MOVE, UIDPLUS, X-GM-LABELS), Drizzle + `mysql2` (MySQL 8.4), ORPC + Zod v3, TanStack Start, Tailwind v3, `bun test`.

**Spec:** `docs/plans/specs/active/2026-07-27-email-management-design.md` — §7 in full (the executor), §1.7 (deletion is an outcome, never an immediate action), §8 (autonomy ladder — this phase is `propose` only), §9 (the Action Journal surface), §11 (error handling).

## THE INVARIANT CHANGES IN THIS PHASE — read this before anything else

Phases 1-3 held an absolute rule: **nothing in `server/mail` may mutate a mailbox.** Four greps enforced it, and every task was verified against them.

**Phase 4 deliberately breaks that rule, in the narrowest possible way.** The greps do not disappear — they are *redefined*, and a task that leaves them undefined has removed the safety net rather than adjusted it:

| Old invariant | New invariant |
|---|---|
| No `messageFlagsAdd/Set`, `messageMove`, `messageCopy`, `messageDelete`, `.append(` anywhere in `server/mail` | Those calls exist **only** in `server/mail/providers/imap.ts`, reached **only** through the `MailboxProvider` mutation methods, and **only** from `server/mail/actions/executor.ts` and `undo.ts` |
| Every `getMailboxLock` passes `{ readOnly: true }` | Read paths still pass `{ readOnly: true }`; a write lock appears **only** in the mutation methods, and every one is asserted in a test |
| No `action` row may leave `shadow` | No `action` row may reach `applied` without a `from_state_json` captured first, and **nothing may set `autonomy: "auto"`** — §8 keeps that for Phase 6 |
| — | **`purge` is never issued.** §1.7 puts it behind a separate scheduled sweep that is Phase 8, disabled until a full shadow cycle records zero rescues. No code path in this phase may produce it. |

Every task's verification includes the redefined greps, and Task 13 re-states them in the runbook so the next phase inherits a live contract rather than a stale one.

## Global Constraints

- **Never run `bun run dev`** or any watch/long-running server. Verification is `sh tmp/tsc-mine.sh` (NOT `bun run tsc` — see below), `bunx biome check --fix <file>`, `bun test <file>`, and `bun run build` where the route tree must regenerate.
- **Never run `bun run db:push`, `db:migrate`, or any INSERT/UPDATE/DELETE against the database.** Schema changes: edit `server/db/schema.ts`, run `bun run db:generate`, surface the SQL for the operator. `DATABASE_URL`, `DATABASE_URL_DEV` and `DATABASE_URL_PROD` all point at the **same production** MySQL.
- **NEVER execute a mutation against a real mailbox.** Not one message, not "just to check", not with a batch size of 1. Every mutating path is verified by typecheck, by unit tests over a fake provider, and by reading — never by running. The operator performs the first real mutation, deliberately, from the runbook.
- **`bun run tsc` is not a usable gate in this working tree** — a concurrent session owns `content/travel.tsx`, `content/travel-routes.ts` and `src/components/travel/`, and it has been mid-refactor with ~22 typecheck errors. Use `sh tmp/tsc-mine.sh`, which filters those and reports only in-scope errors. **Never edit a travel file.**
- **This repository has concurrent sessions.** Other agents commit unrelated work into the same tree, sometimes onto this branch. Always run `git diff <file>` in an EARLIER tool call than the commit, confirm every hunk is yours, then commit pathspec-limited: `git add <files> && git commit -m "..." -- <files>`. Never `git add -A`. No `Co-Authored-By`. Never push.
- TypeScript strict + `verbatimModuleSyntax`; `import type` for type-only imports. No `any` — `unknown` plus narrowing.
- Named exports only, never `export default`. `type` over `interface`. Functions over classes. Two `if` blocks over `if/else` unless trivial.
- Biome: line width 140, double quotes, spaces.
- Comments: default to none. Only a non-obvious *why* earns one. Never narrate the edit.
- `snake_case` variables and object fields, `camelCase` functions.
- DB tables PascalCase, columns camelCase passed explicitly as strings, `updatedAt` has no DB default and must be set on every insert.
- **UI conventions:** `clsx()` inline in the JSX prop (never `cn()`, never a template literal, never an extracted variable); top-level route components are plain `function` declarations, inner components arrow `FC`; shared primitives from `src/routes/admin/-ui.tsx`; `bg-accent` must never pair with `text-accent-contrast` (same RGB, invisible text); grep `tailwind.config.mjs` for a token before any sized or coloured class, and bare `Npx` suffixes are invalid; interactive controls must be real `<button>`/`<input>` with `focus-visible:ring-2 focus-visible:ring-info`, because Biome's `useSemanticElements` rejects ARIA roles standing in for elements.

## THE LESSON PHASE 3 PAID FOR FIVE TIMES — apply it from the start

Five times in Phase 3, one semantic acquired two spellings across SQL and TypeScript, and each cost a fix round. One of them left a §5.3 guard **silently disabled on three of four mailboxes** with every test green; another had the Needs Action queue and the rules engine disagreeing about **23% of the queue**.

The cause was always the same: a rule that must exist in more than one place, with nothing forcing the copies to agree. The remedy that worked was one exported definition — `signal-sql.ts` holds the SQL halves, `signals.ts`/`guards.ts` the TypeScript ones, and every consumer imports rather than restates.

**Phase 4 has its own version of this risk**: the inverse of an action must agree with the action itself. If `archive` is "remove the `\\Inbox` label" in one place and "move to the Archive folder" in another, undo restores the wrong thing. Define each action and its inverse **once**, together, and have both the executor and the undo path import that definition.

## What Phase 3 delivered that this phase builds on

- `action` table with `from_state_json`, `to_state_json`, `sender_policy_id`, `source`, `status`, and a unique key on `(messageId, kind, runId)` that makes retries idempotent. `runId` is `NOT NULL` specifically so that key cannot be defeated by SQL's NULL-distinctness.
- `server/mail/classify/rules.ts` — `decide()`, whose `Decision` is what this phase executes. It can never emit `purge`, and a derived default can only ever produce `archive`.
- `server/mail/shadow/run.ts` — journals decisions at `status: "shadow"`.
- `server/mail/query/policies.ts` — `upsertPolicy` rejects `autonomy: "auto"` at the Zod boundary.
- `server/mail/query/shadow.ts` — the report the operator reviews before approving anything.
- `/admin/senders`, `/admin/needs-action`, `/admin/shadow`.

## Live state at planning time (2026-08-19)

| Fact | Value |
|---|---|
| Messages | ~14,600 across four mailboxes |
| `Action` rows | **0** — no shadow pass has ever run |
| `SenderPolicy` rows | **0** — the seed has not been applied |
| Migration 0004 | **generated, not applied** |
| Needs Action queue | 5,616 unfiltered / 401 at the 30-day default |
| Seed script, ready to apply | 86 policies: 55 `archive`, 27 `file`, 4 `keep_inbox` |

**Phase 4 cannot be meaningfully tested until the operator applies 0004, applies the seed, and runs a shadow pass.** Plan for that: the executor's real evidence is a `pending` row the operator approves by hand, one message, watched. Task 13 documents that first run as a deliberate ceremony, not a smoke test.

## File structure

| File | Responsibility |
|---|---|
| `server/db/schema.ts` | **Modify.** `action.mailbox_id` — §7.3 groups by `(mailbox, folder, target)`, undo needs to reach the right server, and Phase 3's shadow report has no mailbox attribution without it. |
| `server/mail/actions/kinds.ts` | **New.** Each action and **its inverse**, defined once, per flavour. The single source both the executor and undo import. |
| `server/mail/actions/copyuid.ts` | **New.** Pure. Parse a `COPYUID` response and zip destination UIDs back onto source UIDs, in order. |
| `server/mail/actions/copyuid.test.ts` | **New.** Including the ordering and set-arithmetic cases that make this subtle. |
| `server/mail/providers/types.ts` | **Modify.** The mutation methods — the deliberate contract change. |
| `server/mail/providers/imap.ts` | **Modify.** Their only implementation. The one file in which a write lock may appear. |
| `server/mail/actions/state.ts` | **New.** Capture `from_state_json` — folder, flags, labels — from the server before any mutation. |
| `server/mail/actions/executor.ts` | **New.** §7.1's ordering, §7.3's batching. |
| `server/mail/actions/undo.ts` | **New.** Single-action undo and bulk-undo-by-policy. |
| `server/mail/query/actions.ts` | **New.** Reads for the Action Journal. |
| `server/orpc/mail.ts` | **Modify.** Approve, apply, undo, undo-by-policy, list journal. |
| `src/routes/admin/journal.tsx` | **New.** §9's Action Journal — the trust surface. |
| `src/routes/admin/shadow.tsx` | **Modify.** Approving a shadow decision promotes it to `pending`. |

## Deliberately out of scope

- **Autonomy.** Nothing may set `autonomy: "auto"`. §8 promotes per policy only after a reviewed shadow record, and rescue detection — which auto-suspends a policy when a message it touched is later opened — is Phase 6. A `pending` row in this phase waits for a human click, always.
- **Filing to client folders.** §6's `client` axis, delimiter-aware paths and the DKIM gate are Phase 5. `file` in this phase moves to a single configured folder or is deferred; decide in Task 2 and say which.
- **Purge.** §1.7 keeps it behind a separate scheduled sweep, Phase 8, disabled until a full shadow cycle records zero rescues.
- **The `getShadowSummary()` mailbox attribution gap** is partly closed by `action.mailbox_id` in Task 1, but re-shaping the report itself is not this phase's job — note it and move on.

---

### Task 1: `action.mailbox_id`

**Files:** Modify `server/db/schema.ts`; generated `server/db/migrations/0005_*.sql`.

**Interfaces:** Produces `action.mailbox_id`, consumed by Tasks 6, 7, 8 and 9.

§7.3 batches by `(mailbox, folder, target)`; undo must reach the same server it mutated; and Phase 3's shadow report cannot attribute a run without it. The column is nullable, because rows written by Phase 3's shadow runner predate it — a `NOT NULL` add would fail or fill them with a meaningless value, exactly the hazard migration 0004 documented.

- [ ] **Step 1:** Add the column and an index on `(mailbox_id, status)`.
- [ ] **Step 2:** `bun run db:generate`. Expect exactly one `ALTER TABLE` plus one `CREATE INDEX`. Anything else means the schema drifted — STOP and report BLOCKED with the SQL.
- [ ] **Step 3:** `sh tmp/tsc-mine.sh`, `bunx biome check --fix`, print the SQL for the operator. **Do not run `db:migrate`.**
- [ ] **Step 4:** Commit.

---

### Task 2: Action kinds and their inverses

**Files:** Create `server/mail/actions/kinds.ts`, `kinds.test.ts`.

**Interfaces:** Produces `type ActionPlan`, `planFor(kind, flavour, context)`, `inverseOf(plan, from_state)`. Consumed by the executor and by undo.

**This is the task that decides whether undo is correct.** Every action and its inverse are defined here, once, together — so they cannot drift apart the way five separate semantics did in Phase 3.

Per flavour, per §7.2:
- **Gmail `archive`** is `STORE -X-GM-LABELS (\\Inbox)`. **Not a move.** UIDs stay stable and `to_state_json` records the resulting label set. Its inverse adds the label back.
- **Generic `archive`** is a move to the Archive folder. UIDs change; the inverse moves back to the folder recorded in `from_state_json`.
- **`file`** is a move to a target folder — decide and document whether Phase 4 supports a single configured target or defers filing to Phase 5.
- **`auto_trash`** moves to Trash. Its inverse moves back. §1.7 makes Trash reversible for the server's retention window; **`purge` is not implemented here at all.**
- **`keep_inbox` and `needs_action` are not actions.** They must produce no plan; a caller asking for one is a programming error, not a no-op to swallow silently.

- [ ] **Step 1:** Write the module. Pure — no IO, no provider import.
- [ ] **Step 2:** Tests. The load-bearing property is **round-tripping**: for every kind and flavour, applying the inverse to the recorded `from_state` must return the original state. Assert that, not merely that the two functions exist.
- [ ] **Step 3:** `bun test`, `sh tmp/tsc-mine.sh`, `bunx biome check --fix`.
- [ ] **Step 4:** Commit.

---

### Task 3: `COPYUID` parsing and zipping

**Files:** Create `server/mail/actions/copyuid.ts`, `copyuid.test.ts`.

**Interfaces:** Produces `parseCopyUid(response)` and `zipCopyUid(source_set, destination_set)`.

§7.2: a batched `UID MOVE` over a UID set returns **one** `COPYUID` source-set/destination-set pair which must be zipped back to the source UIDs **in order**. Get this wrong and every moved message is orphaned until the next sync, with undo left holding an address that does not exist.

UID sets arrive in IMAP range notation — `1,3:5,9` — so parsing must expand ranges, preserve order, and the two sides must come out the same length. **A length mismatch is a hard error, never a silent truncation**: a silently short zip writes the wrong destination UID onto a real message.

- [ ] **Step 1:** Write the module. Pure.
- [ ] **Step 2:** Tests: single UIDs, ranges, mixed, out-of-order sets, a length mismatch raising rather than truncating, and an empty set.
- [ ] **Step 3:** `bun test`, `sh tmp/tsc-mine.sh`, `bunx biome check --fix`.
- [ ] **Step 4:** Commit.

---

### Task 4: The mutating provider contract

**Files:** Modify `server/mail/providers/types.ts`.

**Interfaces:** Adds `moveMessages`, `copyMessages`, `setLabels`, `expungeUids` to `MailboxProvider`.

Types only — no implementation. **This is the moment the read-only contract formally changes**, so the file must say so: a comment recording that these are the only mutating methods, that they exist for the Phase 4 executor, and that `purge` is deliberately absent.

`capabilities` already carries `uidplus`, `move` and `gmail` from Phase 1, which is exactly what §7.2's fallback decision needs — do not add new capability flags.

- [ ] **Step 1:** Add the methods and the contract comment.
- [ ] **Step 2:** `sh tmp/tsc-mine.sh` will now FAIL — `imap.ts` does not implement them. That is expected and is why Task 5 follows immediately. Report the errors rather than stubbing them.
- [ ] **Step 3:** Commit.

---

### Task 5: The IMAP implementation

**Files:** Modify `server/mail/providers/imap.ts`.

**The single most dangerous task in the phase.** This is the only file in which a write lock or a mutating IMAP call may appear.

- `UID MOVE` where `capabilities.move`; otherwise `UID COPY` + `STORE \Deleted` + `UID EXPUNGE` over the same set, capturing `COPYUID` from the `COPY` (§7.2).
- **`UID EXPUNGE` (UIDPLUS) over an explicit UID set, never a bare `EXPUNGE`.** A bare expunge removes *every* `\Deleted`-flagged message in the folder, including ones a human flagged by hand minutes earlier. **Hard-fail if the server does not advertise `UIDPLUS`** rather than falling back — §1.7 is explicit that destroying messages we never selected is the failure mode to prevent.
- Gmail label writes via `STORE ±X-GM-LABELS`.
- A write lock **only** in these methods; every read path keeps `{ readOnly: true }`.

- [ ] **Step 1:** Implement.
- [ ] **Step 2:** Tests over a fake `imapflow` client asserting the exact commands issued — including that a missing `UIDPLUS` raises rather than falling back to a bare `EXPUNGE`, and that read paths still take a read-only lock.
- [ ] **Step 3:** The redefined greps: mutating calls appear **only** in this file; `getMailboxLock` without `readOnly: true` appears **only** in the mutation methods. Include the output.
- [ ] **Step 4:** `bun test`, `sh tmp/tsc-mine.sh`, `bunx biome check --fix`. **Do NOT run a mutation against a real mailbox.**
- [ ] **Step 5:** Commit.

---

### Task 6: State capture and the executor

**Files:** Create `server/mail/actions/state.ts`, `server/mail/actions/executor.ts`.

**§7.1's ordering is the whole task, and it is easy to get backwards:**

1. Read current state from the server — folder, flags, labels.
2. Write the `action` row with `from_state_json`, status **`pending`**.
3. Perform the IMAP mutation.
4. Record `to_state_json` and mark `applied` — or `failed` with the error.

**Mutate-then-journal loses the pre-state on any crash and makes undo permanently impossible for those messages.** A crash between 3 and 4 must leave a `pending` row holding the exact pre-state, so the next run can reconcile by comparing actual server state against `from_state`/`to_state`.

Also: batch by `(mailbox, folder, target)` per §7.3 — archiving 400 newsletters is a handful of commands, not 400 round trips. Retries must not double-apply, which the `(messageId, kind, runId)` unique key gives you. Per §11, a partial batch failure marks **only** the unconfirmed UIDs failed; the executor re-reads state next run rather than assuming.

- [ ] **Step 1:** `state.ts` — capture from the server, not from our database. Our row may be stale; the mailbox is the source of truth.
- [ ] **Step 2:** `executor.ts` in the order above, with the ordering asserted by a test that simulates a crash between steps 3 and 4 and proves `from_state_json` survives.
- [ ] **Step 3:** `bun test`, `sh tmp/tsc-mine.sh`, `bunx biome check --fix`, the redefined greps.
- [ ] **Step 4:** Commit.

---

### Task 7: Undo

**Files:** Create `server/mail/actions/undo.ts`.

Undo reads `from_state_json` and issues the inverse from Task 2 — **it must not recompute what the inverse should be.** Bulk-undo-by-rule selects on `action.sender_policy_id` and replays inverses **newest-first** across every action a policy ever took; Phase 3 populated that column specifically so this could be written.

An undone row becomes `status: "undone"` rather than being deleted — §9's journal is the trust surface and a vanished row is worse than a reversed one.

- [ ] **Step 1:** Single-action undo.
- [ ] **Step 2:** Bulk-undo-by-policy, newest-first, with a test proving the ordering (replaying oldest-first can restore an intermediate state rather than the original).
- [ ] **Step 3:** `bun test`, `sh tmp/tsc-mine.sh`, `bunx biome check --fix`, the redefined greps.
- [ ] **Step 4:** Commit.

---

### Task 8: Promotion — shadow to pending

**Files:** Create/modify as needed; ORPC lands in Task 9.

Approving a shadow decision promotes it to `pending`. **`pending` is the only status a human click may create in this phase**, and nothing may set `autonomy: "auto"` — §8 keeps that for Phase 6.

Approval must be explicit and scoped: a decision, or all decisions for one policy, never "approve everything".

- [ ] **Step 1:** Implement, with a guard rejecting any attempt to promote straight to `applied`.
- [ ] **Step 2:** Tests including that guard.
- [ ] **Step 3:** Verify; commit.

---

### Task 9: ORPC surface

**Files:** Modify `server/orpc/mail.ts`.

`approveDecision`, `applyPending`, `undoAction`, `undoByPolicy`, `listActionJournal`.

Every procedure on the existing `authed` base — Phase 1 rejected a second auth mechanism, and these **mutate a real mailbox**. Cap every `limit` at 200. Use `.default(...)`, never `.optional()`, for anything the query layer expects: `buildPolicyWhere` guards `!== null` but not `undefined`, and Phase 3 hit a live 500 that way.

**`applyPending` must take an explicit, bounded scope** — a mailbox and a batch size, never a no-arg "apply everything". A stray call must not be able to mutate four mailboxes.

- [ ] **Step 1:** Add the procedures. **Step 2:** Verify. **Step 3:** Commit.

---

### Task 10: The Action Journal

**Files:** Create `src/routes/admin/journal.tsx`; modify `src/routes/admin/index.tsx`.

§9 calls this **the trust surface**: every action ever taken, with its pre-state, filterable by date, mailbox, policy and sender, with per-action and per-policy undo.

Show `from_state` → `to_state` concretely — folder and labels before and after — because "archived" is not enough for an operator deciding whether to trust the next batch. Subjects are attacker-controlled text: React children only, CSS truncation, never `dangerouslySetInnerHTML`.

- [ ] **Step 1:** Build it. **Step 2:** Verify including `bun run build`. **Step 3:** Commit.

---

### Task 11: Approve from the shadow report

**Files:** Modify `src/routes/admin/shadow.tsx`.

The shadow report is where §8's promotion decision happens, so approval belongs there. Make the destructive/organisational split from Phase 3 drive the ceremony: approving `auto_trash` should demand more deliberation than approving `archive`.

- [ ] **Step 1:** Build it. **Step 2:** Verify. **Step 3:** Commit.

---

### Task 12: Apply controls on the working surfaces

**Files:** Modify `src/routes/admin/needs-action.tsx`, `src/routes/admin/senders.tsx`.

Surface pending counts and let the operator apply them from where they already work.

- [ ] **Step 1:** Build it. **Step 2:** Verify. **Step 3:** Commit.

---

### Task 13: Runbook and ship

**Files:** Modify `docs/runbooks/2026-08-17-mail-sync-schedules.txt`; `git mv` this plan to `completed/`.

**Document the first real mutation as a ceremony, not a smoke test.** The prerequisites are a chain: apply 0004 → apply the seed → run a shadow pass → review the report → approve ONE decision → apply it → **verify in the actual mail client** → undo it → verify the undo. Only then approve a batch.

**Re-state the redefined read-only contract** so the next phase inherits a live rule rather than a stale one: mutating calls exist only in `imap.ts`, reached only via the provider's mutation methods, only from the executor and undo.

Record the §11 error-handling behaviour the operator will meet: a partial batch failure marks only unconfirmed UIDs failed, a missing `UIDPLUS` hard-fails rather than falling back, and a crash mid-batch leaves `pending` rows that the next run reconciles.

- [ ] **Step 1:** Document. **Step 2:** Full verification and the redefined greps. **Step 3:** `git mv` and closing marker. **Step 4:** Commit.

---

## Self-review

| Spec section | Covered by |
|---|---|
| §7.1 journal-before-mutate | Task 6, with a crash-simulation test |
| §7.2 `COPYUID`, MOVE fallback, Gmail label archive | Tasks 2, 3, 5 |
| §7.3 batching, undo, bulk-undo-by-rule | Tasks 6, 7 |
| §1.7 trash reversible, purge absent | Task 2 (no purge plan), Task 5 (`UID EXPUNGE` only, hard-fail without UIDPLUS) |
| §8 propose only, no `auto` | Task 8's guard, and the global constraints |
| §9 Action Journal | Task 10 |
| §11 partial failure, credential failure, reconciliation | Tasks 5, 6 |

**Known gaps, stated rather than hidden:**

- **Nothing in this phase can be tested against a real mailbox before the operator's first ceremony.** Unit tests over a fake provider assert the commands issued; they cannot prove a real server behaves as expected. Task 13's ceremony is the real acceptance test, and the plan says so rather than implying the tests suffice.
- **Filing to client folders is Phase 5**, so `file` here is either a single configured target or deferred — Task 2 decides and must say which.
- **Rescue detection is Phase 6.** Until then, a policy that makes a mistake stays active until the operator suspends it; the journal is the only detection mechanism.
- **The shadow report's mailbox attribution** is only partly addressed by `action.mailbox_id`; re-shaping the report is not this phase's work.
