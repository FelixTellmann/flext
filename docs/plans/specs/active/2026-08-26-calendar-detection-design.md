# Calendar Message Detection — Design Spec

**Date:** 2026-08-26
**Status:** Approved (design); unbuilt
**Amends:** `docs/plans/specs/active/2026-07-27-email-management-design.md` §1.3, §4.2, §5.1
**Scope:** Recognise a calendar message by what it *is*, so meeting churn can be filed away without a rule
that also swallows the sender's real mail.

## Problem

An unclassified-sender sweep on 2026-08-26 found the operator's largest single block of unsorted mail is
not newsletters or spam. It is **meeting churn from colleagues** — roughly 263 messages across the three
enabled mailboxes:

```
65  jess@platter.com                Updated invitation: Weekly Felix / Jess Sync
43  kieran@platter.com              V4 Sprint Planning
43  nigel@platter.com               Updated invitation: Felix <> Nigel
22  sarah@platter.com               Updated invitation: Venus - Custom Features Review
22  elizabeth@listifyregistry.com   Updated invitation with note: Listify Support Call
18  romina@platter.com              Updated invitation: Professional Services - Weekly sync
...
```

**No policy can express this.** §5.2 resolves on sender address and sender domain, and these senders are
colleagues who also send real mail. A policy on `jess@platter.com` would archive her calendar spam and her
actual correspondence with equal enthusiasm, which is the failure the whole guard system exists to
prevent. So the system's answer today is to leave all 263 in the inbox, forever.

**They are also mislabelled.** `server/mail/sync/writer.ts:210` derives `has_attachment` from a top-level
`Content-Type` starting `multipart/mixed`, which every calendar invite is — the `.ics` rides as an
attached part. So §5.3's `human_attachment` guard, written to mean *"a real person sent me a document"*,
currently fires on automated meeting noise. Not harmful today (that guard blocks only trash and purge) but
it is a signal that means something other than what it says.

## Non-goals

- **Not calendar integration.** Nothing here reads an event, a time, or an attendee list. The only
  question asked is "is this a calendar message?"
- **Not a general subject-matching rule engine.** See §1.2.

---

## 1. Decisions

### 1.1 The signal is the message's structure, and reading it fetches no body

**Decision:** ask the server for `BODYSTRUCTURE` alongside the headers already fetched, and treat a
message as a calendar message when any part of it is `text/calendar`.

**This does not breach §1.3's "bodies are never fetched or persisted".** `BODYSTRUCTURE` is the server
*describing* the MIME tree — part types, encodings, sizes — and transferring none of it. imapflow exposes
it as `bodyStructure: true` on the same `fetch` that already carries `envelope` and `headers`
(`node_modules/imapflow/lib/imap-flow.d.ts:408`), so it costs one extra data item on a round trip already
being made, not a second fetch.

What is persisted is a single boolean. No part of the message is stored.

**Rejected: the top-level `Content-Type` header**, which is already fetched. It reads `multipart/mixed`
on a Google Calendar invite — identical to any message with an attachment. The `text/calendar` part is
nested, and the top-level header cannot see it. This was proposed and withdrawn during the design
conversation; recorded because it looks like the cheap answer and is not an answer at all.

### 1.2 Structure, not subject text

**Decision:** never match on the subject line for this.

The subject route is tempting because the data is so consistent — `Updated invitation:`, `Canceled
event:`, `Accepted:` — and it needs no schema change at all. It is still wrong:

- **Subjects are written by the sender.** Matching them is matching attacker-controllable text, which
  §1.6 treats as untrusted everywhere else in this system.
- **Subjects are localised.** Google Calendar translates that prefix per the *organiser's* locale. The
  operator already receives German mail from Wunderflats; a colleague switching locale silently breaks
  the rule, and it breaks by archiving the wrong thing rather than by erroring.
- **A near-miss is invisible.** `Re: Updated invitation` from a human asking about a meeting is real
  correspondence that a loose pattern eats.

Message structure is not translated and not composed by hand. A message either carries a `text/calendar`
part or it does not.

### 1.3 A tri-state, because "not asked" is not "no"

**Decision:** `message.is_calendar` is `boolean | null`. Null means the structure was never observed —
the row predates this change, or the server did not return one — and is never read as false.

This is the same shape and the same reasoning as `dkim_aligned` (§5.4's comment in `classify/rules.ts`):
a tri-state whose null means "no evidence", not "evidence of absence". Collapsing it to a boolean would
make ~50,000 existing rows assert they are definitely not calendar mail, which the system has never
checked.

### 1.4 `has_attachment` stops meaning "multipart/mixed"

**Decision:** with the structure in hand, `has_attachment` is derived from the parts — a part with a
`Content-Disposition` of `attachment`, or a filename — rather than from the top-level Content-Type. A
calendar message whose only attached part is the `.ics` is **not** a human attachment.

This corrects §5.3's `human_attachment` guard to mean what its name says. It is in scope here rather than
deferred because this change is the reason the better derivation becomes possible, and leaving the old
one in place beside the new column would leave two facts about parts that disagree.

### 1.5 A capability, not a requirement

**Decision:** a server that does not return a usable `BODYSTRUCTURE` leaves `is_calendar` null and syncs
exactly as it does today. No mailbox fails, no message is skipped.

`BODYSTRUCTURE` is RFC 3501 core and every server here will answer it, but the sync path is the most
load-bearing code in the system and this is not worth a new way for it to break. Null already means "not
observed" (§1.3), so the degraded case needs no new state.

### 1.6 The rule is a signal, not a new action

**Decision:** `is_calendar` joins §5.1's signal set. It names no new action kind and no new policy scope.

A policy still resolves on sender; what changes is that `derivedOutcome` gains a rule: **a calendar
message, from a sender we have corresponded with, older than the dwell → `archive`.** The sender
condition matters — it keeps this to meeting churn from people the operator actually works with, rather
than every invitation anyone has ever sent.

Everything above `derived` still wins, unchanged. A flagged invitation stays. A snoozed thread stays. An
explicit policy on the sender beats it.

---

## 2. Data model

One column. No new table.

**`message.is_calendar`** — `boolean | null`, null meaning not observed (§1.3).

`has_attachment` keeps its column and changes only how it is derived (§1.4).

---

## 3. Backfill

The 263 messages that motivated this already exist, and a signal that only applies to mail arriving from
now on would not solve the problem that prompted it.

**`reclassify` already does exactly this job.** `server/mail/sync/reclassify.ts` walks a mailbox's stored
rows in UID batches, re-fetches headers, re-derives stored columns and writes back only what changed —
it is how the corrected identity list and the fixed DKIM parser were applied to existing mail. Adding
`bodyStructure` to its fetch and `is_calendar` to its derivation is the whole backfill.

It is an operator-run mode (`POST /api/mail-sync?mode=reclassify`), not something the scheduled sync
does on its own, which is the right shape: a full re-walk of every mailbox is not a thing that should
start by itself.

---

## 4. Testing

The derivation is pure over a parsed structure, so it is fixture-testable with no mail server:

1. **A Google Calendar invite** — `multipart/mixed` wrapping `multipart/alternative` (`text/plain`,
   `text/html`, `text/calendar`) plus an `.ics` attachment → `is_calendar: true`, `has_attachment: false`.
2. **A real email with a PDF** → `is_calendar: false`, `has_attachment: true`. The pair is what proves
   §1.4 actually separated two facts that used to be one.
3. **A plain `text/plain` message** → both false.
4. **No structure returned** → `is_calendar: null`, and the row's other columns are written normally.
5. **A calendar part nested two levels down** → still true. The check walks the tree; a one-level check
   would pass cases 1 and 3 and quietly miss real invitations.

---

## 5. Open items

- **The 263 figure is from three mailboxes.** `felix@tellmann.co.za` was disabled when it was measured
  (a certificate rotation, since fixed) and holds far more mail than the other three combined, so the
  real number is larger and unknown.
- **Which senders the derived rule should cover** — "we have corresponded with them" is the proposal in
  §1.6, but the shadow run over real data is what should settle it.
- **`Content-Disposition` is not currently fetched.** §1.4's better `has_attachment` reads it from the
  structure, where imapflow already parses it per part; confirm that during implementation rather than
  adding a header field on the assumption it is needed.

## References

- `docs/plans/specs/active/2026-08-25-inbox-dwell-design.md` — the settled sweep this complements
- `server/mail/sync/reclassify.ts` — the backfill path §3 reuses
- `server/mail/providers/headers.ts` — `HEADER_FIELDS`, and why `PEEK` keeps the read non-mutating
