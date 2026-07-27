# Email Management Suite — Design Spec

**Date:** 2026-07-27
**Status:** Approved (design); unbuilt
**Scope:** A multi-mailbox email triage, filing, and cleanup system behind the flext auth gate. First
module of a wider personal management suite.

## Problem

Six active mailboxes across several businesses accumulate automated mail, newsletters, and spam faster
than they get cleaned. Two distinct jobs are tangled together:

1. **Noise removal** — the great majority of incoming volume never needs a human, and never gets sorted.
2. **Record keeping** — a minority of threads are business records that should be filed by client and
   findable years later.

The binding constraint is not classification difficulty. It is **trust**: any system that touches six
live mailboxes must make it impossible to lose something that mattered, or it will be switched off after
the first bad archive.

## Non-goals

- **Not a mail client.** Reading, composing, and sending stay in Gmail / Apple Mail / whatever is already
  in use. This system never renders an email body.
- **Not real-time.** A cleanup tool does not need sub-minute latency.
- **Not multi-user.** Single operator, single server, no tenancy model.

---

## 1. Decisions

### 1.1 IMAP for every mailbox, including Gmail

The six mailboxes are a mix of generic IMAP (xneelo shared hosting), personal `@gmail.com`, a Google
Workspace domain under our control, and a Workspace domain administered by someone else.

**Decision: a single IMAP connector for all four.** Gmail is a capability flag, not a separate provider.

Gmail's IMAP extensions cover everything needed — `X-GM-LABELS` reads *and writes* labels via `STORE`,
`X-GM-THRID` gives thread identity, `X-GM-MSGID` gives stable per-message identity, `X-GM-RAW` exposes
full Gmail search syntax.

Rejected: **Gmail API + OAuth.** `gmail.modify` is a *restricted* scope. An External, published app
requires an annual CASA Tier 2 security assessment (quoted from ~$500 to well over $5,000/yr). The
escape hatches are worse than they look: an Internal consent screen only works on a Workspace domain we
administer, which excludes two of the four mailbox types; and External + Testing expires refresh tokens
every 7 days, which is unusable for a scheduled job.

Rejected: **Microsoft Graph.** No M365 mailboxes in scope.

**Cost of the IMAP decision:** app passwords require 2-Step Verification, are revoked when the account
password changes, and are disabled entirely by Google Advanced Protection. A Workspace admin who is not
us can also disable app passwords or block IMAP org-wide. **Verify the not-ours Workspace mailbox before
building.** If it is blocked there, the fallback is asking that admin to allowlist an OAuth client ID
under Admin console → API controls → App access control; admin-trusted apps skip verification for that
domain.

### 1.2 Per-mailbox TLS policy — SPKI pinning, never a global bypass

The xneelo mailbox fails hostname validation because the certificate is issued for the physical hosting
server, not the vanity domain — `mail.<domain>` mismatches while `wwwNN.cpt1.host-h.net` validates.

**Decision:** try the provider's canonical server hostname first, since that validates normally. Only
where it still fails does `mailbox.tls_policy` move from `strict` to `pinned`.

**Pin the SPKI (public key) hash, not the certificate fingerprint.** A leaf certificate's SHA-256
changes at every renewal — roughly every 60–90 days on ACME — so certificate pinning would hard-stop the
mailbox several times a year for an entirely benign reason. The SPKI survives renewal as long as the key
is reused. `mailbox.pinned_spki` therefore holds a *set* of accepted base64 SHA-256 SPKI hashes so a
planned key rotation can be staged.

A mismatch is a hard stop with an alert, and the re-pin flow is an explicit operator action: the
dashboard shows the old and new SPKI hash, issuer, subject, and validity window side by side, and
requires confirmation. This matters because a routine key rotation and a MITM produce the identical
signal — the operator needs enough context on screen to tell them apart, and the system must never guess.

**There is no `rejectUnauthorized: false` anywhere in the codebase.** That is the reflex fix in every
tutorial and it converts stored mail credentials into a MITM giveaway. Pinning is strictly stronger than
CA validation for a known host, so this is an upgrade rather than a workaround.

### 1.3 Metadata only — bodies are never fetched or persisted

**Decision:** the system reads headers. It does not fetch bodies at all — not for storage, not
transiently, not for classification.

Every downstream decision follows from headers plus stored sender history (§1.4), so there is no code
path that needs a body. This is stronger than "we don't store bodies": there is nothing to leak, nothing
to sanitize, and no accidental-persistence bug available to write.

Consequences: the database stays small; a full compromise leaks *who corresponds with us and about what
subject lines* and nothing more; and messages remain on the mail servers, which stay the source of truth.

### 1.4 Deterministic rules are the classifier of record; AI only proposes rules

**Decision:** classification is a pure function over headers and stored sender policy. No model is ever
in the execution path.

Most volume self-identifies from headers alone — `List-Id`, `List-Unsubscribe`, `Precedence: bulk`,
`Auto-Submitted`, `no-reply@` patterns. Combined with a signal no vendor has (*have I ever replied to
this sender?*), a few hundred senders account for the overwhelming majority of six mailboxes' traffic.

So the unit of classification is the **sender**, not the message. AI's job is to help build the sender
policy table once; rules then execute it indefinitely, deterministically, at zero marginal cost.

This also makes every decision reproducible after the fact and unit-testable without a mail server.

### 1.5 AI runs through Claude Code over stdio, not the Anthropic API

**Decision:** no API key, no per-token billing. Flext ships an MCP server that Claude Code connects to
on demand.

**Transport is stdio inside the deployed container, reached over SSH (`coolify exec` or equivalent).
There is no listening MCP port and nothing is exposed to the internet.** This is load-bearing for §1.6:
an internet-reachable MCP endpoint would widen the blast radius from "a session the operator is watching"
to "anything that can reach the host", and the security argument below assumes the former.

Because model time is a scarce manual resource under this arrangement, per-message inference is
structurally impossible — which is the same conclusion §1.4 reached on safety and cost grounds. The
constraint and the correct architecture agree.

Optional later: a local model (Ollama) for unattended residue classification. Not in scope now.

### 1.6 The MCP server cannot mutate a mailbox

Email subjects are attacker-controlled text. Indirect prompt injection against AI email assistants is a
demonstrated, CVE-bearing attack class (CVE-2026-26133 against Microsoft Copilot), and Claude Code has
Bash and filesystem access — so anything reaching it is a live injection surface.

**Decision — an architectural boundary, not a prompt-level guardrail:**

- No MCP tool can label, move, archive, trash, or delete anything.
- The only write is `propose_policy`, which inserts a row with status `pending`.
- Nothing pending executes until approved in the flext dashboard.
- Tools return aggregates and sanitized subject samples. There are no bodies to return (§1.3).
- `action` is a constrained enum, never free text.

A fully hijacked Claude Code session can therefore create a bad *proposal*. That is the entire blast
radius.

### 1.7 Deletion is an outcome, never an immediate action

Four terminal states, not two:

| State | Mechanism | Reversible |
|---|---|---|
| `archive` | remove `INBOX` label / move to Archive | fully, instantly |
| `file` | move to `Clients/<X>` | fully |
| `trash` | move to Trash/Bin | for the server's retention window |
| `purge` | `\Deleted` + `UID EXPUNGE` | **no** |

**Trash retention is a per-mailbox property, not a universal safety net.** Gmail auto-purges Trash at 30
days; Dovecot on xneelo does not auto-purge at all. `mailbox.trash_retention_days` records this (`null`
= no server-side purge), and it drives two things:

- **`auto_trash` may only be promoted to `auto` on a mailbox where the recovery window is known** —
  either a server-side retention value, or an explicitly accepted `null` meaning Trash simply
  accumulates (which is itself safe, just untidy).
- **The purge sweep only runs on mailboxes with `trash_retention_days = null`.** On Gmail the server has
  already purged anything old enough to qualify, so a sweep there would be a no-op; the sweep exists
  precisely to give the generic mailboxes the recovery-window-then-delete behaviour Gmail has natively.

`archive` and `file` are the low-ceremony actions and reach `auto` quickly. `purge` is the only
irreversible one and gets the most: a **separate scheduled sweep**, never inline with classification,
over messages that have sat in Trash past the configured dwell (default 30 days) *and* whose sender
policy is `auto_trash` *and* which were never opened. It emits a digest before firing.

**The sweep uses `UID EXPUNGE` (UIDPLUS, RFC 4315) over an explicit UID set, and hard-fails if the
server does not advertise `UIDPLUS`.** A bare `EXPUNGE` removes *every* `\Deleted`-flagged message in
the folder, including ones flagged by hand in a mail client minutes earlier. For the single irreversible
operation in the system, destroying messages we never selected is exactly the failure mode this section
exists to prevent.

**Rationale for the asymmetry:** over-archiving 500 messages is an afternoon's annoyance; purging five
wrong ones is unrecoverable. Purge stays disabled until a full shadow cycle records zero rescues.

### 1.8 Deployment: own Hetzner server via Coolify

Deployed rather than local-only, for 24/7 sync and phone access. Single operator with sole server
access.

**This confirms the open database decision.** MySQL on Coolify means the existing Drizzle `mysql2` setup
is unchanged — point `DATABASE_URL` at the Coolify instance. Recorded in
`docs/plans/specs/active/2026-07-24-database-replacement-design.md` under Option E.

**Credentials do not live in environment variables.** Env vars surface in the Coolify UI, in process
environment, in crash dumps, and to anything that can read `/proc`. Instead: a single
`MAIL_ENCRYPTION_KEY` in the environment, with mailbox credentials stored AES-256-GCM encrypted in the
database — **a fresh random 96-bit IV per record**, with the IV and 128-bit auth tag stored alongside the
ciphertext, plus a `key_version` column so the key can be rotated by re-encrypting rows in place. Never
reuse an IV under GCM; doing so is a catastrophic, silent break of the cipher rather than an error.

A database dump alone is then useless, and adding a mailbox becomes a UI action rather than a redeploy.
Node's built-in `crypto` covers this; no dependency. **`MAIL_ENCRYPTION_KEY` must be backed up
separately from the database** — a dump without it restores nothing usable.

Sole access plus a single user means the auth gate is minimal: existing JWT auth, one account, signup
disabled.

### 1.9 "Needs action" is signal-based, with a feedback loop later

Rejected: putting a model in the hot path to score urgency. That reintroduces exactly the property §1.4
and §1.6 exist to avoid.

**Decision — start with pure signals:**

```
NOT is_bulk AND NOT is_automated AND addressed_to_me
AND NOT last_in_thread_is_mine AND thread_state = 'open'
AND sender NOT IN sender_suppression
```

sorted by staleness. This over-includes (a "thanks!" reply lands in the queue), which is the correct
direction to fail — a slightly noisy list rather than a missed email.

**Growth path:** every "this shouldn't be here" dismissal writes a `sender_suppression` row, and Claude
Code reviews suppression patterns to propose policy refinements. Signal generated for free by ordinary
use, and still no per-message inference.

### 1.10 Identity: "me" is an explicit set of addresses per mailbox

`addressed_to_me`, `cc_me`, `my_reply_count`, and `last_in_thread_is_mine` all depend on knowing which
addresses are ours — and the answer is not simply the login address. Gmail aliases, plus-addressing
(`felix+invoices@`), domain catch-alls, and distribution lists all deliver to the same mailbox under
different `To:` values.

**Decision:** `mailbox.identity_addresses` holds an explicit JSON list of exact addresses and patterns.
Matching normalizes case, strips `+suffix` when the mailbox flavor is Gmail (which ignores it), and
additionally checks `Delivered-To` and `X-Original-To`, since aliased mail frequently carries the real
recipient only in those headers.

Getting this wrong silently corrupts the highest-value signal in the system — an unrecognised alias
makes every message to it look like it was not addressed to us, which suppresses the entire Needs Action
queue for that alias. Phase 1 surfaces the distinct `Delivered-To` values found during backfill so the
list can be filled in from evidence rather than memory.

---

## 2. Architecture

```
server/mail/
  providers/
    types.ts        # MailboxProvider interface — the only thing downstream imports
    imap.ts         # single implementation; Gmail = capability flag
    tls.ts          # strict | pinned-SPKI policy
  sync/
    incremental.ts  # per-folder delta fetch
    reconcile.ts    # expunge/move detection (QRESYNC or set-difference)
    cursor.ts       # UIDVALIDITY / UID / MODSEQ bookkeeping
  classify/
    identity.ts     # is-this-address-mine resolution     (PURE, no IO)
    signals.ts      # headers → feature struct            (PURE, no IO)
    rules.ts        # signals + policy → decision         (PURE, no IO)
  filing/
    resolver.ts     # sender/domain → client → folder path (delimiter-aware)
  actions/
    queue.ts        # pending decisions
    executor.ts     # applies decisions via provider
    journal.ts      # pre-state capture + undo
  safety/
    sanitize.ts     # subject-line defanging for MCP output
    guards.ts       # never-touch predicates, scoped per action class
  crypto/
    credentials.ts  # AES-256-GCM, per-record IV, key_version
  mcp/
    server.ts       # stdio; reads + propose_policy (pending only). No mutation.
```

**The load-bearing boundary is `classify/`.** `identity.ts`, `signals.ts`, and `rules.ts` are pure
functions — `(headers, identity, sender_policy, thread_state) → decision` — with no IO. This is what
makes shadow mode free: the identical function runs over historical data and records what it *would*
have done, with no mailbox access and no risk. It also makes the entire classification logic testable
without a mail server, and every decision reproducible from stored inputs.

Library: `imapflow` (maintained, same author as the existing `nodemailer` dependency).

---

## 3. Data model

Thirteen tables, MySQL via Drizzle, extending `server/db/schema.ts`.

| Table | Purpose |
|---|---|
| `mailbox` | connection config, encrypted credential, TLS policy, flavor, identity addresses, trash retention |
| `mailbox_cursor` | per folder: `uid_validity`, `last_seen_uid`, `highest_modseq`, `last_sync_at`, `last_reconcile_at` |
| `message` | **metadata only** |
| `sender` | address, domain, counts, `my_reply_count` |
| `sender_policy` | scope, action, client, autonomy, source, `suspended_at`, `suspension_reason` |
| `client` | name, slug, owned domains, folder path |
| `never_touch_rule` | operator-defined absolute exclusions (address / domain / subject pattern) |
| `sender_suppression` | per-sender Needs Action suppression, written by dismissals (§1.9) |
| `filing_queue` | threads whose client is ambiguous or unverified (§6) |
| `thread_state` | open / snoozed / done / dismissed + snooze time |
| `action` | one row per decision — shadow, pending, applied, failed, or undone |
| `proposal` | Claude Code suggestions awaiting approval |
| `sync_run` | per-run log: counts, duration, errors |

**`mailbox`** carries `flavor` (`gmail` \| `generic`), `identity_addresses` (§1.10), `account_index`
(for Gmail deep links), `hierarchy_delimiter` (detected from `LIST`), `trash_retention_days`,
`tls_policy`, `pinned_spki` (a set), and the encrypted-credential triple plus `key_version`.

**`message`** columns: mailbox, folder, UID, `gm_msgid` (nullable), RFC `Message-ID`, `thread_key`, from
address/domain/name, `to_me`, `cc_me`, subject, sent date, size, attachment flag, `list_id`,
`list_unsubscribe`, `precedence`, `auto_submitted`, `dkim_aligned`, read/flagged state, labels, current
state, client, topic, `trashed_at`, `opened_at`, `disappeared_at`.

- `trashed_at` and `opened_at` exist because §1.7 needs "sat in Trash 30+ days" and §8's rescue
  detection needs *opened **after** the action* — a bare `is_read` flag cannot express either.
- `disappeared_at` records messages that vanished server-side (§4).

Uniqueness: `(mailbox_id, gm_msgid)` where `flavor = gmail`, `(mailbox_id, folder, uid)` otherwise.

**`action`** is the single journal for both real and shadow decisions: `status ∈ shadow | pending |
applied | failed | undone`, with `sender_policy_id` recorded on every row. That policy reference is what
makes §7's bulk-undo-by-rule and §10's `get_shadow_report(policy_id)` possible; without it neither can
be written. `from_state_json` records folder, labels, and flags *before* the mutation, and
`to_state_json` records the post-move UID captured from `COPYUID` (§7) — together they make undo an
exact restore rather than a reconstruction.

**Thread identity** is computed in the provider layer because it differs per flavor: Gmail supplies
`X-GM-THRID`; generic IMAP requires walking the `References` / `In-Reply-To` chain with a
normalized-subject-plus-participants fallback. Downstream code only ever sees `thread_key`.

---

## 4. Sync

### 4.1 Gmail is a label store, not a folder store

On Gmail a single message with labels `INBOX` and `Work` is visible in three IMAP folders — `INBOX`,
`Work`, and `[Gmail]/All Mail` — **each with a different UID**. Walking every folder on a Gmail mailbox
would therefore create several `message` rows per real message and inflate every sender count, volume
bucket, and MCP aggregate downstream.

**Decision:** for `flavor = gmail`, `[Gmail]/All Mail` is the single canonical folder to sync. Label
membership (including `INBOX`) is read from `X-GM-LABELS`, and identity is `X-GM-MSGID`. Per-label
folders are never walked. For `flavor = generic`, the per-folder walk is correct and identity is
`(folder, uid)`.

This also simplifies actions: on Gmail, archiving is a `STORE` removing the `\\Inbox` label rather than
a move.

### 4.2 Incremental fetch

Per mailbox, per synced folder:

1. `SELECT` the folder; compare `UIDVALIDITY` against the stored cursor. On change, the server has
   invalidated every UID — full folder resync, no exceptions.
2. If `CONDSTORE` is advertised, pick up flag changes with
   `UID FETCH 1:* (UID FLAGS MODSEQ) (CHANGEDSINCE <modseq>)`. Note the modifier is a **second
   parenthesized list**, and the fetch must be `UID FETCH` returning `UID` — a sequence-number fetch
   gives nothing stable to key on.
3. `UID FETCH <last_seen_uid+1>:*` for new messages — `ENVELOPE`, `INTERNALDATE`, `FLAGS`,
   `RFC822.SIZE`, Gmail extensions where available, and
   **`BODY.PEEK[HEADER.FIELDS (...)]`**. `PEEK` is mandatory; a plain `BODY[]` fetch marks every message
   it touches as read.
   **Discard any returned UID ≤ `last_seen_uid`.** Under RFC 3501 range semantics, if
   `last_seen_uid+1` exceeds the highest UID present the server still returns the highest-UID message —
   so without this filter the newest message is reprocessed on all 96 runs a day.

Headers fetched: `From, To, Cc, Subject, Date, Message-ID, References, In-Reply-To, List-Id,
List-Unsubscribe, Precedence, Auto-Submitted, Return-Path, Content-Type, Delivered-To, X-Original-To,
Authentication-Results`.

`Delivered-To` / `X-Original-To` carry the real recipient for aliased mail (§1.10).
`Authentication-Results` gives SPF/DKIM/DMARC verdicts, which §6 requires: without a DKIM check, forging
`From: someone@acmecorp.com` is enough to route a message into a client's record folder, which is a
records-integrity problem rather than a spam problem.

### 4.3 Reconciliation — messages that vanish

CONDSTORE reports *changes*, never *expunges*. Without a separate mechanism, messages deleted or moved
by hand in the real mail client persist forever in `message` and keep appearing in Needs Action.

**Decision:** where `QRESYNC` (RFC 7162) is advertised, use `VANISHED` to learn what disappeared. Where
it is not, run a periodic set-difference — `UID SEARCH ALL` per folder against stored UIDs — on a slower
cadence than the incremental sync (hourly). Either way, missing UIDs get `disappeared_at` set rather
than being deleted, so the action journal stays intact.

### 4.4 Backfill

A one-time headers-only walk of every folder builds the sender table — and critically, a pass over the
**Sent** folders computes `my_reply_count` per sender by matching recipients against
`identity_addresses`. "Have I ever written to this person?" is the highest-signal feature in the system,
no vendor has it, and it costs one scan.

Backfill also reports the distinct `Delivered-To` values it observed, which is how `identity_addresses`
gets populated from evidence (§1.10).

Schedule: Coolify scheduled task every 15 minutes for incremental, hourly for reconciliation. Not IMAP
IDLE — a long-lived connection per mailbox is more moving parts for latency that does not matter here.

---

## 5. Rules engine

### 5.1 Signals

Pure, headers only: `is_bulk` (`List-Id` / `List-Unsubscribe` / `Precedence: bulk|list`), `is_automated`
(`Auto-Submitted`, or `no-reply@` / `mailer-daemon@` / `postmaster@` patterns), `addressed_to_me`
(identity match in `To:` / `Delivered-To`, not `Cc:`), `is_reply`, `last_in_thread_is_mine`,
`sender_known` (`my_reply_count > 0`), `dkim_aligned`, `volume_bucket`, `age_days`.

`volume_bucket` is by lifetime message count from that sender: `low` < 10, `medium` 10–99, `high`
100–999, `flood` ≥ 1000.

### 5.2 Resolution order

1. **Absolute guards** — override everything, including explicit policy
2. **Thread state** — snoozed or done suppresses
3. **Address-level policy**
4. **Domain-level policy**
5. **Derived default**
6. **Fallback → `keep_inbox`**

Step 6 is the safety spine: anything unclassified is left alone. The system acts only where a policy
explicitly says to, so silence is always the safe outcome.

### 5.3 Guards are scoped per action class

An earlier draft made all guards absolute. That is wrong, and fatally so: two of the guards are "we have
ever sent a message in this thread" and "the sender is someone we emailed first", while client
correspondence is *by definition* mail we reply to. Absolute guards would make automatic filing
unreachable and quietly delete the record-keeping half of the product.

| Guard | Blocks |
|---|---|
| Flagged or starred | everything |
| Arrived < 24 hours ago | everything |
| Matches a `never_touch_rule` | everything |
| We have sent a message in this thread | `archive`, `trash`, `purge` — **not** `file` |
| Sender in derived allowlist (we emailed them first) | `trash`, `purge` |
| Attachment from a human sender | `trash`, `purge` |

The three absolute guards are the ones with no legitimate override: a starred message is an explicit
human signal, the 24-hour window exists so a human sees mail before the machine touches it, and the
never-touch list is a direct instruction.

The three scoped guards protect against *destruction*, not against *organisation*. Filing an active
client thread into `Clients/Acme/` is exactly the intended behaviour; trashing it is not.

**Explicit address-level policy outranks the scoped guards but not the absolute ones.** Otherwise a
policy the operator deliberately created would sit in the dashboard as silent dead code. Where a scoped
guard *does* suppress a policy, the Sender Policy surface renders `suppressed by guard: <name>` on that
row — an inert policy must never be indistinguishable from an active one.

### 5.4 Derived defaults

Step 5 applies only where no explicit policy exists. It is deliberately timid, and **can only ever
propose `archive`, never `trash` or `purge`** — destruction requires a policy a human created.

| Condition | Derived decision |
|---|---|
| `is_bulk` or `is_automated`, `my_reply_count = 0`, `age_days > 30` | `archive` |
| `is_bulk` or `is_automated`, `my_reply_count = 0`, newer | `keep_inbox` (accrue evidence) |
| Needs-action signal set (§1.9) | `needs_action` |
| anything else | `keep_inbox` |

---

## 6. Filing

**Client is the primary axis, topic a secondary split only where volume earns it.** Client is stable and
unambiguous; topic is fuzzy and drifts.

```
Clients/Acme/
Clients/Acme/Invoices        ← only split when volume earns it
Ops/Receipts
Ops/Subscriptions
Archive/2026/                ← time-based fallback for the genuinely unclassifiable
```

Paths are logical. `filing/resolver.ts` renders them with the server's own hierarchy delimiter, detected
from the `LIST` response — `/` on Gmail, commonly `.` on Dovecot — and creates missing folders on
first use. Hardcoding `/` produces a literal folder named `Clients/Acme` on a dot-delimited server.

Assignment is deterministic: sender domain → client, configured once in the Sender Policy table.
Individuals on personal addresses get explicit per-address mappings.

**Filing requires DKIM alignment.** A domain-based mapping means `@acmecorp.com` decides where a message
is permanently filed, so a spoofed `From` would let anyone write into a client's record folder. Where
`Authentication-Results` shows DKIM failing or absent, the message routes to `filing_queue` rather than
being filed. Genuinely ambiguous cases — a thread spanning two clients — land in the same queue.

**The assignment is stored in the flext database as well as written to the IMAP folder.** Three payoffs:
filing survives a provider change; bulk re-filing is a mapping edit plus a replay; and the dashboard can
show *all correspondence for a client across all six mailboxes at once*, which no mail client can do.

---

## 7. Action executor

### 7.1 Journal before mutate

Ordering is load-bearing and easy to get backwards:

1. Read current state from the server (folder, flags, labels)
2. Write the `action` row with `from_state_json`, status `pending`
3. Perform the IMAP mutation
4. Record `to_state_json` and mark `applied` — or `failed` with the error

A crash between 3 and 4 leaves a `pending` row that still holds the exact pre-state; the next run
reconciles by comparing actual server state against `from_state` / `to_state`. **Mutate-then-journal
loses the pre-state on any crash and makes undo permanently impossible for those messages.**

Actions are keyed on `(message_id, kind, run_id)` so retries cannot double-apply.

### 7.2 Moves change UIDs

`UID MOVE` (RFC 6851) invalidates the source UIDs, and the new destination UIDs are knowable only from
the `COPYUID` response (UIDPLUS). Since `message` rows and undo are keyed on folder + UID, failing to
capture `COPYUID` orphans every moved message until the next sync — and leaves an undo with no address
to write to.

**Decision:** parse `COPYUID` into `to_state_json` on every move. A batched `UID MOVE` over a UID set
returns one `COPYUID` source-set/destination-set pair which must be zipped back to the source UIDs in
order. Where the server does not advertise `MOVE`, fall back to `UID COPY` + `STORE \Deleted` +
`UID EXPUNGE` over the same set, capturing `COPYUID` from the `COPY`.

On Gmail, `archive` is not a move at all — it is `STORE -X-GM-LABELS (\\Inbox)`, so UIDs are stable and
`to_state_json` records the resulting label set.

### 7.3 Batching and undo

Group by `(mailbox, folder, target)` and issue one command per group over a UID set. Archiving 400
newsletters is a handful of commands, not 400 round trips.

**Undo** reads `from_state_json` and issues the inverse. Bulk-undo-by-rule selects on
`action.sender_policy_id` and replays inverses newest-first across every action a policy ever took.

---

## 8. Autonomy ladder — per policy, never global

| Level | Behavior |
|---|---|
| `shadow` | Decision computed and journaled with `status = shadow`. Mailbox untouched. |
| `propose` | Queued as `pending`, waits for a click. |
| `auto` | Executes on the next sync run. |

**Every policy is born in `shadow`**, including `archive` and `file`. §1.7's "low ceremony" describes
how *fast* a class of action reaches `auto`, not a bypass of the ladder — nothing skips shadow.
Promotion is per policy, after its shadow record is reviewed. "LinkedIn notifications: auto" and "Acme
filing: still proposing" coexist naturally, which matches how trust actually accrues: the obvious rules
earn it in a week, the subtle ones may never.

Promotion gates:

- `archive`, `file` — operator review of the shadow record.
- `auto_trash` — a full shadow cycle with zero rescues, **and** a known trash-retention setting on that
  mailbox (§1.7).
- `purge` — never promoted per policy; it runs only via the separate sweep, which is disabled until a
  full shadow cycle records zero rescues across all `auto_trash` policies.

**Rescue detection.** If a message that was auto-archived or auto-trashed is subsequently opened,
starred, or replied to — `opened_at` later than the action's `applied_at`, not merely `is_read` — the
responsible policy is **automatically suspended** with `suspension_reason` set, and flagged on the
dashboard. The system detects its own mistakes from ordinary behavior; no bug report required.

---

## 9. Surfaces

| Surface | Purpose |
|---|---|
| **Needs Action** | Daily driver. One row per thread: sender, client, subject, age, *why it is here*. Snooze / done / "shouldn't be here". |
| **Sender Policy** | Where the work happens, once. Every sender by volume with counts, reply count, header flags, client, policy, autonomy, and any guard suppression. Bulk assignment. |
| **Action Journal** | The trust surface. Every action ever taken with pre-state. Filter by date / mailbox / policy / sender. Per-action and per-policy undo. |
| **Proposals** | Claude Code's pending suggestions. Approve / reject / edit-then-approve. |
| **Filing browser** | Record-keeping mode. Browse by client across all mailboxes. Includes the `filing_queue`. |

**Deep links.** Gmail: `https://mail.google.com/mail/u/<account_index>/#all/<thrid-as-hex>` — `X-GM-THRID`
arrives as a decimal 64-bit integer and the URL fragment expects hexadecimal, so it must be converted;
`account_index` comes from `mailbox` because multi-account sessions are the norm here. Generic IMAP has
no equivalent addressing scheme, so those rows offer a copyable `Message-ID` and folder location instead
of a link.

---

## 10. MCP surface

```
list_unclassified_senders(limit, min_count)   → aggregates
get_sender_profile(sender_id)                 → counts, dates, reply count,
                                                 header-flag distribution,
                                                 up to 20 sanitized subject samples
list_clients()                                → existing mappings
get_shadow_report(policy_id)                  → what a policy would have done
propose_policy(target, action, client?, topic?, rationale)
                                              → writes a pending proposal
```

`propose_policy` takes `target` (`{scope: 'address'|'domain', value: string}`), `action` (enum:
`keep_inbox | archive | file | auto_trash`), optional `client` (must match an existing `client.slug`),
optional `topic`, and a free-text `rationale` stored for the operator to read. It cannot set autonomy —
every approved proposal enters at `shadow`.

`sanitize.ts` on every subject sample: URLs reduced to bare domain, zero-width and bidirectional control
characters stripped, whitespace collapsed, capped at 120 characters, and the block wrapped in explicit
untrusted-data delimiters with a preceding instruction that the content is data and never instructions.

---

## 11. Error handling

- **Per-mailbox isolation.** A dead connection, expired app password, or SPKI change fails that
  mailbox's run, logs to `sync_run`, raises a dashboard banner, and leaves the other five untouched.
- **Partial action failure.** A MOVE failing mid-batch marks only unconfirmed UIDs failed; the executor
  re-reads state next run rather than assuming.
- **Credential failure.** Mailbox disabled, banner raised, no retry storm.
- **SPKI mismatch** on a pinned mailbox: hard stop and alert, with the operator re-pin flow of §1.2.
  Never auto-accept.
- **Missing `UIDPLUS`** when a purge sweep is due: hard-fail that mailbox's sweep and alert (§1.7).
- **`UIDVALIDITY` change: re-key existing `message` rows by `X-GM-MSGID` (Gmail) or RFC `Message-ID`
  (generic).** UIDs are gone but both of those are stable. Missing this silently detaches the entire
  action journal from its messages after a server-side reindex.

---

## 12. Testing

Pure rules enable golden-file tests: fixture header structs in, expected decisions out, no mail server.
Guard scoping (§5.3) and identity matching (§1.10) get dedicated fixture sets, since both are places
where a subtle error is invisible in normal operation and destructive in the tail.

The real acceptance test is the **shadow run over the actual backfill** — a full-scale dry run against
100% real data, measuring false negatives before anything is permitted to mutate.

---

## 13. Phases

Each phase gets its own plan under `docs/plans/active/`.

| # | Phase | Ships |
|---|---|---|
| 0 | Foundation | single-user auth gate, Coolify MySQL, credential encryption |
| 1 | Connect + sync | provider, TLS/SPKI policy, cursors, reconciliation, identity discovery, backfill incl. Sent scan — read-only |
| 2 | Read-only dashboard | Sender Policy table + Needs Action |
| 3 | Rules + shadow | pure classification, guards, shadow journal, shadow report |
| 4 | Actions | executor, `COPYUID` handling, journal, undo, Action Journal — `propose` only |
| 5 | Filing | clients, delimiter-aware folder resolution, DKIM gate, filing queue, cross-mailbox client view |
| 6 | Autonomy + schedule | promote to `auto`, cron, rescue detection, digest |
| 7 | Claude Code MCP | proposal tools + proposals inbox |
| 8 | Purge sweep | deliberately last; `UID EXPUNGE` only |

Phase 2 is the first point of real value even with zero automation — seeing who actually fills six
inboxes is worth the build on its own.

---

## 14. Open items

- **Verify app-password and IMAP availability on the Workspace domain we do not administer**, before
  Phase 1. If blocked, fall back to admin allowlisting an OAuth client ID (§1.1).
- **Mailbox volume is assumed** to be tens of thousands of messages total, growing by a few hundred a
  day. An order of magnitude more does not change the design, but the Phase 1 backfill needs batching.
- **`identity_addresses` per mailbox** — populated in Phase 1 from observed `Delivered-To` values.
- **`never_touch_rule` contents** — populated during Phase 3 from the shadow run.
- **`trash_retention_days` per mailbox** — confirm xneelo's actual behaviour rather than assuming no
  auto-purge.

## References

- [Rework — Email Triage Agent blueprint](https://resources.rework.com/libraries/ai-agents/ai-email-triage-agent)
- [Permiso — Copilot prompt-injection phishing (CVE-2026-26133)](https://permiso.io/blog/copilot-prompt-injection-ai-email-phishing)
- [Microsoft — Defending the inbox against prompt injection](https://techcommunity.microsoft.com/blog/microsoftdefenderforoffice365blog/defending-the-inbox-against-prompt-injection-attacks/4534636)
- [Google — Gmail IMAP extensions](https://developers.google.com/workspace/gmail/imap/imap-extensions)
- [Google — Restricted scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification)
- [xneelo — Email settings / SSL](https://xneelo.co.za/help-centre/email/ssl/)
- RFC 3501 (IMAP4rev1) · RFC 4315 (UIDPLUS) · RFC 6851 (MOVE) · RFC 7162 (CONDSTORE/QRESYNC)
