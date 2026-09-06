# First-Contact Quarantine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route mail from senders with no history to a reviewable folder, so scam mail stops reaching the inbox of a mailbox whose server-side filter does nothing.

**Architecture:** A new `quarantine` action kind, decided in `decide()` between the policy step and the derived step, planned like `archive` (label swap on Gmail, move on generic), and executed to a folder resolved by the same resolver filing uses.

**Tech Stack:** TypeScript, Drizzle/MySQL, imapflow, bun:test.

**Spec:** `docs/plans/specs/completed/2026-08-23-first-contact-quarantine-design.md`

> **Written retrospectively.** The work went spec → code directly, because the spec's §3 decisions and §6 verification list already were the task breakdown. This records what was built and how it was checked, so the branch's paper trail matches its commits. The step boxes are ticked because the code and its tests are in `be5e653`, not because a separate execution pass ran.

## Global Constraints

- No `any`; `type` over `interface`; named exports only. Biome, line width 140.
- Never run a dev server; verify with `bun run tsc` and `bun test`.
- Never run raw DML against production — every write is a reviewed script the operator runs.
- `quarantine` must be unreachable from a sender policy (spec D1's corollary).
- Every guard that blocks `archive` must block `quarantine` (spec D3).

---

### Task 1: The action class and the first-contact signal

**Files:**
- Modify: `server/mail/classify/guards.ts`
- Modify: `server/mail/classify/signals.ts`
- Test: `server/mail/classify/guards.test.ts`

- [x] **Step 1: Add `quarantine` to `ActionClass` and `ALL_ACTION_CLASSES`**

Every absolute guard blocks the whole set, so `flagged`, `too_recent` and `never_touch` cover the new kind with no further change.

- [x] **Step 2: Add `quarantine` to the `replied_in_thread` block list**

```ts
verdicts.push({ name: "replied_in_thread", blocks: ["archive", "quarantine", "auto_trash", "purge"], absolute: false });
```

Unreachable in combination with a first contact — a reply makes the sender known — but it states the rule and keeps it true if the first-contact test is ever loosened.

- [x] **Step 3: Derive `is_first_contact` in `deriveSignals`**

```ts
is_first_contact: input.sender_message_count <= 1 && input.my_reply_count === 0,
```

`<= 1`, not `=== 0`: `sender_message_count` is the `Sender` aggregate and already counts the message being classified. Testing for zero would make the rule dead code.

- [x] **Step 4: Update fixtures and run `bun test server/mail/classify/`**

### Task 2: The decision

**Files:**
- Modify: `server/mail/classify/rules.ts`
- Test: `server/mail/classify/rules.test.ts`

- [x] **Step 1: Exclude `quarantine` from `PolicyAction`**

```ts
export type PolicyAction = Exclude<ActionClass, "purge" | "quarantine">;
```

A policy naming it would be self-cancelling: its own existence disqualifies the message from the rule it names.

- [x] **Step 2: Add `first_contact` to `DECISION_SOURCES`**

- [x] **Step 3: Add the branch to `decide()`, after the policy step and before `derivedOutcome`**

Reaching the branch already proves no policy matched, so the "no policy" third of the test needs no separate check.

- [x] **Step 4: Test the precedence, not just the happy path**

Seven cases: quarantines a first contact; any policy wins; a sender with history is untouched; starred is protected; `never_touch` is protected; a snoozed thread suppresses it; and it outranks `derived`.

### Task 3: The plan and its execution

**Files:**
- Modify: `server/mail/actions/kinds.ts`
- Modify: `server/mail/actions/executor.ts`
- Modify: `server/mail/actions/undo.ts`
- Test: `server/mail/actions/kinds.test.ts`

- [x] **Step 1: Widen `PlanRequestKind` and add `QUARANTINE_KIND` / `QUARANTINE_LOGICAL_PATH`**

`PlanRequestKind` must list `quarantine` explicitly rather than inherit it from `PolicyAction`, which now excludes it.

- [x] **Step 2: Add `quarantine_folder` to `PlanContext` and the two `planFor` branches**

Archive's shape, not trash's: label swap on Gmail so the UID stays stable, move on generic. A null destination throws.

- [x] **Step 3: Resolve the destination in the executor through the existing filing resolver**

- [x] **Step 4: Route both destinations by the row's own kind, in the executor and in undo**

A quarantine row and a file row both carry a logical path by that point. Handing one to both fields type-checks perfectly while filing a message into Quarantine.

- [x] **Step 5: Test both flavors and the refusal**

### Task 4: Verify against real mail

- [x] **Step 1: Shadow pass over `felix@tellmann.co.za`**

`tmp/shadow-quarantine.ts`. 10,198 examined, **373 quarantine** against the spec's predicted ~367.

- [x] **Step 2: Confirm the caught set is the right one**

All 7 scam senders quoted in spec §1.1 were caught. Two known-legitimate first contacts (Deutsche Bahn, Nedbank) are in the set, as spec §2.3 predicted — the reason D2 makes this a review folder rather than a delete.

- [x] **Step 3: Scope the promotion**

`tmp/promote-quarantine.ts`. 373 → **324**: the same run also produced 3,007 archive and 1,375 file decisions that must not be re-promoted, 43 first contacts already live outside the inbox, and 6 messages already carry a live action.

**Completed: 2026-08-24**
- Verified: `bun run tsc` clean; `bun test` 506 pass / 0 fail (11 new); `bunx biome check` clean; shadow pass over 10,198 real messages producing 373 quarantine decisions, 7/7 of the spec's named scam senders among them; destination folder resolved to `INBOX.Quarantine` via `resolveWithoutCreating`.
- Open: no mail has been moved. The 324 promotions and the apply are staged as reviewed scripts for the operator to run (`tmp/promote-quarantine.ts`, `tmp/apply-pending.ts`), so the executor's quarantine path has been type-checked and unit-tested but not yet exercised against a live mailbox. Undo of a quarantine is likewise tested but not yet performed for real. Manual browser QA of the admin surfaces not done — silence = confirmed.
