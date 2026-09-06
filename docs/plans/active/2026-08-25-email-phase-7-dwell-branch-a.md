# Inbox Dwell — Branch A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Read mail that has sat in the inbox for a week leaves it automatically, and quarantined first contacts stop carrying an unread badge into a folder nobody opens.

**Architecture:** A fourth mutating verb (`set_flags`) with a real inverse; a `pre_mutations` prefix on a plan so an action can mark a message read in the same batch as its move; a new resolution step 6.5 in `decide()` that fires only where the ladder had no opinion; and a Settled sweep stage that runs after classify-and-execute with the opposite scoping.

**Tech Stack:** TypeScript, Drizzle/MySQL, imapflow, bun:test.

**Spec:** `docs/plans/specs/active/2026-08-25-inbox-dwell-design.md`

**Scope note:** Branch A only. Session detection (B) and the Declined sweep (C) are not in this plan and nothing here may depend on them.

## Global Constraints

- No `any`; `type` over `interface`; named exports only. Biome, line width 140.
- Never run a dev server; verify with `bun run tsc` and `bun test`.
- Never run `db:push` / `db:migrate` / raw DML. Schema change → edit `schema.ts`, `bun run db:generate`, surface the SQL for the operator to apply.
- **A `pre_mutation` may never relocate a message.** It is issued against the same `(folder, uids)` as the primary mutation, so a move there would invalidate the UIDs addressing the mutation that follows it.
- **The stored-state write of §1.5 is not optional and not an optimisation.** Omitting it re-creates `565fb58` — the sweeps would suspend themselves as false rescues and, once Branch B lands, fabricate their own triage sessions.

---

## Plan-time amendment to the spec

The spec's §4 phasing puts §1.11 (dwell suspension) in Branch C. **That is wrong and this plan moves it to A.**

Settled reaches `auto` during Branch A — that is the entire point of shipping A first. A sweep running unattended with no `sender_policy_id` has nothing for the rescue detector to suspend, so the newest and least-proven rule in the system would be the only one with no safety net, for however many weeks A runs alone. The columns and the rescue handler ship here, in Task 6.

Amend §4 of the spec when this plan is ticked off.

---

### Task 1: `set_flags` in the pure layer

**Files:**
- Modify: `server/mail/actions/kinds.ts`
- Test: `server/mail/actions/kinds.test.ts`

- [x] **Step 1: Add the verb to `MailboxMutation`**

```ts
| { verb: "set_flags"; add_flags: string[]; remove_flags: string[] }
```

- [x] **Step 2: Add `normalizeFlags`, mirroring `normalizeLabels`**

A flag set is a set, not a sequence. Without canonical ordering a round trip that removes `\Seen` and adds it back returns the same set in a different order, and `to_state_json` differs run to run for an identical mailbox state. `server/mail/actions/state.ts` already sorts and de-duplicates on capture, so this keeps the two spellings in agreement.

- [x] **Step 3: Add the `set_flags` branch to `applyToState`**

```ts
const remaining = state.flags.filter((flag) => !mutation.remove_flags.includes(flag));
return { ...state, flags: normalizeFlags([...remaining, ...mutation.add_flags]) };
```

No `requireFlags` equivalent is needed: `flags` is `string[]`, never null. That asymmetry with `labels` is real — a generic IMAP server has flags but no labels — and should be stated in a comment rather than papered over with a null check that can never fire.

- [x] **Step 4: Add the `set_flags` branch to `inverseOf`**

```ts
add_flags: mutation.remove_flags.filter((flag) => from_state.flags.includes(flag)),
remove_flags: mutation.add_flags.filter((flag) => !from_state.flags.includes(flag)),
```

Identical in shape to the `set_labels` branch, and returns `[]` when it would change nothing rather than issuing an empty `STORE`.

- [x] **Step 5: Test the round trip on its own**

`applyToState` then `inverseOf` then `applyToState` returns the exact original flag set, including the case where the message was *already* `\Seen` — where the inverse must be empty, not "remove `\Seen`".

### Task 2: `pre_mutations` on a plan

**Files:**
- Modify: `server/mail/actions/kinds.ts`
- Modify: `server/mail/actions/executor.ts`
- Modify: `server/mail/actions/undo.ts`
- Test: `server/mail/actions/kinds.test.ts`, `server/mail/actions/undo.test.ts`

`inverseOf` already returns a sequence and undo already issues one, re-addressing between mutations. Only the forward direction is singular, and quarantine-marks-read needs two. This task closes that asymmetry in the narrowest way that stays safe.

- [x] **Step 1: Add `pre_mutations: MailboxMutation[]` to `PlannedAction`**

Every existing `planFor` branch returns `pre_mutations: []`. `mutation` stays the primary, possibly-relocating one, so `groupKeyFor`, the `COPYUID` handling and the `to_state_json` shape are unchanged.

Document the invariant on the field: **a `pre_mutation` is address-preserving.** It is issued against the same folder and UID set as `mutation`, which is only sound while nothing in it moves the message.

- [x] **Step 2: Fold `pre_mutations` in `inverseOf`**

The inverse of `[...pre, main]` is `[inverse(main), ...inverse(pre).reverse()]`. `inverse(main)` restores the address first, so the flag restore that follows lands on the message where undo has just put it — which is exactly what `issueMutation` already returns a fresh address for.

- [x] **Step 3: Fold `pre_mutations` in `undoStates`**

`undo.ts:155` seeds the state chain with `applyToState(plan.mutation, from_state)`. It must fold the pre-mutations first, or the chain starts from a state the executor never produced and the sequence-validity check compares against fiction.

- [x] **Step 4: Include `pre_mutations` in `groupKeyFor`**

Two rows with the same folder and same primary mutation but different pre-mutations must not batch together — they need different `STORE` commands. Key on the serialized prefix alongside the existing terms.

- [x] **Step 5: Issue `pre_mutations` before the primary in `performMutation`**

Same folder, same UID set, in order, before the existing call. A failure in a pre-mutation fails the group exactly as a primary failure does; there is no partial-success path where the flag landed and the move did not, because the flag write is idempotent and the next run re-reads state.

- [x] **Step 6: Test the composed round trip**

A quarantine plan carrying a `\Seen` pre-mutation, applied then undone, restores folder, labels **and** flags to the exact captured `from_state`. Both flavors. This is the test that proves the whole task.

### Task 3: `setFlags` on the provider

**Files:**
- Modify: `server/mail/providers/types.ts`
- Modify: `server/mail/providers/imap.ts`
- Test: `server/mail/providers/imap.test.ts`

- [x] **Step 1: Add `setFlags` to `MailboxProvider`**

```ts
setFlags: (folder: string, uids: number[], change: FlagChange) => Promise<FlagResult>;
```

- [x] **Step 2: Update the "these are the only members that may mutate" comment**

`providers/types.ts:107` names `moveMessages`, `setLabels` and `createFolder` as the complete mutating set. A fourth member that quietly joins an exhaustive list stated in a comment is exactly the drift the comment exists to prevent.

- [x] **Step 3: Implement over `UID STORE`**

`+FLAGS` for additions and `-FLAGS` for removals, `.SILENT` on both, and never `FLAGS` — a bare set would clear every flag not named, including `\Flagged`, which is the operator's hold signal and an absolute guard.

- [x] **Step 4: Test that a removal never issues a bare `FLAGS`**

### Task 4: Quarantine marks read, and the stored-state write

**Files:**
- Modify: `server/mail/actions/kinds.ts`
- Modify: `server/mail/actions/executor.ts`
- Modify: `server/mail/sync/incremental.ts` (comment only)
- Test: `server/mail/actions/executor.test.ts`

- [x] **Step 1: Give both `quarantine` branches of `planFor` a `\Seen` pre-mutation**

```ts
pre_mutations: [{ verb: "set_flags", add_flags: ["\\Seen"], remove_flags: [] }],
```

Both flavors, so the rule does not depend on whether quarantine happens to be a move or a label swap.

- [x] **Step 2: Write `message.is_seen = true` before the mutation is issued**

For any live row whose plan adds `\Seen`, in the same transaction as the journal write. **Before, not after** — deliberately. If the process dies between the IMAP `STORE` and the database write, a stored `is_seen` of 0 means the next sync witnesses the transition and stamps `openedAt`, and the rescue detector reads it as the operator rescuing the message. Writing first inverts the failure: the mutation fails, the row says seen, and the next flag fetch corrects it with no `openedAt` written. One direction self-heals; the other suspends policies.

- [x] **Step 3: Extend the SET-clause comment in `incremental.ts`**

That comment currently explains only why `opened_at` must be assigned above `is_seen`. It now also carries the load for §1.5 — the stored-`is_seen` guard is what stops the system's own flag writes from reading as human reads. Say so where the guard lives, not only in the spec.

- [x] **Step 4: The regression test for `565fb58` in its new disguise**

Execute a quarantine that marks read; feed the resulting `\Seen` back through the incremental flag path; assert `openedAt` is still null, no rescue row is written, and no policy is suspended. This test is the reason Task 4 exists as its own task rather than folded into Task 2.

### Task 5: The sweep rung at step 6.5

**Files:**
- Modify: `server/mail/classify/rules.ts`
- Modify: `server/mail/classify/guards.ts`
- Test: `server/mail/classify/rules.test.ts`

- [x] **Step 1: Add `sweep_settled` to `DECISION_SOURCES`**

- [x] **Step 2: Add a `settled_sweep_candidate: boolean` to `DecisionInput`**

Computed by the caller from stored columns, never inside `decide()` — the function stays pure over its input and gains no notion of "now" beyond the `age_days` it already has.

- [x] **Step 3: Insert the branch between `derivedOutcome` and the fallback**

It must sit *below* `derivedOutcome` and *above* the `fallback` return. Everything about §1.8's table follows from that position: steps 1–6 return before it is reached, so each of them beats a sweep without a single explicit check, and only the step-7 fallback is displaced.

The branch fires only when `derivedOutcome` returned `null` — a derived rule that named `archive` or `needs_action` has an opinion and keeps it. `needs_action` is what protects the Needs Action queue in Branch A, with no special case anywhere.

- [x] **Step 4: Exempt the Settled sweep from `replied_in_thread`**

`isBlocked` is consulted for the sweep's `archive` exactly as it is for a derived action, with `replied_in_thread` filtered out of the verdict list for this caller only. Comment it against §1.10: the guard protects against a *sender rule* archiving live client mail, and a week-old read message is a different claim. Never Declined, never a policy, never a destructive kind.

- [x] **Step 5: One fixture per row of the spec's §1.8 table**

Seven cases, and the seventh is the one that matters: flagged beats it, snoozed beats it, `done` beats it, an address policy beats it, a domain policy beats it, a first contact beats it, a derived `archive` beats it, a derived `needs_action` beats it — **and the bare fallback does not.** A test suite that only proves the sweep fires would have passed against the inert first draft of this design.

### Task 6: The Settled sweep stage, at `shadow`

> **Deviation, taken deliberately.** This task planned a new `server/mail/sweep/settled.ts`. Building one
> would have meant a second `buildDecisionInput`, a second thread-facts scan and a second spelling of every
> signal — the two-semantics-in-two-files shape this codebase repeatedly warns against. `runPass` in
> `shadow/run.ts` is parameterised instead, and the sweep is a third entry point beside the operator's full
> sweep and the scheduled classify pass. Same scoping guarantees, no duplicated classifier.

**Files:**
- Modify: `server/mail/shadow/run.ts` (+ `run.test.ts`) — `SettledSweepScope`, `runSettledSweepPass`
- Modify: `server/mail/query/signal-sql.ts` — `isInInboxSql`, the one spelling of inbox membership
- Modify: `server/db/schema.ts` — three `Mailbox` columns, migration `0009_tidy_menace.sql`
- Modify: `server/mail/sync/run.ts` — stage 6
- Modify: `server/mail/rescue/detect.ts`, `journal.ts` (+ tests) — §1.11

- [x] **Step 1: Add the `mailbox` columns**

`dwell_settled_days` (default 7), `dwell_suspended_at`, `dwell_suspension_reason`. Then `bun run db:generate` and **surface the SQL — do not apply it.**

Generated as `server/db/migrations/0009_tidy_menace.sql`. Three additive `ALTER TABLE Mailbox ADD`
statements, no drops. **Not applied** — Task 7 is blocked until the operator runs `bun run db:migrate`,
because the sweep's candidate query reads `dwellSettledDays`.

- [x] **Step 2: Write the candidate query**

In the inbox, `is_seen = true`, `internal_date` older than the mailbox's threshold, `disappeared_at IS NULL`, and no live `Action` row. Keyset cursor by id, same shape as the shadow runner's walk, so writing this batch's rows cannot make the next batch skip or repeat.

Note the scoping inversion explicitly in a comment: the classify pass takes rows with *no* `Action` row ever; this one takes rows that have been classified and left alone. They are deliberately complementary and must not be merged.

- [x] **Step 3: Journal decisions at `status = "shadow"`, `source = "sweep_settled"`**

- [x] **Step 4: Run it as stage 6 in `runMode`, incremental only**

After `runClassifyAndExecutePassForMailbox`, for the same reason classification runs after the Sent scan: this run's new messages and flag transitions are already written, so the sweep decides on current state rather than a pass-old one. Skip the mailbox entirely when `dwell_suspended_at` is set.

- [x] **Step 5: Handle a rescue against a sweep action**

Three rescues in a rolling 30-day window on rows with `source = "sweep_settled"` sets `dwell_suspended_at` and `dwell_suspension_reason` on that mailbox. A single rescue is journaled and surfaced only — opening week-old archived mail is ordinary behaviour, not evidence of a mistake. Without this the sweep is the one unattended rule in the system with no safety net (see the plan-time amendment above).

### Task 7: Verify against real mail before anything moves

- [ ] **Step 1: Shadow pass over every mailbox**

A script in `tmp/`. Record what Settled *would* archive, per mailbox, and how much of it is only reachable because of §1.10's `replied_in_thread` exemption — that number is the one worth eyeballing, since it is the guard this plan deliberately opens.

- [ ] **Step 2: Sample the caught set by hand**

Twenty rows across mailboxes. The failure this is looking for is a live thread that merely went quiet, not a mis-read timestamp.

- [ ] **Step 3: Confirm the quarantine path end to end**

One real quarantine with its `\Seen` pre-mutation, then undo it, then confirm the message is back in the inbox with its original flags and that `openedAt` was never written.

- [ ] **Step 4: Only then promote Settled from `shadow`**
