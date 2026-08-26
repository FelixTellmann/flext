# Inbox Dwell and Read-State — Design Spec

**Date:** 2026-08-25
**Status:** Approved (design, grilled 2026-08-25); unbuilt
**Amends:** `docs/plans/specs/active/2026-07-27-email-management-design.md` §1.9, §5.1, §5.2, §5.3, §8
**Scope:** Give the classifier read-state and inbox dwell as inputs, so the inbox reaches zero unread
within roughly three days of arrival without a human filing anything by hand.

## Problem

Six phases shipped and the inbox still fills up. That is not a bug in any of them — it is a direct
consequence of §5.2 step 6, the safety spine: anything no rule names is left exactly where it is. Today
that describes most of the operator's inbox.

Three facts make the current shape insufficient:

1. **The operator reads mail in one unified all-inboxes view, on a phone, two or three times a day.**
   Opening folders is friction he will not spend. So anything the system files is, in practice, read
   later or never — which is fine, provided the filing decision is good.
2. **Unread count is the thing that actually hurts.** Mail sitting unread in the inbox is the visible
   symptom; the folder it eventually lands in is not.
3. **`is_seen` is already on every `message` row and reaches nothing.** It is read in exactly two
   places, both cosmetic: the Senders screen's unread column and a reason string on Needs Action. The
   highest-signal column in the schema is inert.

The operator's proposed shape was: read mail stays in the inbox at least 7 days; unread mail is filed
and marked read after 2 days; flagging holds anything indefinitely. He named the risk himself — an
absence longer than two days silently sweeps mail he never saw.

## Non-goals

- **Not a change to what gets filed where.** Sender policies, filing bindings and the client model are
  unchanged. This spec changes *when* a decision is reconsidered and adds two decisions; it does not
  change how a destination is chosen.
- **Not AI.** §1.4 of the master spec stands unchanged — no model is in the execution path, and this
  spec adds none.
- **Not a mail client.** The operator still reads mail where he reads it now.

---

## 1. Decisions

### 1.1 The clock counts exposures, not days

**Decision:** the unread sweep fires on *how many times the operator opened his mail while the message
sat unread*, never on wall-clock elapsed time.

"Unread for 2 days" conflates two states that are not alike:

- A message that appeared in the list and was scrolled past. It was **offered and declined**, which is
  real evidence about its value.
- A message that arrived while the operator was on a plane. **No evidence attached to it at all.**

Wall-clock time cannot distinguish them, and the difference is precisely the failure the operator was
worried about. Counting exposures makes the pause structural rather than a special case: no sessions
occur during an absence, so the counter does not advance, so nothing ages out. The rule needs no
"was he away?" heuristic, which is the component most likely to be wrong at the worst possible moment.

Rejected: **wall-clock dwell with an activity-freeze**. It reaches the same outcome by bolting the
safety property on as a correction rather than deriving it, and leaves two clocks that can disagree.

Thresholds, both per mailbox: **3 declines** for ordinary mail, **6** for mail the Needs Action signal
set claims (§1.7). At two or three inbox checks a day the first lands mail in its destination inside
roughly 24–36 hours of ordinary use — comfortably inside the three-day target — and stops dead the
moment the operator stops reading.

### 1.2 Exposure is derived, never stored

**Decision:** there is no `exposures` column. The count is a query:

```
exposures(message) = COUNT(attention_session WHERE started_at > message.internal_date)
```

evaluated only for messages that are currently unread and currently in the inbox.

A stored counter has to be incremented by something, and whatever increments it drifts the moment a
sync is retried, a run overlaps, or a message is re-keyed after a `UIDVALIDITY` change. Derived, it
cannot drift and it is trivially explainable on the Journal surface: *"present during 4 triage sessions,
never opened."*

`started_at > internal_date` is deliberately strict rather than overlapping. A message that arrived
*during* a session was probably not in the list when the operator scanned it, so that session does not
count against it. Erring toward under-counting delays a sweep; erring the other way sweeps something
that was never actually shown.

### 1.3 A session is global, because the operator does not read per mailbox

**Decision:** `attention_session` is **not scoped to a mailbox**. One session log for the operator.
Evidence observed in any mailbox opens a session, and that session counts as an exposure against unread
mail in every mailbox.

The per-mailbox version was the original draft and it is wrong for this operator. He reads one unified
all-inboxes list. A single check might produce two seen-transitions, both in the same mailbox — and
under per-mailbox scoping the other five would record no session at all, despite their mail having been
in the very same list he just scanned.

That fails in the safe direction (mail sits longer, nothing is lost) but it fails at the *job*: the
mailboxes accruing no sessions are the ones he never actively touches, which are the ones filling with
noise. The unread sweep would work only where he is already engaged and never fire where it is needed.
Precisely backwards.

**This is correct only while every mailbox is in that unified view**, which the operator confirmed on
2026-08-25. If a mailbox is ever removed from the phone, a global session would credit him with
declining mail he never had the chance to see — the dangerous direction — so that change must come with
a per-mailbox `in_unified_view` flag and a return to split counting for anything outside it. Recorded
here so the assumption is visible rather than buried.

### 1.4 A session is inferred from witnessed flag transitions, and only witnessed ones

**Decision:** a session opens when a sync observes evidence that a human was in the mail, and closes
when a quiet gap passes.

IMAP exposes no login timestamp and Dovecot's `last-login` is not portable across the four servers here,
so the evidence has to come from what the sync already sees. CONDSTORE reports everything above the
stored MODSEQ, and four kinds of change can only have been made by a person:

| Evidence | Source |
|---|---|
| unseen → seen transition | incremental flag fetch, guarded on the stored `is_seen` |
| `\Flagged` set or cleared | same fetch |
| a message in a folder no `Action` row moved it to | reconcile plus the action journal |
| a new message in the Sent folder | the existing Sent scan |

**A transition, never a raw report.** The session detector must derive seen-evidence through the same
stored-`is_seen` comparison `incremental.ts` already uses, not from the presence of `\Seen` in a
CONDSTORE response. Any mutation bumps MODSEQ, so a sync after a bulk apply is re-told about every
message it touched, each carrying flags it has held for years. Counting those raw would let the sweeps
manufacture their own triage sessions and accelerate their own clock — the same class of bug as
`565fb58`, in a new component. See §1.5.

**Not every transition is a session.** The operator's own framing is the calibration: *"I've read 2
emails and ignored 10 would be a good sign that I've checked my inbox."* A single seen-transition can be
a phone auto-preview or a notification tap. So a window qualifies only when it clears a **minimum
evidence threshold** — default: two or more distinct evidence events, or any reply sent.

Consecutive qualifying sync windows within a **2-hour gap** collapse into one session, so a twenty-minute
triage spread across three syncs counts once rather than three times. This is what keeps a single
sitting from burning through the whole decline budget.

Both numbers are guesses. They are stored as configuration precisely so they can be corrected from the
Sessions strip (§3) after a fortnight of evidence rather than argued about now.

### 1.5 The system marking mail read must not look like the operator reading it

**This is the sharpest hazard in the whole change, and it has already happened once.**

`server/mail/sync/incremental.ts` stamps `openedAt` on any observed unseen → seen transition. §8's rescue
detector reads `openedAt > appliedAt` as *"the operator rescued this"* and automatically suspends the
responsible policy. On 2026-08-22 a bulk apply bumped MODSEQ on ~1,562 already-read messages, the sync
was re-told about each one carrying a `\Seen` it had held for years, and the detector suspended 34
policies. That is `565fb58`.

Marking mail read is *the same shape of event, generated deliberately*. Left unhandled, every sweep
would mark its own messages read, the next sync would witness the transition, `openedAt` would land after
`appliedAt`, and the sweep would suspend itself as a false rescue — and, via §1.4, would also fabricate
session evidence and advance the exposure counter for every other unread message.

**Decision:** the executor writes `is_seen = true` on the `message` row **in the same transaction as the
journal write**, before the mutation is issued. The existing guard in `incremental.ts` — which only
stamps `openedAt` when the *stored* `is_seen` is 0 — then does the right thing with no change: the
transition is already recorded, so nothing is stamped, no rescue is fabricated, and no session evidence
is manufactured.

Rejected: **a sentinel millisecond on system-written `openedAt` values** (proposed 2026-08-25), where
every system stamp ends in the same three digits and readers test for it. It is mechanically viable —
`COALESCE(opened_at, now)` would preserve a pre-written value — but it writes a false fact and then marks
it false, rather than writing a true one. Three failure modes decided it: the marker is destroyed by any
`fsp` change on dump/restore, driver truncation, or the `UIDVALIDITY` re-key, and a destroyed marker
reads as a genuine human open; one real read in a thousand collides with the sentinel and is silently
discarded, which for a safety net is the worst available direction; and every future reader — Journal,
Senders, any MCP aggregate — has to know the magic number or reintroduce the bug elsewhere. The
underlying worry was right and is what produced §1.4's transition-not-report rule.

This makes the ordering in `incremental.ts` load-bearing in a second place. Its existing comment about
SET-clause evaluation order must be extended to say so.

### 1.6 `set_flags` is a fourth mutating verb, with a real inverse

**Decision:** add `{ verb: "set_flags"; add_flags: string[]; remove_flags: string[] }` to
`MailboxMutation`, and `setFlags` to `MailboxProvider`.

The provider surface is deliberately tiny — `moveMessages`, `setLabels`, `createFolder` are the only
members that may mutate anything. A fourth is a real widening and gets the same treatment as the others:

- `applyToState` gains a `set_flags` branch over `MailboxState.flags`, which is **already captured** in
  `from_state_json`, normalized and sorted (`server/mail/actions/state.ts`). No schema change is needed
  to make undo exact.
- `inverseOf` computes the restore the same way the `set_labels` branch does:
  `add_flags = mutation.remove_flags ∩ original`, `remove_flags = mutation.add_flags \ original`.
- A mutation that would change nothing is omitted rather than issued as an empty command, matching the
  existing `set_labels` behaviour.

**Ordering against a move.** A `MOVE` invalidates the source UID, so on a generic server the flag write
must be issued **before** the move, while the UID that addresses it is still valid. On Gmail, archive,
file and quarantine are all label rewrites with a stable UID, so either order works; the same order is
used on both flavors so there is one rule rather than a flavor-dependent one.

### 1.7 Quarantine marks read on the way out — and ships first

**Decision:** every `quarantine` action sets `\Seen` in the same batch as its move.

A first contact is currently moved to `Quarantine/` and left unread, so the unread badge follows it into
a folder the operator does not open. The unread flag is a claim about *the inbox*, and it stops being
true the moment the message leaves.

This is also the correct first customer for §1.6: one narrow, obviously-reversible use that exercises the
new verb, its inverse, and §1.5's stored-state write, before either sweep depends on any of it.

### 1.8 A sweep is a rung, and it sits directly above the fallback

**Decision:** the sweeps resolve as a new step **6.5** in §5.2's order. A sweep fires only where the
ladder would otherwise have returned `keep_inbox` from `derived` or `fallback` — the two outcomes that
mean *"no rule here has an opinion"*.

The first draft said a sweep "supplies a reason to reconsider, and the ladder still resolves". That is
inert, not safe. Trace a real Settled candidate — read, eight days old, from a known human, no policy:
no guard fires, the thread is open, no policy matches, it is not a first contact, `derivedOutcome`
returns `null` because it is not bulk — and it lands on step 6, `keep_inbox`. That is the safety spine
working correctly, and a sweep that honours it archives nothing, ever.

So the sweep must override something, and the boundary must be exact:

| Step | Against a sweep |
|---|---|
| 1 · absolute guards (flagged, < 24h, never-touch) | **wins** |
| 2 · thread state (snoozed, done) | **wins** |
| 3 · address policy, including `keep_inbox` and suspended | **wins** |
| 4 · domain policy | **wins** |
| 5 · first contact → quarantine | **wins** |
| 6 · derived, where it names an action or `needs_action` | **wins** |
| **6.5 · sweep** | fires here |
| 7 · fallback `keep_inbox` | overridden |

The property preserved is the one that matters: **anything a human explicitly told the system still
wins.** The sweep acts on the residue, which is the entire point.

**A useful consequence, and it should be documented on the Sender Policy surface:** an explicit
`keep_inbox` policy stops being decorative and becomes the permanent pin. It is how the operator says
"never sweep this sender" once, instead of starring every message they send.

**Needs Action is protected by this rule, not by a special case.** Direct human mail does not reach step
7 — step 6 returns `needs_action`, which names an action and therefore wins. That protection is free.
§1.9 then deliberately opens a narrow door through it.

### 1.9 The two sweeps, their candidates and their destinations

**Decision:** dwell runs as a sixth pipeline stage, after classify-and-execute, with its own scoping.

The scheduled classification pass filters to messages with **no `Action` row of any kind** — new mail is
the only input a scheduled run can have seen change, so re-deciding the rest buys nothing. Dwell is by
definition a decision that changes as time passes, so it needs the opposite scoping and cannot live
inside that pass without destroying its cost profile. This follows the precedent §1.7 of the master spec
set for the purge sweep: *"a separate scheduled sweep, never inline with classification."*

| Sweep | Candidates | Destination | Also |
|---|---|---|---|
| **Settled** | in inbox · `is_seen` · `age_days ≥ 7` | `archive` | — |
| **Declined** | in inbox · not `is_seen` · exposures ≥ 3 | the sender's policy action if one exists, else `archive` | sets `\Seen` |
| **Declined (Needs Action)** | as above, but exposures ≥ 6 | `Followup/` | sets `\Seen` |

**Why Needs Action mail is swept at all, at double the threshold.** It is the highest-value mail and also
the mail most reliably left unread, so protecting it forever means the unread count never reaches zero.
What makes sweeping it acceptable is a property of the existing query: `buildWhere` in
`server/mail/query/needs-action.ts` has **no folder predicate**. The queue is a query over live messages
by signal, not by location — so a swept message stays on the Needs Action screen for as long as its
thread is open and its sender is unsuppressed. The message leaves the inbox and the unread count; it does
not leave the surface built to catch it. Six declines is roughly two full days of seeing a person's mail
and choosing not to open it.

`Followup/` rather than the general archive so that mail a person is waiting on is not buried among
newsletters. Ordinary Declined mail goes to `archive`: a dedicated `Triage/` folder was considered and
rejected as one more folder the operator would not open. Revisit if the shadow run shows a large residue.

### 1.10 `replied_in_thread` does not block the Settled sweep

**Decision:** the Settled sweep is exempted from the `replied_in_thread` scoped guard. Every other guard,
absolute and scoped, applies unchanged.

That guard exists to stop a *policy* archiving active client correspondence on the strength of a sender
rule. The Settled sweep is a different claim: this specific message has been in the inbox a week and has
demonstrably been read. A thread the operator replied to a week ago and has not touched since is the
textbook settled thread — the best candidate for the sweep, not the worst. Left in place, the guard
exempts a large share of read inbox mail and the 7-day rule clears far less than expected.

Three of the four mailboxes are Gmail, where archive is a label removal: the thread stays in All Mail,
stays searchable, restores in one click, and a later reply arrives in the inbox as normal. Nothing is
muted.

The exemption is narrow and explicit: **Settled only.** Never Declined, never a policy, never a
destructive kind. Declined mail is unread by definition so the guard is unreachable there anyway; stating
it keeps the rule true if the definition ever loosens.

### 1.11 A sweep suspends the sweep, because it has no policy to blame

**Decision:** `mailbox` gains `dwell_suspended_at` and `dwell_suspension_reason`, and a rescue against a
sweep-sourced action sets them.

§8's rescue detection responds to a mistake by suspending the policy that caused it. A sweep action has
`sender_policy_id = NULL`, so an over-eager sweep has nothing to suspend and would keep firing forever
while the detector silently discarded every rescue for want of an id to blame. That is a safety net with
a hole exactly where the newest, least-proven rule sits.

Because a rescue on a *swept* message means something weaker than a rescue on a *policy* action — opening
archived mail later is ordinary behaviour, not necessarily an error — suspension is on a threshold rather
than the first event: **three rescues inside one rolling 30-day window** suspends that mailbox's sweeps.
A single rescue is journaled and surfaced, not acted on.

### 1.12 Flags are permanent, and that is an accepted risk

**Decision (operator, 2026-08-25):** flagging continues to freeze a message indefinitely. No expiry, no
release mechanism, no new column.

Once sweeps exist the flag becomes the only hold, so a permanent hold means the flagged set only ever
grows — reconstituting the same cluttered inbox with stars on it. This was put to the operator with two
alternatives and he chose to accept it, on the grounds that it needs no new habit and no schema change,
and that he flags deliberately enough for the set to grow slowly.

Recorded as a decision rather than an omission, with the two rejected shapes kept so a future revisit
starts from here rather than from scratch:

- **Flag expiry.** A new `flagged_at`, stamped when the sync first witnesses an unflagged → flagged
  transition (`isFlagged` records *that* a message is starred, never *when* — which is also why §8's
  `starred` rescue signal is still deferred). Already-flagged mail would be stamped on first observation,
  which only ever delays expiry.
- **Release via thread `done`.** No schema change, reuses existing machinery, but requires a habit on a
  surface the operator finds cumbersome to reach.

**Revisit trigger:** the Sender Policy surface should count flagged-and-held messages. If that count
passes 200, or grows by more than 50 in a month, this decision has failed in the predicted way and one of
the two shapes above should be built.

---

## 2. Data model

Two new columns, one new table, two new enum values. No changes to `message`.

**`attention_session`** — global, not per mailbox (§1.3).

| Column | Purpose |
|---|---|
| `started_at`, `ended_at` | the window; `started_at` is what §1.2's count compares against |
| `seen_transitions`, `flag_changes`, `manual_moves`, `replies_sent` | the evidence, kept so a session is auditable and §1.4's threshold is tunable after the fact rather than only before |
| `evidence_mailbox_ids` | which mailboxes supplied the evidence — not used by the counter, but the Sessions strip is uninterpretable without it |
| `sync_run_id` | which run observed it |

Index on `started_at` — §1.2's count is a range scan on exactly that column and runs once per candidate
batch.

**`mailbox`** gains `dwell_suspended_at`, `dwell_suspension_reason` (§1.11), and the thresholds
`dwell_decline_count` (default 3), `dwell_needs_action_decline_count` (default 6) and
`dwell_settled_days` (default 7), so a mailbox can be tuned or disabled without a deploy.

**`DECISION_SOURCES`** gains `sweep_settled` and `sweep_declined`. They are what makes a sweep action
distinguishable in the Journal, and what §1.11's rescue handler keys on.

`message` is deliberately untouched. Exposure is derived (§1.2), read-state already exists, and the
sweeps need no per-message bookkeeping.

---

## 3. Surfaces

- **Journal** gains the two new sources as filters, and renders the exposure count as the reason on a
  Declined row: *"present during 4 triage sessions, never opened."* A sweep that cannot explain itself in
  one line is not shippable.
- **A Sessions strip** on the dashboard: when the system last believed the operator was reading mail, and
  on what evidence, in which mailboxes. This is the calibration surface for §1.4's threshold — if it
  disagrees with the operator's memory of when he last checked mail, the threshold is wrong, and that has
  to be visible rather than inferred from sweep behaviour.
- **A dwell-suspension banner**, matching the existing policy-suspension banner (§1.11).
- **A held count** on Sender Policy, for §1.12's revisit trigger.

---

## 4. Phasing

| Branch | Ships | Depends on |
|---|---|---|
| **A** | §1.6 `set_flags` verb + inverse + `applyToState`; §1.5 stored-state write; §1.7 quarantine marks read; §1.8 the sweep rung; §1.9's sweep stage skeleton; §1.10; **Settled sweep** at `shadow` | nothing |
| **B** | §1.3/§1.4 session detection, `attention_session`, the Sessions strip | A |
| **C** | §1.2 exposure query; **Declined sweep** (both thresholds) at `shadow`; `Followup/`; §1.11 dwell suspension | B |

**Branch A is the whole of the operator's 7-day rule and needs no session detector.** It is also the
change that actually empties the inbox: read mail older than a week is the bulk of what sits there. It
can be promoted to `auto` and proven for weeks before B or C exist.

Both sweeps are born in `shadow` like every policy (§8). Neither is exempt.

---

## 5. Testing

The rules stay pure, so the sweeps stay fixture-testable: message state in, sweep verdict out, no mail
server. Four cases carry the risk and get dedicated fixtures:

1. **§1.5's false-rescue loop.** A sweep marks a message read; the next sync observes the transition;
   assert `openedAt` is not stamped, no rescue is recorded, and no session evidence is counted. The
   regression test for `565fb58` in its new disguise.
2. **§1.4's transition-not-report rule.** A bulk apply bumps MODSEQ on already-seen messages; assert the
   session detector counts zero evidence from them.
3. **§1.2's absence behaviour.** No sessions across a five-day window; assert the exposure count does not
   advance and no Declined candidate qualifies.
4. **§1.6's round trip.** `set_flags` composed with a move, then inverted, returns the exact
   `from_state_json` — flags, folder and labels together, on both flavors.

Plus a guard fixture per row of §1.8's table: each of steps 1–6 must beat a sweep that would otherwise
have fired, and step 7 must not.

The acceptance test is the same one every phase here has used: a full shadow run over real data,
measuring what each sweep *would* have done, before either is permitted to mutate anything.

---

## 6. Open items

- **§1.4's evidence threshold and collapse window** are guesses until the Sessions strip has run for a
  fortnight. Stored as configuration precisely so they can be corrected from evidence.
- **§1.3 assumes all six mailboxes stay in the unified view.** If that stops being true, global sessions
  become unsafe and need the `in_unified_view` split described there.
- **§1.12's revisit trigger** — the held count needs to exist on Sender Policy for the decision to be
  falsifiable.
- **Destination for Declined mail with no sender policy** is `archive`. Revisit with numbers if the
  shadow run shows a large unclassified residue.

## References

- `docs/plans/specs/active/2026-07-27-email-management-design.md` — the master spec this amends
- `docs/plans/specs/completed/2026-08-23-rescue-detector-correction-design.md` — why §1.5 exists
- `docs/plans/specs/completed/2026-08-23-first-contact-quarantine-design.md` — the quarantine §1.7 amends
- `docs/mockups/2026-08-25-email-triage-flows/index.html` — the current-state flow review this came out of
