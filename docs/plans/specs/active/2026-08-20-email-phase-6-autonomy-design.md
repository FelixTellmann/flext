# Phase 6 — Autonomy and rescue detection: design

**Parent spec:** `docs/plans/specs/active/2026-07-27-email-management-design.md` §8.

This document resolves what §8 leaves open and records two amendments to it. §8 stays the authority on
everything not contradicted here; where it is contradicted, the amendment is stated and §8 is annotated
with a pointer.

---

## 1. What Phase 6 is

§8 describes a per-policy autonomy ladder — `shadow` → `propose` → `auto` — and a rescue detector that
suspends a policy when the operator's own behaviour shows it was wrong. Phase 6 builds both.

They serve opposite instincts. Rescue detection is a safety net; autonomy removes the click that
currently substitutes for one. **The net must land first**, and the plan's task order must reflect that:
no policy may reach `auto` before the detector that catches its mistakes exists and has been exercised.

---

## 2. Current state, measured 2026-08-20

| | |
|---|---|
| Sender policies | 103, **all at `shadow`**, none suspended |
| `Action` rows | 44,102, **all at status `shadow`** — nothing has ever been applied |
| Mailboxes | 4; `trashRetentionDays` is **NULL on all four** |
| `Message.openedAt` | populated on 83 of 14,729 live messages |

Two things that matter more than the numbers:

**`autonomy` is read by nothing.** `loadPolicyIndex` selects the column and `PolicyRow` carries it, but
no consumer in `server/mail/classify`, `server/mail/shadow` or `server/mail/actions` branches on it. The
ladder is a column, not a behaviour. Phase 6 is what makes it real — which also means nothing can
regress, because nothing currently depends on it.

**`openedAt` already works.** `server/mail/sync/incremental.ts:71` sets it on the first `\Seen`
transition and never moves it afterwards, with a comment saying it exists for exactly this. The low
population count is correct rather than broken: only transitions the sync actually observes can be
recorded, and everything already read at backfill time is legitimately null. Rescue detection cares only
about opens *after* an action, which are all in the observable future.

---

## 3. Rescue detection

### 3.1 Amendment: it covers every applied action, not only automatic ones

§8 as written: *"If a message that was auto-archived or auto-trashed is subsequently opened, starred, or
replied to … the responsible policy is automatically suspended."*

**Amendment: any action at status `applied`, regardless of the autonomy level that produced it.**

The reason is the operator's actual first use. Phase 5 shipped with 44,102 shadow rows and nothing
applied; the next real step is a manually approved bulk apply of roughly 7,900 messages across ~100
policies. Restricting detection to `auto` would leave precisely that operation unwatched — the one that
needs watching most, because it is the first time any of this touches live mail.

An action's autonomy level records *how it was approved*. It says nothing about whether it was right,
and rescue detection is a claim about rightness.

### 3.2 A rescued message may no longer be the row the action points at

This is the hazard of the phase, and it has the same shape as two defects this project has already paid
for: something that works on Gmail and is silently blind on `felix@tellmann.co.za`, the largest mailbox.

`Message` carries two unique keys — `(mailboxId, folder, uidValidity, uid)` and `(mailboxId, gmMsgid)`.

- On **Gmail**, archiving removes the `\Inbox` label. The message stays in `[Gmail]/All Mail` with a
  stable UID and a stable `gmMsgid`, so the sync updates **the same row**. `Action.messageId` still
  addresses the live message.
- On **generic IMAP**, archiving is a folder move. The new `(folder, uid)` matches no existing row, so
  the sync **inserts a new row**, and reconciliation stamps `disappearedAt` on the old one. The new row
  starts with `openedAt` NULL.

So a detector that joins `Action.messageId → Message.openedAt` reads a dead row forever on tellmann and
would never fire there. It would appear to work — three mailboxes reporting rescues, one silent — which
is exactly how the Phase 3 sent-by-me guard hid for a whole phase.

**Resolution: detection follows the message to where the action put it.** `to_state_json` records the
destination the server confirmed — folder, UID and UIDVALIDITY, captured from `COPYUID` precisely so a
moved message stays addressable (§7.2). Rescue detection resolves the live row through that address, and
falls back to `Action.messageId` only when `to_state_json` is absent, which is the un-moved case.

One exported resolver owns this, and every consumer uses it. A second way of asking "where did this
message end up" is the two-spellings failure this project has now paid for seven times.

### 3.3 The signals

| signal | test | in scope |
|---|---|---|
| opened | the live row's `openedAt` is later than the action's `appliedAt` | yes |
| replied | a sent-by-me message in the same thread dated after `appliedAt` | yes |
| starred | — | **no**, see below |

**A message moved a second time becomes undetectable.** `to_state_json` records where the action put a
message; if the operator then finds it and files it somewhere else themselves, that address points at a
row the sync has since marked vanished, and the rescue cannot be seen. This is the same family as the
starred gap below and is stated for the same reason: the detector's blind spots belong on the record,
because a safety net whose holes are undocumented is worse than a smaller net whose holes are known.

**Starred is deliberately out of scope.** `isFlagged` records that a message *is* starred, never *when*
it became starred, so "you starred it after the rule hid it" is not expressible. Adding it means a
`flaggedAt` column mirroring `openedAt` — a first-transition timestamp set in the same place in the
incremental sync, which already reads the flag on every change and discards the timing.

The consequence is stated rather than hidden: **an operator who rescues a message by starring it, and
never opens or answers it, produces no detection.** For someone who reads a lot of mail anyway, starring
is the stronger signal of the two, so this gap is real. It is deferred to keep this phase's surface
small, and it should be the first thing added if rescue detection under-reports.

"Replied" reuses the existing thread grouping and sent-by-me machinery in
`server/mail/query/signal-sql.ts` rather than restating either — the same rule that made §1.9's queue and
the shadow runner agree.

### 3.4 What a rescue does, and what it must not do

**It suspends the policy** — `suspendedAt` and `suspensionReason` already exist on `SenderPolicy`, and
`server/mail/classify/rules.ts` already honours them, so a suspended policy stops producing decisions
with no further work. The reason text names the message and the signal, because a suspension the
operator cannot explain is one they will simply clear.

**It records the rescue on the action row** — a new nullable `Action.rescuedAt`. This is not decoration:
it makes detection idempotent (a rescue already recorded does not re-suspend a policy the operator has
since deliberately un-suspended), and it makes the journal able to show *which* action was rescued
rather than only that a policy is suspended.

**It does NOT undo the action.** An automatic mailbox mutation triggered by a heuristic is the precise
thing the autonomy ladder exists to prevent, and a false positive would move mail the operator had
deliberately left alone. Suspending stops the bleeding; reversing is the operator's, from the journal,
where undo-by-policy already exists.

**It does not un-suspend anything, ever.** Clearing a suspension is an operator act.

### 3.5 When it runs

After the incremental sync, before the shadow pass, inside the same run. `openedAt` is only fresh once
the sync has observed the flag transition, and the shadow pass should not mint new decisions from a
policy this run is about to suspend.

Rescue detection is **read-only against the mailbox**. It reads rows the sync has already written and
writes only to `SenderPolicy` and `Action`. It must not appear in the mutation greps.

---

## 4. The autonomy ladder

### 4.1 Where `auto` acts

`decide()` stays autonomy-blind: it answers "what should happen to this message", which does not depend
on how much the operator trusts the rule. Autonomy decides *what happens to the decision afterwards*.

```
shadow pass writes every row at status `shadow`   (unchanged)
        ↓
promotion step: rows whose policy is `auto` → `pending`
        ↓
executor runs the pending rows                    (unchanged)
```

`buildShadowActionRow` keeps `status` hardcoded to `shadow` — the comment above it says there is no code
path that could produce `pending`, and that must stay true. Promotion is a separate, guarded step, which
also means an auto policy's decisions travel exactly the same executor path as an approved one, and
`undo` cannot tell them apart.

**`propose` needs no code.** It is what the system does today: a decision waits for a click. It exists in
the ladder as a name for the current behaviour, not as a third branch.

### 4.2 The gates

§8's promotion gates, made concrete:

| action | gate |
|---|---|
| `archive`, `file` | the operator has reviewed the policy's shadow record — an explicit act, recorded |
| `auto_trash` | a full shadow cycle with **zero rescues** on that policy, **and** `trashRetentionDays` set on that mailbox |
| `purge` | never promoted per policy; §1.7's separate sweep, still Phase 8 |

`trashRetentionDays` is NULL on all four mailboxes today, so the `auto_trash` gate is closed everywhere
by default and stays closed until the operator records a real retention figure. NULL means *unknown*,
never *unlimited* — a trash that silently empties in seven days makes "reversible for the retention
window" a false claim.

**Editing a promoted policy demotes it.** A promotion is trust in the rule as its shadow record showed
it; editing the rule's action, client, or scope makes that record describe a rule that no longer runs, so
`upsertPolicy` resets `autonomy` to `shadow` on any edit rather than carrying the old value forward. This
is the same reasoning as rescue detection suspending a policy instead of merely logging the mismatch — a
changed rule has not yet earned trust for its new shape, and re-promotion is the operator's, through §4.3's
dedicated procedure.

### 4.3 Opening the boundary that has been closed since Phase 3

`upsertPolicy` rejects `"auto"` at the Zod boundary, deliberately, since Phase 3. **That rejection
stays.** Promotion to `auto` is not a field edit on a general-purpose update — it is its own procedure,
with its own gate check, its own audit trail, and its own scope. A general `upsertPolicy` that accepts
`autonomy: "auto"` would let any caller that can edit a policy's label also grant it unattended write
access to a mailbox.

The same shape the phase has used throughout: make the wrong thing unrepresentable rather than checked.

---

## 5. Schema changes

Two, both additive and both nullable:

```
Action
  + rescuedAt   datetime(3) NULL   -- when a rescue was detected against this action

SenderPolicy
  + autonomyPromotedAt datetime(3) NULL  -- when the operator promoted it, and thus what
                                          -- "a full shadow cycle since promotion" measures from
```

`SenderPolicy.suspendedAt`, `suspensionReason` and `autonomy` already exist. `Mailbox.trashRetentionDays`
already exists. No column is added for the starred signal — see §3.3.

Generated with `bun run db:generate`; the operator applies it. It will be `0008`.

---

## 6. What Phase 6 must not break

1. **The read-only invariant.** Mutating IMAP calls exist only in `server/mail/providers/imap.ts`,
   reached only through `moveMessages`, `setLabels` and `createFolder`, called only from
   `server/mail/actions/executor.ts`, `undo.ts` and `server/mail/filing/resolver.ts`. Rescue detection
   adds no mutation and must not appear in those greps. Auto execution reuses the executor and therefore
   adds no new call site either. **If this phase changes the grep output at all, something is wrong.**
2. **`purge` still does not exist**, in any form. §1.7 keeps it for Phase 8.
3. **`decide()` stays autonomy-blind** (§4.1).
4. **One semantic, one spelling.** The phase's candidate is "where did this message end up" (§3.2). One
   exported resolver, and a test that pins it.
5. **A suspended policy stops producing decisions** — already true via `rules.ts`; a Phase 6 change that
   breaks it removes the entire point of detection.

---

## 7. Explicitly out of scope

- **The starred signal** and its `flaggedAt` column (§3.3), with the gap stated.
- **Automatic undo** of a rescued action (§3.4).
- **`purge` and the sweep** — Phase 8.
- **Un-suspending a policy automatically.** Only an operator clears a suspension.
- **Re-running detection over the 44,102 historical shadow rows.** None was ever applied, so none can
  have been rescued.

---

## 8. Questions §8 left open, and how this document answers them

**8.1 "A full shadow cycle" means 30 days AND at least 20 decisions since promotion, with zero
rescues.** §8 does not define it, and the definition has to resist being satisfied in an afternoon: a
count alone falls to running the shadow pass in a loop, and a wall-clock window alone passes a policy
that decided nothing. Both, measured from `autonomyPromotedAt`, and reset by any rescue.

Note this gate is **unreachable today and that is fine** — no policy has action `auto_trash` (the 103
are 55 archive, 41 file, 7 keep_inbox), so nothing can currently request it. It is specified now so the
first `auto_trash` policy meets a gate that already exists rather than one written to fit it.

**8.2 A rescue suspends the policy everywhere, not per mailbox.** `SenderPolicy` has no mailbox scope,
so per-mailbox suspension would need a new table, and the safe reading does not need one: a rule that
guessed wrong once has lost the argument for acting unattended anywhere.

The cost is real and worth naming: a rule that is right on three mailboxes and wrong on one is suspended
on all four, and the operator has to split it into narrower policies to recover the three. That is the
correct direction to fail — a suspension the operator must actively clear, rather than a rule that keeps
acting somewhere after being shown to be wrong.

**8.3 A suspension appears in both surfaces, because they answer different questions.** The journal
renders `rescuedAt` on the action — *this specific message was rescued* — and the policy list renders
`suspendedAt` with its reason — *this rule is no longer running, and why*. Neither substitutes for the
other: the action answers "what happened to my mail", the policy answers "what has the system stopped
doing on my behalf".
