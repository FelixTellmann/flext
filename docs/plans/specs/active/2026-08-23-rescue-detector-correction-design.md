# Rescue Detector Correction — Design

**Status:** active
**Date:** 2026-08-23
**Amends:** `docs/plans/specs/completed/2026-08-20-email-phase-6-autonomy-design.md` §8 (rescue detection)

## 1. Problem

The first real use of the rescue detector — the incremental sync of 2026-08-22, run
immediately after the 7,593-message bulk apply — reported **1,562 rescues** and
**suspended 34 sender policies**. Every one of those rescues is false.

The detector is the safety net for the autonomy ladder: it is what makes `auto`
promotion defensible, because it is supposed to notice when a rule hid something the
operator wanted. A net that fires on 1,562 of 7,593 applied actions is not a net. It
is noise that disables the operator's own rules, and it would have made the `auto`
level actively dangerous had any policy been promoted to it.

### 1.1 Evidence

The 1,562 rescued rows carry only **six distinct `openedAt` values** between them:

```
736 messages share openedAt = 2026-08-21 09:30:23.302  (felix@platter.com)
593 messages share openedAt = 2026-08-21 09:00:21.672  (felix@platter.com)
 81 messages share openedAt = 2026-08-21 09:45:25.628  (felix@platter.com)
 70 messages share openedAt = 2026-08-21 11:45:04.390  (felixtellmann@gmail.com)
 64 messages share openedAt = 2026-08-21 10:17:18.725  (felix@platter.com)
 18 messages share openedAt = 2026-08-21 11:30:02.679  (felixtellmann@gmail.com)
```

Those six values are six sync runs. Nobody opens 736 unrelated messages — a Carta
option grant, a Loom survey, a flight price alert — in the same millisecond.

All 34 suspensions cite the `opened` signal; **none** cite `replied` (see §2.3 for
why that is itself a defect, not a coincidence).

## 2. Root causes

Three distinct defects, each independently sufficient to break the net.

### 2.1 The apply causes its own false rescues

`server/mail/sync/incremental.ts:71` stamps:

```ts
opened_at: sql`COALESCE(${message.opened_at}, ${now})`
```

on **any** CONDSTORE flag report whose flags include `\Seen`. It never consults the
message's previously known seen state, so it cannot distinguish:

- **a genuine transition** — the sync knew the message was unseen, and now it is seen.
  This is evidence that somebody opened it.
- **a first observation of already-read mail** — the sync is seeing this message's
  flags for the first time, and it was read long before this system existed. This is
  evidence of nothing at all.

The loop is self-inflicted, and that is what makes it fire at scale. Applying an
action mutates the message (a `MOVE`, or a Gmail label change), which **bumps its
MODSEQ**. The next incremental sync asks for everything above the stored MODSEQ and
the server therefore re-reports every message the apply just touched — each carrying
the `\Seen` it has carried for years. `applyFlagChanges` stamps `openedAt = now` on
all of them, which is necessarily later than `appliedAt`.

Every bulk apply thus manufactures a rescue for every already-read message it moves.

### 2.2 `openedAt` cannot mean what §8 reads it as

`server/mail/rescue/signals.ts` documents `opened_at` as "the FIRST `\Seen`
transition the sync observed", and reasons that this is coarse but safe because it
"always lands after the real open". That holds for mail that arrives while the system
is watching. It is false for **backfilled** mail: the first observation lands whenever
a sync happens to look, which — per §2.1 — is routinely after an apply.

The comparison `opened_at > applied_at` is therefore not a claim about the operator's
behaviour. For backfilled mail it is a claim about sync scheduling.

### 2.3 Reply detection has never once succeeded

`server/mail/rescue/journal.ts:152` selects:

```ts
sql<Date | null>`MAX(${message.internal_date})`
```

The type parameter is an **assertion, not a conversion**. Drizzle converts values for
real column selects; a raw `sql<>` expression is passed through untouched, so mysql2
returns a **string**. `judgeRescue` then calls `.getTime()` on it and throws:

```
rescue detection failed: unknown: candidate.getTime is not a function
```

observed on `felix@listifyregistry.com` in the 2026-08-22 run.

Because `judgeRescue` checks reply **before** open (deliberately — reply is the
stronger signal), the first candidate thread containing any reply aborts the entire
rescue pass for that mailbox. The stronger of the two signals has never fired
successfully in production. The zero `replied` suspensions in §1.1 are that defect,
not an absence of replies.

## 3. Decisions

### D1 — An `opened` rescue requires the message to have been unseen at apply time

`Action.from_state_json` already records the message's flags at the instant of
mutation, captured by the executor:

```json
{"folder":"[Gmail]/All Mail","uid":1906,"flags":["\\Seen"],"labels":["\\Important","\\Inbox"]}
```

A message that was **already `\Seen` when the rule moved it** cannot be rescued by
being opened. There is no open to detect; the operator had already read it. The
detector must require `\Seen` to be *absent* from `from_state_json.flags` before an
`opened` verdict is available.

**Why this over a heuristic.** This is not a threshold or a de-duplication trick that
happens to suppress the observed noise — it is the definition of the signal. The
guard makes the false positive *unrepresentable* rather than merely unlikely, which is
the pattern this codebase reaches for elsewhere (§6's DKIM gate, `policyEditColumns`).

**Measured effect.** Of the 1,562 false rescues, **1,562 were `\Seen` at apply time
and 0 were not.** D1 alone eliminates the entire observed cascade, with no false
negative in the observed set.

**Cost, accepted.** A message the operator had already read, which a rule then
archived, and which the operator then deliberately re-opened, is no longer detected as
a rescue. Re-opening already-read mail is weak evidence of regret — it is as easily a
glance while triaging — and the `replied` signal (D3, working for the first time)
covers the unambiguous case.

**Rejected alternative — suppress bulk stamps.** Detect that N messages share one
`openedAt` and discard them. Rejected: it is a heuristic with a threshold to tune, it
would discard a genuine mass-open, and it leaves the underlying meaning of `openedAt`
wrong for every future reader.

### D2 — `opened_at` is stamped only on an observed transition

`applyFlagChanges` stamps `opened_at` only when the stored `is_seen` is currently
false. A flag report for a message already known to be seen updates flags and nothing
else.

**Consequence, stated rather than hidden.** Mail that was already read when it was
backfilled never receives an `opened_at`, because the system has no evidence of when
it was opened and must not invent one. `felix@tellmann.co.za` demonstrates the end
state: 4 of 4,719 applied messages carry an `openedAt`. That mailbox's `opened`
detection is therefore near-blind, and honestly so. This is the same class of
documented blindness as `starred` in `signals.ts` §8, and it is recorded in the same
place.

D2 is redundant with D1 for the observed failure — either alone stops it. Both ship:
D1 is the semantic guard at the point of judgement, D2 stops the database
accumulating timestamps that assert something untrue. A future reader of `openedAt`
must not have to re-derive §2.2.

### D3 — Reply timestamps are converted, not asserted

The aggregate is converted to a real `Date` at the query boundary. `judgeRescue`
additionally stops trusting its input's declared type: a non-`Date` reaches the
verdict as "no signal", never as a thrown exception, because a rescue pass that
crashes is a safety net that is silently absent.

**Why both.** The cast fix alone leaves the next raw `sql<>` aggregate free to
reintroduce the same crash. The defensive read alone leaves reply detection quietly
returning nothing. The pair makes the failure both impossible and non-fatal.

### D4 — The false rescues and suspensions are unwound

The 1,562 `rescuedAt` stamps and the 34 policy suspensions are data written by a
detector that was wrong. They are reverted, scoped exactly to rows D1 disqualifies —
`from_state_json.flags` contains `\Seen` — so a genuine rescue, if one existed, would
survive the repair. In the observed data no row survives that filter, which is the
expected result and must be asserted by the repair rather than assumed.

The repair runs once, from a reviewed script, against production. It does not become
a scheduled job.

## 4. Out of scope

- **Spam and scam handling.** The operator's stated priority, and a genuine gap: the
  mail codebase contains no reference to spam, junk, phishing or scams, and every
  decision is sender-policy-driven. `felix@tellmann.co.za` carries 3,565 inbox
  messages against 1 in `INBOX.Junk`. Tracked separately; not solved here.
- **The 249 failed actions** from the bulk apply, whose server-side outcome is
  unknown. Unrelated cause, separate work.
- **Production TLS hardening** for the Bun dual-stack connect crash.

## 5. Verification

- `judgeRescue` returns `{rescued:false}` for a message seen at apply time, whatever
  its `openedAt`.
- `judgeRescue` returns a `replied` verdict for a string reply timestamp rather than
  throwing.
- `applyFlagChanges` leaves `opened_at` null for a message already stored as seen, and
  sets it for one stored as unseen.
- After the repair: 0 rows with `rescuedAt` set whose `from_state_json` contains
  `\Seen`; 0 policies suspended by the 2026-08-22 cascade.
- A re-run of the incremental sync produces 0 rescues and 0 suspensions.
