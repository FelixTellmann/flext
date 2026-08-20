# Phase 5 — Filing to client folders: design

**Parent spec:** `docs/plans/specs/active/2026-07-27-email-management-design.md` §6.

This document resolves what §6 leaves open, and records two decisions the operator took on
2026-08-20 that amend §6 rather than merely implement it. §6 stays the authority on everything
this document does not contradict; where it does contradict, the amendment is stated explicitly
and §6 is annotated with a pointer here.

---

## 1. What Phase 5 is

Phase 4 shipped an executor that can `archive` and `auto_trash` and deliberately refuses `file`:
`planFor("file")` returns `{ outcome: "deferred" }` carrying `FILE_DEFERRED_REASON`, and the
executor parks those rows at status `deferred`. Phase 5 makes that branch real.

Three things have to exist for it to:

1. A **destination** — a logical path derived from the sender policy.
2. A **resolution** of that logical path to a real folder on each server, including creating it.
3. A **queue** for the cases that cannot be resolved or are not trusted enough to file.

Everything else in §6 — client as primary axis, topic as a secondary split, storing the
assignment in the flext database — falls out of those three.

---

## 2. Decisions taken 2026-08-20

### 2.1 The DKIM gate keys on policy scope, not on the message and not on the mailbox

§6 as written: *"Filing requires DKIM alignment ... Where `Authentication-Results` shows DKIM
failing or absent, the message routes to `filing_queue` rather than being filed."*

**Amendment: the gate applies to `domain`-scoped file policies only. An `address`-scoped file
policy files without a DKIM gate.**

The threat §6 names is that *"a domain-based mapping means `@acmecorp.com` decides where a message
is permanently filed, so a spoofed `From` would let anyone write into a client's record folder."*
That threat is specific to a mapping keyed on a domain. An address-scoped policy is a line the
operator typed for one exact address; a spoofer must land on that exact address, already curated,
and the payoff is that the message is filed rather than left in the inbox.

Measured on the live database, 2026-08-20:

| | count |
|---|---|
| `file` policies, scope `address` | 40 |
| `file` policies, scope `domain` | 1 (`stripe.com`) |

Live messages matching a `file` policy, by mailbox and DKIM state:

| mailbox | aligned | failed | unknown (NULL) |
|---|---|---|---|
| felix@tellmann.co.za | 68 | 1 | **1,617** |
| felix@listifyregistry.com | 513 | 29 | 0 |
| felix@platter.com | 80 | 12 | 0 |
| felixtellmann@gmail.com | 69 | 1 | 0 |

`felix@tellmann.co.za` is hosted at xneelo, which does not stamp `Authentication-Results` at all,
so 96% of its filable mail has `dkimAligned IS NULL`. Under §6 read literally, 1,617 of 2,390
filable messages (68%) queue rather than file, and they are exactly the tax, banking and travel
records that motivated filing. Under the amendment, only `stripe.com` traffic is gated.

Two properties this choice buys, both worth defending in review:

- **No per-host special case.** A mailbox-keyed gate encodes "xneelo is untrustworthy" in the rules
  engine, and goes stale silently the day xneelo starts stamping headers. A scope-keyed gate does
  not mention hosts.
- **The gate strengthens automatically.** The moment the operator adds a domain-scoped file policy
  — which is the mapping §6 actually warns about — the gate applies to it without any code change.

**Residual risk, stated plainly:** a message spoofing one of the 40 curated addresses is filed into
a records folder rather than left in the inbox, and filing confers implied legitimacy. A forged FNB
notice in a banking folder reads as more trustworthy than the same message in an inbox. This is
accepted, not overlooked. §7.4's undo and the action journal make it reversible and visible.

### 2.2 Filing paths are logical, and bind to a physical folder per mailbox

§6 already says paths are logical and that the resolver renders them with the server's own
hierarchy delimiter. Phase 5 extends that from *delimiter* to *full physical name*.

The reason is data. `felix@tellmann.co.za` already carries a hand-built taxonomy — thirteen
folders, flat under `INBOX`, dot-delimited:

```
INBOX.KidsLiving              303   INBOX.docs                     64
INBOX.Move Knysna - CPT 2020  148   INBOX.Tellmann                 28
INBOX.Finances - Ref           99   INBOX.Personal                 26
INBOX.Broadwayjewellers        77   INBOX.Moritz                   21
INBOX.VW                       71   INBOX.Invoices                 19
                                    INBOX.Travel                   10
```

The three Gmail mailboxes carry **no user labels at all** — only `\Inbox`, `\Sent`, `\Important`,
`\Starred`. So the legacy-versus-new tension exists on exactly one mailbox, and the other three are
greenfield.

Adopting §6's `Clients/Acme` scheme naively would build a second taxonomy beside the first and stop
`INBOX.KidsLiving` — 303 messages of real history — from being where KidsLiving mail lives.

**Decision:** the database stores the logical path. Each mailbox binds logical paths to physical
folders; an unbound path is rendered from its segments with the mailbox's own delimiter and created
on first use.

```
logical  Clients/KidsLiving
  felix@tellmann.co.za   ->  INBOX.KidsLiving        (bound to the existing folder)
  the three Gmail boxes  ->  Clients/KidsLiving      (created on first use)
```

This is also what makes §6's headline payoff reachable: *"the dashboard can show all correspondence
for a client across all six mailboxes at once."* That needs one join key. Physical folder names
never agree across hosts, so joining on them cannot deliver that view; the logical path can.

---

## 3. The logical path model

### 3.1 Derivation — one function, one spelling

`senderPolicy.client` and `senderPolicy.topic` already exist as nullable `varchar(191)`
(`server/db/schema.ts:282-283`). No schema change is needed for the mapping itself. All 103 rows
currently have `client IS NULL`.

A single exported pure function derives the logical path, and every consumer — the resolver, the
shadow report, the admin UI, the SQL that powers the per-client view — calls it or is pinned
against it by test. Phase 3 was bitten five times by one semantic acquiring two spellings, and
Phase 4 pinned two more; this is the Phase 5 candidate and it is pinned from the start.

```
logicalPathFor({ client, topic }):
  client !== null && topic !== null  ->  `Clients/${client}/${topic}`
  client !== null                    ->  `Clients/${client}`
  topic  !== null                    ->  topic          (verbatim; may contain "/")
  otherwise                          ->  null           (no destination; queue it)
```

`client` stays a first-class queryable column rather than being folded into a path string, because
the cross-mailbox client view groups on it and a `LIKE 'Clients/%'` match over rendered paths is not
a sound substitute.

The third branch is the one to justify. Most of the seeded `file` traffic is not client
correspondence at all — it is records: tax, banking, travel, SaaS receipts. Those have no client,
and forcing one would make `Clients/Finances` a lie. Letting `topic` carry a slash-delimited path
when `client` is null expresses `Finances`, `Ops/Shopify`, `Personal/Tennis` without a third column.
The cost is that `topic` means two things depending on whether `client` is set; the mitigation is
that only this function is allowed to know that, and it is tested for both shapes.

### 3.2 Rendering and binding

```
resolveFolder(mailbox, logical_path):
  1. binding exists for (mailbox_id, logical_path)  ->  return its folder verbatim
  2. otherwise render: segments joined with mailbox.hierarchyDelimiter,
     prefixed with the mailbox's personal-namespace root where it has one
  3. if the rendered folder does not exist  ->  create it, then return it
```

`mailbox.hierarchyDelimiter` is already populated: `"."` on `felix@tellmann.co.za`, `"/"` on the
three Gmail mailboxes. Hardcoding `/` produces a literal folder named `Clients/Acme` on a
dot-delimited server — §6 calls this hazard out and the live data confirms it.

The namespace root in step 2 is the other half of the same hazard: on tellmann every user folder
lives under `INBOX.`, so a bare rendered `Clients.KidsLiving` would be created as a sibling of
`INBOX` rather than inside it. The root is derived from the existing folder list rather than
hardcoded: it is `INBOX` when every selectable folder is `INBOX` or sits beneath it, and null —
meaning top level — otherwise. Null is a determination, not a failure; Gmail's list contains
`[Gmail]/All Mail`, so top level is the correct answer there. The only hard failure is an empty
folder list, where there is no evidence to reason from at all, which follows the rule Phase 4 set
for a missing `\Archive` or `\Trash` special-use folder.

Bindings are operator-owned data, not derived. Phase 5 ships them as a seed script the operator
reviews and applies, in the shape of `scripts/seed-sender-policies.ts`.

---

## 4. What filing does on each flavour

The `file` verb has to mean the same thing on both flavours or undo restores the wrong thing —
the exact failure mode `server/mail/actions/kinds.ts` exists to prevent.

**Semantic: filing moves a message out of the inbox and into its destination.** On a generic IMAP
server a move out of `INBOX` does both at once. On Gmail the equivalent is two label edits in one
command.

| flavour | mutation | inverse |
|---|---|---|
| generic | `{ verb: "move", source_folder, target_folder }` | move back to `from_state.folder` |
| gmail | `{ verb: "set_labels", add_labels: [logical_path], remove_labels: ["\\Inbox"] }` | existing `set_labels` inverse |

Gmail must not use `move`. `applyToState` already models a Gmail move as a label rewrite that
discards every user label, and the canonical folder is `[Gmail]/All Mail` — a message cannot
meaningfully be moved out of All Mail. A label edit keeps the UID stable, which matters because
`message` rows and undo are keyed on folder plus UID.

The inverse needs no new code: `inverseOf`'s existing `set_labels` branch computes
`add_labels = mutation.remove_labels ∩ original` and `remove_labels = mutation.add_labels \ original`,
which removes the destination label and restores `\Inbox` exactly.

`PlanContext` gains `file_folder: string | null`, resolved by the caller from §3.2 and required by
`planFor("file")` through the existing `requireTargetFolder` guard. No folder name is hardcoded in
`kinds.ts`, consistent with how `archive_folder` and `trash_folder` are already handled.

---

## 5. The filing queue is a view over `Action`, not a new table

The Phase 4 handoff recorded `filing_queue` as "the one genuinely new table". Having read the
`Action` schema, that is wrong and this document overrides it.

`Action` already carries every field a queued filing needs: `message_id`, `mailbox_id`, `kind`,
`status`, `sender_policy_id`, `source`, `run_id`, `decided_at`, `from_state_json`, `error`. Status
`deferred` already means "deliberately not executed; nothing was sent to the mailbox", and
`server/mail/actions/status.ts` already encodes `error` on a `deferred` row as meaning `"deferred"`
rather than a failure. A parallel table would duplicate that identity, and the queue's resolution
step — file it after all — is precisely a status transition on the row that is already there.

**The filing queue is `kind = 'file' AND status = 'deferred'`.** The reason lives in `error`, drawn
from a closed set:

| reason | meaning |
|---|---|
| `no_mapping` | the policy has neither `client` nor `topic`, so §3.1 yields no path |
| `dkim_unaligned` | a domain-scoped policy whose message is not DKIM-aligned (§2.1) |
| `ambiguous_client` | §6's thread spanning two clients |
| `unresolvable_folder` | the logical path could not be rendered or created on this server |

One new nullable column on `Action` is required: **`targetPath varchar(191)`** — the logical path
the resolver chose, or NULL when it could not choose one. It is what the queue UI shows as the
proposal, what the operator edits, and what §6 means by *"the assignment is stored in the flext
database as well as written to the IMAP folder"*. Nullable rather than NOT NULL for the same reason
`mailboxId` is: 29,375 existing rows predate it.

Storing the assignment on `Action` rather than on `Message` is deliberate. The action row is the
audit trail — it says who decided, from which policy, in which run, and what the state was before.
A column on `Message` would record where a message sits without recording why, and re-filing after
a mapping edit would overwrite the record of the previous decision instead of adding to it.

---

## 6. The path out of `deferred`

`deferred` is terminal today, and that is a defect Phase 5 must fix or every `file` row Phase 4
parks is stranded. `promoteShadowActions` is guarded `WHERE status = 'shadow'` and
`loadPendingActions` selects only `pending`, so nothing can move a row forward.

**Resolution transitions `deferred` -> `pending`,** guarded `WHERE status = 'deferred' AND kind = 'file'`,
and sets `targetPath` to the path the operator confirmed. From there the row travels the existing
Phase 4 executor path unchanged: journal `from_state_json`, mutate, record `to_state_json`, mark
`applied`. Undo works with no new code because the row is an ordinary applied action.

Following the recurring fix shape — make the wrong thing unrepresentable rather than merely untaken
— the transition is a `WHERE` clause on the update, not a check in the caller, and the resolution
input type carries no `status` field so only one value can be written.

**Related defect to close in the same phase:** the refusal to approve a `file` policy is enforced in
the UI only (`src/routes/admin/shadow.tsx`). `approveDecision` and `promote.ts` have no kind check,
so a direct API call still promotes one. Phase 4 explicitly deferred the server-side guard to
Phase 5. With filing real, that guard is **retired rather than implemented**: approving a `file`
decision is now a legitimate operation, and a row whose mapping is missing is queued by the gate
with reason `no_mapping` rather than refused at approval. The UI-side refusal comes out in the same
change, so the two stop disagreeing. The guard that does bind is on the transition out of
`deferred`, which is scoped `WHERE status = 'deferred' AND kind = 'file'` so it can never un-defer
an `auto_trash` row.

---

## 7. Schema changes

Two, both additive:

```
Action
  + targetPath varchar(191) NULL          -- logical path chosen for a file action

FilingBinding                             -- new table
  id            varchar(191) PK
  createdAt     datetime(3) NOT NULL
  updatedAt     datetime(3) NOT NULL
  mailboxId     varchar(191) NOT NULL
  logicalPath   varchar(191) NOT NULL
  folder        varchar(512) NOT NULL     -- physical, server-native, delimiter already applied
  UNIQUE (mailboxId, logicalPath)
```

`folder` is 512 to match `Message.folder`. `logicalPath` is 191 to match the `client` and `topic`
columns it is derived from.

Generated with `bun run db:generate`; the operator applies it with `bun run db:migrate`. Migration
`0005` is still unapplied as of this writing, so Phase 5's migration will be `0006` and both land
together.

---

## 8. The read-only invariant widens, deliberately

Phase 4 redefined rather than dropped the invariant, and Phase 5 must do the same. Today:

> Mutating IMAP calls exist only in `server/mail/providers/imap.ts`, reached only through
> `MailboxProvider`'s mutation methods (`moveMessages`, `setLabels`), called only from
> `server/mail/actions/executor.ts` and `undo.ts`. Exactly one non-read-only `getMailboxLock`
> exists, at `imap.ts:171` inside `withWriteLock`.

Folder creation adds a third mutating method. The widened contract:

> ... mutation methods (`moveMessages`, `setLabels`, `createFolder`), called only from
> `server/mail/actions/executor.ts`, `undo.ts` and `server/mail/filing/resolver.ts`.

`createFolder` is narrower than the other two and should stay that way: it creates and it does not
delete, rename, or subscribe. `mailboxCreate` on an existing path is a no-op error the resolver
treats as success, so the create-then-use path is idempotent under a race.

The three greps in `docs/runbooks/2026-08-17-mail-sync-schedules.txt` must be updated with their
real output in the same phase. A task that leaves the invariant undefined has removed the safety net
rather than adjusted it.

---

## 9. Explicitly out of scope

- **Autonomy stays propose-only.** Nothing may set autonomy `auto`; §8 keeps promotion-to-auto for
  Phase 6, and `upsertPolicy` rejects `"auto"` at the Zod boundary. Do not weaken it.
- **`purge` still does not exist**, in any form. §1.7 keeps it for Phase 8.
- **Rescue detection** (§8) is Phase 6.
- **Bulk re-filing after a mapping edit** — §6 names it as a payoff of storing the assignment, and
  the storage lands here, but the replay itself is not Phase 5.
- **Backfilling `targetPath`** onto the 29,375 pre-existing action rows. The shadow report reads
  only the latest run id, so a fresh pass supersedes them.

---

## 10. What the operator still owes

All 103 sender policies have `client IS NULL` and `topic IS NULL`. Filing cannot propose a
destination for any of them until that mapping exists. `tmp/2026-08-18-mail-triage-run-1.md`
already proposes one for the bulk of the `file` set — `Clients/Listify`, `Clients/KidsLiving`,
`Ops/Shopify`, `Personal/Tennis`, `Personal/Restaurants`, `Personal/Medical`, and a `Finances`
group of sixteen senders that maps onto the existing `INBOX.Finances - Ref`.

Phase 5 ships that as a reviewable seed script rather than assuming it. The operator confirms the
client and topic values, and the bindings for tellmann's thirteen legacy folders, before anything
is filed.

---

## 11. Open questions this document does not settle

1. **Whether `Move Knysna - CPT 2020` and `docs` should be bound at all.** Both are legacy folders
   with no obvious sender policy pointing at them. Leaving them unbound is harmless — nothing files
   there — but it means they sit outside the taxonomy permanently.
2. **Whether topic splits are seeded now or earned later.** §6 says topic is "a secondary split only
   where volume earns it". `Clients/Listify` at 588 messages across four senders is the only
   candidate that plausibly earns one today.
3. **What the queue UI does with a message whose policy has since changed.** The action row records
   the decision as it was; the policy may now say something else. Phase 4 hit the same question with
   the approval ceremony and resolved it by keying on what the run recorded, not the policy's
   current action. The same answer probably applies, and should be confirmed during planning.
