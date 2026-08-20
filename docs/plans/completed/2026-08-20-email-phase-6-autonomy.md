# Email Phase 6 — Autonomy and rescue detection: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to
> implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect when the operator's own behaviour shows a rule was wrong, suspend that rule
automatically, and — separately — let a trusted rule act without a click.

**Architecture:** Rescue detection is a read-only pass over `applied` actions that runs inside the sync,
after the incremental fetch and before the shadow pass. It resolves each action to the message row that
is live *now* — which on a generic server is a different row from the one the action names — and asks
whether the operator opened or answered it after the action landed. A rescue suspends the policy and
stamps the action. The autonomy ladder is a separate promotion step between the shadow pass and the
executor: rows whose policy is `auto` become `pending`, and travel the existing executor path unchanged.

**Tech Stack:** TypeScript 7 (strict, `verbatimModuleSyntax`), Bun test, Drizzle + mysql2 (MySQL 8.4),
ORPC + Zod v3, TanStack Start + React, Tailwind v3, Biome.

**Spec:** `docs/plans/specs/active/2026-08-20-email-phase-6-autonomy-design.md`, which amends §8 of
`docs/plans/specs/active/2026-07-27-email-management-design.md`. Read both; §8 carries a pointer.

---

## Global Constraints

- **The net lands before the automation.** Tasks 1–5 build rescue detection; only then does Task 6 make
  `auto` mean anything. No task may promote a policy to `auto` before detection is exercised.
- **Never run `bun run dev`** or any watch/long-running server. `bun run build` is fine.
- **Never run `db:migrate`, `db:push`, or any DML.** `DATABASE_URL`, `DATABASE_URL_DEV` and
  `DATABASE_URL_PROD` all point at the same production MySQL, holding 44,102 live `Action` rows and
  14,729 live messages. Schema work stops at `bun run db:generate`.
- **Never connect to a real IMAP server or mutate a real mailbox.** This phase adds no mutation at all.
- **The read-only invariant must not move.** Mutating IMAP calls exist only in
  `server/mail/providers/imap.ts`, through `moveMessages`, `setLabels` and `createFolder`, called only
  from `server/mail/actions/executor.ts`, `undo.ts` and `server/mail/filing/resolver.ts`. Rescue
  detection adds no mutation; auto execution reuses the executor. **If the three greps in
  `docs/runbooks/2026-08-17-mail-sync-schedules.txt` change at all, something is wrong.**
- **Never `git push`.** Never `git add -A` / `git add .` — run `git diff <file>` in an *earlier tool
  call* than the commit, then commit pathspec-limited.
- **Never run `git stash`, `git checkout`, `git restore`, `git reset`, `git clean`, or `git rebase`.**
- **Never touch** `content/travel.tsx`, `content/travel-routes.ts`, `src/components/travel/`. **Never
  hand-edit** `src/routeTree.gen.ts` or `server/db/migrations/**`. **No `Co-Authored-By` trailers.**
- **`purge` must not exist in any form.** §1.7 keeps it for Phase 8.
- **`decide()` stays autonomy-blind.** It answers what should happen to a message, which does not depend
  on how much the operator trusts the rule.
- **`upsertPolicy` keeps rejecting `"auto"` at the Zod boundary.** Promotion is its own procedure with
  its own gate — not a field edit on a general-purpose update.
- **One semantic, one spelling.** This phase's candidate is "where did this message end up" (Task 1).
- **Style:** Biome, line width 140, double quotes. Named exports only. `type` over `interface`.
  `snake_case` variables, `camelCase` functions. No `any`. `import type` for type-only imports. Run
  `bunx biome check --fix <file>` after editing.

---

## File Structure

**New — `server/mail/rescue/`:**

| file | responsibility |
|---|---|
| `locate.ts` | resolve an action to the message row that is live now. The one spelling. |
| `locate.test.ts` | both flavours, including the moved-row case that would otherwise go undetected. |
| `signals.ts` | pure. Given `appliedAt`, `openedAt` and reply facts: rescue or not, and which signal. |
| `signals.test.ts` | boundary cases, including equal timestamps and nulls. |
| `detect.ts` | the pass. Loads applied actions, locates, judges, suspends, stamps. Behind a port. |
| `detect.test.ts` | over a fake port; never reaches the database. |

**New — `server/mail/actions/autonomy.ts`** — the promotion step and its gates.

**Modified:** `server/db/schema.ts`, `server/mail/sync/run.ts`, `server/mail/query/policies.ts`,
`server/orpc/mail.ts`, `src/routes/admin/journal.tsx`, `src/routes/admin/senders.tsx`,
`docs/runbooks/2026-08-17-mail-sync-schedules.txt`.

---

### Task 1: Locate the message an action actually touched

The hazard of the phase lives here. Get it wrong and rescue detection reports on three mailboxes and is
silently blind on the largest — the same shape as the Phase 3 sent-by-me guard, which was disabled on
three of four mailboxes for a whole phase with every test green.

**Files:**
- Create: `server/mail/rescue/locate.ts`, `server/mail/rescue/locate.test.ts`

**Interfaces:**
- Consumes: `parseActionState` from `@server/mail/actions/state`.
- Produces: `messageAddressForAction(input): MessageAddress | { by: "row"; message_id: string }`

- [ ] **Step 1: Write `server/mail/rescue/locate.ts`**

```ts
import type { ActionStateSnapshot } from "@server/mail/actions/state";
import { parseActionState } from "@server/mail/actions/state";

// Where an action's message lives NOW, which is not always the row the action names.
//
// `Message` carries two unique keys: (mailboxId, folder, uidValidity, uid) and (mailboxId, gmMsgid).
//   - On Gmail, archiving drops the \Inbox label. The message stays in [Gmail]/All Mail with a stable
//     UID and gmMsgid, so the sync UPDATES the same row and Action.messageId still addresses it.
//   - On generic IMAP, archiving is a folder move. The new (folder, uid) matches no existing row, so the
//     sync INSERTS a new one and reconciliation stamps disappearedAt on the old. Action.messageId now
//     points at a dead row whose openedAt can never change again.
//
// A detector that joined on Action.messageId would therefore work on the three Gmail mailboxes and be
// permanently silent on felix@tellmann.co.za, which holds two thirds of the mail. It would look correct.
//
// to_state_json records the destination the SERVER confirmed — folder, uid and uidValidity, captured
// from COPYUID precisely so a moved message stays addressable (§7.2). That is the address to use. The
// messageId fallback is for the un-moved case, where to_state_json is absent or the mutation was a label
// edit that left the row where it was.
export type MessageAddress =
  | { by: "address"; folder: string; uid: number; uid_validity: string }
  | { by: "row"; message_id: string };

export function messageAddressForAction(input: { message_id: string; to_state_json: string | null }): MessageAddress {
  const to_state: ActionStateSnapshot | null = parseActionState(input.to_state_json);
  if (to_state === null) {
    return { by: "row", message_id: input.message_id };
  }
  return { by: "address", folder: to_state.folder, uid: to_state.uid, uid_validity: to_state.uid_validity };
}
```

- [ ] **Step 2: Write `server/mail/rescue/locate.test.ts`**

- an action with a `to_state_json` recording a move returns the recorded folder/uid/uidValidity
- an action with no `to_state_json` falls back to the row id
- an action with malformed `to_state_json` falls back rather than throwing — `parseActionState` already
  returns null for anything unusable, and a bulk pass must not die on one bad row
- **the case this task exists for:** a generic-flavour archive whose `to_state_json` names a different
  folder from the action's original one returns the NEW address, not the row id

- [ ] **Step 3: Verify and commit**

```bash
bun test server/mail/rescue/ && bun run tsc
bunx biome check --fix server/mail/rescue/locate.ts server/mail/rescue/locate.test.ts
git add server/mail/rescue/locate.ts server/mail/rescue/locate.test.ts && \
  git commit -m "feat: locate the message an action touched, not the row it names" -- \
  server/mail/rescue/locate.ts server/mail/rescue/locate.test.ts
```

---

### Task 2: Schema — `Action.rescuedAt` and `SenderPolicy.autonomyPromotedAt`

**Files:** Modify `server/db/schema.ts`; generated `server/db/migrations/**`.

- [ ] **Step 1: Add both columns**

In the `action` table, after `error`:

```ts
    // When a rescue was detected against this action. Makes detection idempotent — a rescue already
    // recorded must not re-suspend a policy the operator has since deliberately cleared — and lets the
    // journal show WHICH action was rescued rather than only that some policy is suspended.
    rescued_at: datetime("rescuedAt", { fsp: 3 }),
```

In the `senderPolicy` table, after `autonomy`:

```ts
    // When the operator promoted this policy to autonomy "auto". §8's auto_trash gate measures "a full
    // shadow cycle" from here, so it must be the promotion moment and not createdAt — a policy that sat
    // in shadow for a year has not thereby earned anything.
    autonomy_promoted_at: datetime("autonomyPromotedAt", { fsp: 3 }),
```

- [ ] **Step 2: Generate, read, commit**

```bash
bun run db:generate
cat server/db/migrations/0008_*.sql
```

Confirm it is exactly two additive `ADD COLUMN` statements — no `DROP`, no `MODIFY`, no other table.
**Do not run `db:migrate`.** Quote the SQL verbatim in the task report; the operator applies it.

---

### Task 3: The rescue signals

Pure. No database, no IO. Given when an action landed and what the operator did afterwards, is this a
rescue and which signal fired.

**Files:** Create `server/mail/rescue/signals.ts`, `server/mail/rescue/signals.test.ts`

- [ ] **Step 1: Write `server/mail/rescue/signals.ts`**

```ts
// §8's rescue test, amended: it applies to any APPLIED action, not only an automatic one. An action's
// autonomy level records how it was approved; it says nothing about whether it was right, and this
// module is a claim about rightness. The operator's first real use of this system is a manually
// approved bulk apply — the operation that most needs watching.
export const RESCUE_SIGNALS = ["opened", "replied"] as const;
export type RescueSignal = (typeof RESCUE_SIGNALS)[number];

// `starred` is deliberately absent. Message.isFlagged records that a message IS starred, never WHEN it
// became starred, so "you starred it after the rule hid it" is not expressible without a flaggedAt
// column mirroring openedAt. The consequence is stated rather than hidden: an operator who rescues a
// message by starring it, and never opens or answers it, produces no detection.

export type RescueInput = {
  applied_at: Date;
  // The live row's openedAt — the FIRST \Seen transition the sync observed, which never moves once set.
  opened_at: Date | null;
  // The newest sent-by-me message in the same thread, or null. Reply detection reuses the existing
  // thread grouping and sent-by-me SQL rather than restating either.
  last_reply_at: Date | null;
};

export type RescueVerdict = { rescued: false } | { rescued: true; signal: RescueSignal; at: Date };

// Strictly later, never equal — and the reason is what openedAt actually measures. The incremental sync
// stamps it with the time it OBSERVED the \Seen transition, not the moment the operator opened the
// message, so it is already coarse and always lands after the real open. Equality with appliedAt would
// therefore mean a sync ran in the same millisecond as the apply: an artifact of two fsp:3 timestamps
// written by different code paths, not evidence that anybody read anything.
// (The executor's own read cannot cause this: captureFolderStates fetches with BODY.PEEK, which by
// definition does not set \Seen.)
function isAfter(candidate: Date | null, applied_at: Date): candidate is Date {
  return candidate !== null && candidate.getTime() > applied_at.getTime();
}

export function judgeRescue(input: RescueInput): RescueVerdict {
  if (isAfter(input.opened_at, input.applied_at)) {
    return { rescued: true, signal: "opened", at: input.opened_at };
  }
  if (isAfter(input.last_reply_at, input.applied_at)) {
    return { rescued: true, signal: "replied", at: input.last_reply_at };
  }
  return { rescued: false };
}
```

- [ ] **Step 2: Write the tests**

- opened after → rescued, signal `opened`
- replied after → rescued, signal `replied`
- **opened at exactly `applied_at` → NOT rescued.** `openedAt` is stamped when the sync *observed* the
  transition, not when the operator opened the message, so equality means two independently-written
  timestamps collided — an artifact, not a signal. An inclusive comparison would turn every such
  collision into a suspended policy.
- both null → not rescued
- opened before, replied after → rescued via `replied`
- an action with an `applied_at` in the future relative to both → not rescued

- [ ] **Step 3: Verify and commit** — `bun test server/mail/rescue/`, tsc, biome, pathspec commit.

---

### Task 4: The detector

Loads `applied` actions, locates each one's live row, judges it, and on a rescue suspends the policy and
stamps the action. Read-only against every mailbox.

**Files:** Create `server/mail/rescue/detect.ts`, `server/mail/rescue/detect.test.ts`; modify
`server/mail/query/policies.ts` if suspension needs a writer it does not already have.

**Interfaces:**
- Consumes: `messageAddressForAction` (Task 1), `judgeRescue` (Task 3).
- Produces: `detectRescues(input: { port: RescuePort; mailbox_id: string; batch_size: number })`

- [ ] **Step 1: Define the port, then the pass**

Follow `ActionJournal` in `server/mail/actions/executor.ts` exactly — the database sits behind a port so
the pass can be exercised over a fake. A test that reached a real implementation would suspend live
policies and stamp 44,102 production rows.

The port needs: load applied, un-rescued actions for a mailbox; resolve a `MessageAddress` to a live row
returning `openedAt` and the thread's newest sent-by-me date; stamp `rescuedAt`; suspend a policy.

Two properties the implementation must hold:

- **Only rows with `rescuedAt IS NULL` are loaded.** That is what makes the pass idempotent and what
  stops it re-suspending a policy the operator has deliberately un-suspended.
- **Suspension is guarded `WHERE suspendedAt IS NULL`** — in the UPDATE, not the caller. A policy already
  suspended keeps its original reason, because the first rescue is the one that explains it.

- [ ] **Step 2: The reason text**

`suspensionReason` is what the operator reads before deciding whether to clear it. A reason they cannot
act on is one they will clear blindly. It must name the signal, the message, and the action:

> `rescued: you opened "xneelo Tax Invoice I260024265760" on 2026-08-21 after this rule archived it on 2026-08-20. The rule is suspended until you clear it; the action is in the journal and can be undone.`

- [ ] **Step 3: Tests over the fake port**

- an action opened after `appliedAt` → policy suspended, action stamped
- an action opened BEFORE → neither
- **a generic-flavour action whose message MOVED** → the port is asked for the `to_state_json` address,
  not the row id. This is Task 1's hazard, tested end to end.
- a second pass over the same data changes nothing (idempotence via `rescuedAt`)
- an already-suspended policy keeps its ORIGINAL reason
- an action with no policy (`senderPolicyId` null) is stamped but suspends nothing, and does not throw
- **the pass makes zero provider calls** — assert a fake provider, if one is present at all, recorded
  nothing. Rescue detection must never touch a mailbox.

---

### Task 5: Run detection inside the sync

**Files:** Modify `server/mail/sync/run.ts`; modify the runbook's schedule section.

- [ ] **Step 1: Place it correctly**

After the incremental fetch, before the shadow pass, inside the same run:

- `openedAt` is only fresh once the sync has observed the flag transition, so detection before the fetch
  reads stale data and silently under-reports.
- the shadow pass must not mint new decisions from a policy this run is about to suspend.

- [ ] **Step 2: A failure in detection must not fail the sync**

Detection is a safety net, not a precondition. If it throws, record the error on the run summary and let
the sync finish — a sync that refuses to run because the detector is broken leaves the operator with
neither fresh mail nor detection. Follow whatever error shape `runSyncForAllMailboxes` already uses for
per-mailbox failures rather than inventing one.

- [ ] **Step 3: Verify and commit** — full `bun test`, tsc, and **re-run the three invariant greps**.
Their output must be byte-identical to what the runbook already records. If it is not, stop and report.

---

### Task 6: Run classification and execution inside the sync

**§8's `auto` says "executes on the next sync run". Nothing does that today.** Verified before this plan
was executed: `runShadowPass` has exactly two non-test callers — the ORPC procedure and
`tmp/run-shadow.ts` — and `executeActions` has exactly one, the ORPC procedure. `runSyncForAllMailboxes`
does backfill, incremental, reconcile, reclassify and repair, and stops. Classification and execution are
things the operator triggers from the admin UI.

So this is not a small edit. It is the change from a tool the operator drives to a system that acts
unattended, which is exactly what the autonomy ladder exists to gate — so it gets its own task, its own
review, and its own guard rather than hiding inside the promotion step.

**Files:** Modify `server/mail/sync/run.ts`.

- [ ] **Step 1: The pipeline, in order**

```
incremental fetch          (existing)
        ↓
rescue detection           (Task 5)
        ↓
shadow pass                (existing function, newly called here)
        ↓
auto promotion             (Task 7)
        ↓
executor                   (existing function, newly called here)
```

- [ ] **Step 2: A run with no `auto` policies must do exactly what it does today**

This is the guard that makes the task safe to ship. If no policy is at autonomy `auto` — which is the
state of all 103 today — the promotion step promotes nothing, the executor finds no pending rows, and
the run's observable behaviour is unchanged. Test that explicitly: a sync over a database with zero auto
policies issues **zero mutations**.

- [ ] **Step 3: A failure in the shadow pass or executor must not fail the sync.** Same reasoning as
Task 5: fetching mail is the sync's job, and classification failing should not cost the operator their
mail. Record the error on the run summary and continue.

- [ ] **Step 4: The executor's batch size must be bounded here.** The ORPC path takes a `batch_size` from
the operator; a scheduled run has nobody to choose one. Pick a conservative default, state it in a
comment, and make it a named constant rather than a literal.

---

### Task 7: The autonomy promotion step

Only now does `auto` mean anything. Nothing before this task may promote a policy.

**Files:** Create `server/mail/actions/autonomy.ts`; modify `server/mail/sync/run.ts`.

- [ ] **Step 1: The step**

Between the shadow pass and the executor:

```
shadow pass writes every row at status `shadow`   (unchanged)
        ↓
promoteAutoPolicies: rows whose policy autonomy is `auto` → `pending`
        ↓
executor runs the pending rows                    (unchanged)
```

`buildShadowActionRow` keeps `status` hardcoded to `shadow` — the comment above it says no code path can
produce `pending`, and that stays true. Promotion is a separate guarded UPDATE, which also means an auto
policy's decisions travel the identical executor path as an approved one and `undo` cannot tell them
apart.

**The UPDATE is guarded on `status = 'shadow'` AND the policy being `auto` AND `suspendedAt IS NULL`.**
The suspension check belongs in the WHERE clause, not the caller: a policy suspended by a rescue between
the shadow pass and this step must not execute, and a check the caller performs is one a second caller
can skip.

`propose` needs no code — it is what the system does today, and exists in the ladder as a name for
current behaviour rather than a third branch.

- [ ] **Step 2: Tests** — an `auto` policy's shadow rows become pending; a `shadow` policy's do not; a
suspended `auto` policy's do not; an `applied` row is untouched; a second run is idempotent.

---

### Task 8: Promotion to `auto`, and its gates

**Files:** Modify `server/mail/actions/autonomy.ts`, `server/orpc/mail.ts`, `server/mail/query/policies.ts`.

- [ ] **Step 1: A dedicated procedure, not a field edit**

`upsertPolicy` keeps rejecting `"auto"` at the Zod boundary — **do not weaken it.** Promotion is its own
ORPC procedure with its own gate check, so a caller that can edit a policy's label cannot thereby grant
it unattended write access to a mailbox. Set `autonomyPromotedAt` in the same write.

- [ ] **Step 2: The gates**

| action | gate |
|---|---|
| `archive`, `file` | the operator has reviewed the shadow record — an explicit act, recorded |
| `auto_trash` | ≥30 days AND ≥20 decisions since `autonomyPromotedAt`, zero rescues, **and** `trashRetentionDays` set on that mailbox |
| `purge` | refused outright — §1.7's sweep is Phase 8 and is not a per-policy autonomy at all |

`trashRetentionDays` is NULL on all four mailboxes today, so the `auto_trash` gate is closed everywhere
and stays closed until the operator records a real figure. **NULL means unknown, never unlimited** — a
trash that silently empties in seven days makes "reversible for the retention window" a false claim.

No policy currently has action `auto_trash` (the 103 are 55 archive, 41 file, 7 keep_inbox), so that gate
is unreachable today. Implement it anyway: the first `auto_trash` policy should meet a gate that already
exists rather than one written to fit it.

- [ ] **Step 3: Demotion is unconditional.** Moving a policy back to `shadow` has no gate and never fails.
Making it easy to stop is what makes it safe to start.

---

### Task 9: The surfaces

**Files:** Modify `src/routes/admin/journal.tsx`, `src/routes/admin/senders.tsx`, `server/orpc/mail.ts`,
`server/mail/query/actions.ts`.

- [ ] **Step 1: Two surfaces, two questions**

The journal renders `rescuedAt` on the action — *this message was rescued*. The policy list renders
`suspendedAt` with its reason and a control to clear it — *this rule stopped, and why*. Neither
substitutes for the other.

- [ ] **Step 2: The promote control**

On the policy list: promote to `auto`, demote to `shadow`, and — when a gate refuses — say **which** gate
and what would satisfy it. "Not eligible" is a dead end; "needs a trash retention setting on this
mailbox" is an instruction.

- [ ] **Step 3: Follow the existing conventions.** Tailwind tokens from `tailwind.config.mjs` before any
arbitrary value; `clsx()` directly in the JSX prop as the sibling routes do; filter state in URL params;
`FC<{...}>` arrow components; named exports. `bun run build` regenerates the route tree, which is
gitignored — never commit it.

---

### Task 10: Runbook and ship

- [ ] **Step 1: Document the Phase 6 operator sequence** in
`docs/runbooks/2026-08-17-mail-sync-schedules.txt`, matching the PHASE 4 and PHASE 5 sections' voice:
apply `0008`; understand that detection now runs on every sync; how to read a suspension; how to clear
one; and that promoting to `auto` is a deliberate act with a gate.

- [ ] **Step 2: Re-run the three invariant greps and paste the real output.** For this phase the
expected result is **no change at all** — Phase 6 adds no mutation. A diff here is a finding.

- [ ] **Step 3: Full verification** — `bun run tsc`, `bun test`, `bun run build`, `bunx biome check`.

- [ ] **Step 4: Ship** — `git mv` the plan to `docs/plans/completed/` and the spec to
`docs/plans/specs/completed/`, add the closing marker naming what was verified and what was not.
**Hold this step until after the whole-branch review.**

---

## Self-Review

| §8 requirement | task |
|---|---|
| the three-level ladder | 6 (`auto`), 6 (`propose` = current behaviour), existing (`shadow`) |
| promotion is per policy, after review | 7 |
| `auto_trash` needs a clean cycle and a known retention | 7 |
| `purge` never promoted per policy | 7 (refused outright) |
| rescue detection from ordinary behaviour | 3, 4, 5 |
| automatic suspension with a reason | 4 |
| flagged on the dashboard | 8 |

**Deliberate gaps:** the starred signal (needs a `flaggedAt` column; the consequence is stated in the
spec §3.3 and in `signals.ts`), and automatic undo of a rescued action (a heuristic-triggered mutation is
what the ladder exists to prevent).

**Ordering:** Tasks 1–5 must land before Tasks 6–8. The spec is explicit that the net precedes the
automation, and a plan that built `auto` first would create exactly the window this phase exists to
close.

**Task interface conflicts:** Tasks 7 and 8 both edit `server/mail/actions/autonomy.ts`; Tasks 8 and 9
both edit `server/orpc/mail.ts`; Tasks 5, 6 and 7 all edit `server/mail/sync/run.ts`. Sequential
dispatch throughout, as the skill requires.

---

**Completed: 2026-08-21**
- Verified: `bun run tsc` 0 errors across 2,485 files · `bun test` 479 pass / 0 fail across 32 files ·
  `bun run build` succeeded · `bunx biome check` 0 errors. All three read-only-invariant greps re-run:
  same three files, same five call sites, same count — **this phase adds no mutating call site at all**,
  which is the expected result and the one the greps exist to confirm. Ten tasks, each individually
  reviewed; a whole-branch review found seven further defects, all fixed, and every fix was re-verified
  by reading the code directly.
- Open: **nothing in this phase has run against a live database or a real mailbox.** Migration `0008`
  (`0008_marvelous_ben_grimm.sql` — `Action.rescuedAt`, `SenderPolicy.autonomyPromotedAt`,
  `SyncRun.note`, and an index) is generated and **unapplied**; until it is, rescue detection and the
  new-mail classification pass both throw on every scheduled sync, and the note column that would make
  that visible is the very thing the migration adds. The admin routes have no component tests, so the
  surfaces were verified by typecheck, build and reading only — browser QA is the operator's.
  No policy has ever been promoted to `auto`; all 103 remain at `shadow`, so the pipeline is inert by
  construction. Silence = confirmed.
- Deliberate gaps, each recorded in the spec rather than left to be discovered: the **starred** signal
  needs a `flaggedAt` column and is absent, so a message rescued only by starring is not detected; a
  message the operator **moves a second time** becomes undetectable; rescues are looked for only within
  **30 days** of the action; and a **promoted-but-unexecuted** row waits for the operator's Apply rather
  than being retried by the sync, because automatic recovery would need the very join that keeps a timer
  away from operator-approved rows.
- Deferred: `PolicyIndex.by_id` (three call sites derive "which policy fired" from a scope plus a
  normalized key rather than reading `decision.policy_id` — no divergence is constructible today), and
  `promoteAction`'s single-row operator path still ignores its new return value.
