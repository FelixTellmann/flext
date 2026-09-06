# First-Contact Quarantine — Design

**Status:** implemented 2026-08-24 (`be5e653`) — classification and execution complete, verified by a
shadow pass over 10,198 real messages. No mail has been moved: the 324 promotions and the apply are
staged as reviewed scripts for the operator. §5's notification half is delivered as the published inbox
ledger and `tmp/create-ledger-policies.ts`, also awaiting the operator.
**Plan:** `docs/plans/completed/2026-08-24-first-contact-quarantine.md`
**Date:** 2026-08-23
**Extends:** `docs/plans/specs/completed/2026-07-27-email-management-design.md` (classification, §5 decide)

## 1. Problem

The mail system has no concept of spam. `spam`, `junk`, `phishing` and `scam` appear
nowhere in `server/mail/`, and every decision `decide()` makes comes from a **sender
policy** — a rule keyed to an address or domain, written by the operator or derived
from their own past behaviour with that sender.

That architecture is good at exactly the inverse of the problem. It excels at "this
sender writes to me forty times a month, file it." A scammer is a **new address every
time**: there is no history to derive a rule from, and by the time a policy could
exist the message has already been in the inbox for days.

### 1.1 What is actually in the inbox

`felix@tellmann.co.za`: **3,551 messages from 764 senders**. Two problems wearing one
coat, and only one of them is spam.

**Notification volume.** The top domains are legitimate:

```
441  logalert.app      432  kidsliving.co.za   284  tellmann.co.za
157  gmail.com         126  wunderflats.com    115  github.com
```

Two senders are a quarter of the inbox. This needs no new machinery — see §5.

**A real scam feed.** 379 inbox messages come from senders who have written exactly
once, ever. A sample of the most recent, unfiltered:

```
Action Required: Re-Verify Delivery Address and Dispatch Fee   info@portal-global.com
Important Alert: Your PayPal Account Has Been Temporarily Loc  support_customer@gravisnb.com
Update Your Payment Details                                    support@democarts.info
Update Your Payment Details                                    support@river-valley-inspection.com
Update Your Account Details                                    support@gemzhomeinspections.com
Your Package is Waiting for Delivery !                         admin@digiweigh.ca
N[zwsp]o[zwsp]t[zwsp]i[zwsp]c[zwsp]e: Last Invioce - 56CBI99   info@cheidsantaplonia.it
Your order has been safely delivered.                          winifredcanezhrx260+gmail.com.9@417477...
```

Three unrelated throwaway domains sent "Update Your Payment Details" within four days.
One domain sent the same message under `notifications@`, `reply@` and `postmaster@`.

## 2. Constraints, measured

### 2.1 Authentication signals are unavailable on the mailbox that needs them

`Message.dkimAligned` is derived from the `Authentication-Results` header, which the
**receiving** server stamps. Coverage:

| Mailbox | flavor | DKIM verdict known |
|---|---|---|
| felix@platter.com | gmail | 99% |
| felix@listifyregistry.com | gmail | 93% |
| felixtellmann@gmail.com | gmail | 85% |
| **felix@tellmann.co.za** | **generic** | **7%** |

xneelo does not stamp it. `classify/rules.ts:222` already records that `null` means
"the server does not stamp Authentication-Results", not "DKIM failed" — so the tri-state
is honest, and the honest answer here is *unknown* for 93% of the mail.

Any design leaning on DKIM/SPF/DMARC is therefore blind on the one mailbox with the
problem. This is the project's recurring failure shape — works on Gmail, silently blind
on tellmann — and it is a design constraint here rather than a defect to fix.

### 2.2 Content evasion markers are high-precision and low-recall

Measured across the whole inbox:

```
zero-width characters in subject:  3
lookalike subaddress in From:      3
subjects seen from >1 domain:     70
```

They are real and they are damning when present, but three occurrences cannot carry a
filter. **They are not the workhorse and must not be built as one.** They may raise
confidence on a message the primary signal already selected; they never select alone.

### 2.3 The signal that does carry

First contact, never replied to, no policy: **367 of the 379** one-off messages. Every
scam sample in §1.1 matches it, because a throwaway domain has no history by
construction.

It is not pure. Asana, Resend, Deutsche Bahn and Nedbank appear in the same set — all
legitimate first contacts. Precision is good, not perfect, and that single fact
determines the action in D2.

## 3. Decisions

### D1 — Quarantine keys on the sender graph, not on content

A message is a **first contact** when all three hold:

1. its sender has no earlier message in this mailbox,
2. the operator has never sent into any thread with that sender,
3. no sender policy names its address or its domain.

All three are already stored and already indexed. No body fetch, no new IMAP work, no
DNS, no model. Condition 3 is what makes the rule composable: the moment the operator
writes any policy for a sender, quarantine stops applying to them, without a special
case.

**Rejected — content scoring.** A Bayesian or keyword scorer over subjects. Rejected on
§2.2: the observable content markers occur three times in 3,551 messages, and a scorer
trained on that has nothing to learn from. It also introduces a model to tune and
explain, against an architecture whose whole virtue is that every decision names the
rule that caused it.

**Rejected — DKIM/SPF gating.** Rejected on §2.1. It would work on the three Gmail
mailboxes, which do not have the problem, and do nothing on the one that does.

### D2 — Quarantine is a reviewable move, never a deletion

A new action kind `quarantine` moves the message to a dedicated review folder. It is
**not** `auto_trash`, not the xneelo Junk folder, and not `purge`.

- Junk is excluded because it is unmonitored — `INBOX.Junk` currently holds **1**
  message against an inbox of 3,565, which is precisely why the scam reaches the inbox.
  Routing to a folder the operator does not read is indistinguishable from deleting.
- Deletion is excluded because §2.3 measured real false positives. A legitimate first
  contact — a booking confirmation, a new client — must be recoverable by reading a
  folder, not by an undo the operator has to know to perform.

`quarantine` is an ordinary executable kind, so it inherits journalling, undo, and the
autonomy ladder unchanged, and it starts at `shadow` like every other policy action.

### D3 — Quarantine ranks below every explicit rule

In `decide()`, quarantine sits **below** guards, thread state, and address/domain
policies, and **above** `derived` and `fallback`. A first message from a sender the
operator has allow-listed must reach the inbox, and a guard that blocks archiving must
also block quarantining — quarantine hides mail, so every existing reason not to hide
mail applies to it unchanged.

`derived` sits below because a derived rule is an inference from behaviour with a
sender, and a first contact has no behaviour to infer from. There is nothing for the
two to disagree about.

### D4 — Rescue detection covers quarantine, and covers it well

Quarantine produces applied actions, so the rescue detector watches them like any
other. The interaction is unusually favourable and worth recording: a quarantined
message is by construction **unseen at apply time**, which is exactly the precondition
the corrected `opened` signal requires
(`2026-08-23-rescue-detector-correction-design.md` D1). Opening a quarantined message
is therefore a clean, detectable rescue — the strongest case the detector has.

This is the safety net that makes D2's accepted false-positive rate tolerable: a
legitimate first contact the operator opens in the review folder raises a rescue and
suspends the rule that hid it.

## 4. Blind spots, stated

- A scammer who has written before is not a first contact and is not quarantined. The
  rule addresses throwaway-domain volume, which is what §1.1 measured, not a targeted
  attacker who has built history.
- A legitimate first contact is quarantined, and the operator must read the review
  folder. The folder is the product; if it goes unread this design has moved the
  problem rather than solved it.
- Nothing here helps the three Gmail mailboxes, which do not need it: Google filters
  before the sync ever sees the mail, and `selectSyncFolders` walks only
  `[Gmail]/All Mail`, which excludes Spam by definition.

## 5. Out of scope — the notification half needs no code

The other half of §1.1 is not a spam problem and must not be solved with this
machinery. Measured, the reason those messages sit in the inbox is not a missing rule:

- `logalert.app` — 874 decisions are `keep_inbox` from an **address policy the operator
  set**. The system is doing what it was told.
- `kidsliving.co.za`, `doveras.com`, `wunderflats.com` — held by `needs_action` from
  the `derived` source, which outranks nothing and blocks nothing, but produces no
  mutation either.

So the fix is operator decisions on roughly ten high-volume senders, using policy
machinery that already exists and has already moved 7,593 messages. It is delivered as
a decision surface, not as code, and it is tracked separately from this spec.

## 6. Verification

- A message from a sender with prior history is never quarantined.
- A message whose sender has any address or domain policy is never quarantined,
  whatever that policy says.
- A guard that blocks `archive` also blocks `quarantine`.
- An operator reply anywhere in a thread with that sender disqualifies future
  quarantine for them.
- Quarantine round-trips through undo: the message returns to the inbox.
- Shadow-pass counts on `felix@tellmann.co.za` land near the measured 367, and every
  message in §1.1's sample is among them.
