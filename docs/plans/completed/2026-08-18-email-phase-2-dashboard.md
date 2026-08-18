# Email Suite Phase 2: Read-Only Dashboard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the 14,538 metadata rows Phase 1 collected into two operator surfaces — a cross-mailbox Sender table and a Needs Action queue — and repair the three derived-data defects that make both surfaces wrong today.

**Architecture:** Two read-only query modules under `server/mail/query/` own every dashboard read; they return plain data and never touch a mailbox. The `§5.1` signal derivations move into `server/mail/classify/signals.ts` as pure functions now, so Phase 3's rules engine consumes the identical code rather than a re-implementation. One new sync mode, `reclassify`, re-fetches headers with `BODY.PEEK` for messages already stored and rewrites only the derived columns — this is the only way to correct `to_me`, `cc_me` and `dkim_aligned`, because the headers they derive from are not persisted. Two new routes under the existing `/admin` auth gate render the surfaces; filter, sort and pagination state lives in URL search params, not a store.

**Tech Stack:** Drizzle + `mysql2` (MySQL on Coolify), ORPC + Zod v3, TanStack Start file routes with `validateSearch`, Tailwind v3, `bun test` for the pure helpers, `imapflow` 1.6.1 for the reclassify pass.

**Spec:** `docs/plans/specs/active/2026-07-27-email-management-design.md` — §1.9 (Needs Action signal set), §1.10 (identity addresses), §3 (data model), §5.1 (signals), §9 (surfaces and deep links), §13 (phase table).

## Global Constraints

- **Never run `bun run dev`** or any watch/long-running server. Verification is `bun run tsc`, `bunx biome check --fix <file>`, `bun test <file>`, and `bun run build` only where the route tree must be regenerated.
- **Never run `bun run db:push`, `bun run db:migrate`, or raw DML.** Schema changes: edit `server/db/schema.ts`, run `bun run db:generate`, then surface the generated SQL from `server/db/migrations/` for the operator to apply.
- **`DATABASE_URL`, `DATABASE_URL_DEV` and `DATABASE_URL_PROD` all point at the same production MySQL.** Any query written here runs against live data on the first execution.
- **Phase 2 does not mutate a mailbox.** Every `getMailboxLock` call passes `{ readOnly: true }` and every fetch uses `BODY.PEEK`. No `STORE`, `COPY`, `MOVE`, `EXPUNGE` or `APPEND` in this phase. The reclassify pass reads headers and writes only to our own database.
- **No new tables.** Phase 2 is read-only over Phase 1's schema; the only schema change is two indexes. `sender_policy`, `thread_state`, `sender_suppression`, `action` and `proposal` remain Phase 3+.
- TypeScript strict + `verbatimModuleSyntax` — type-only imports use `import type`. No `any`: use `unknown` + narrowing.
- Named exports only, never `export default`. `type` over `interface`. Functions/factories over classes. Two `if` blocks over `if/else` unless trivial.
- Biome: line width 140, double quotes, spaces. Run `bunx biome check --fix <file>` after editing a file.
- Comments: default to none. Write one only for a non-obvious *why* — a gotcha and its cause, an invariant, a spec reference. Never narrate the edit.
- Git: never `git add -A` / `git add .` — stage specific files by name. No `Co-Authored-By` trailers. Never push to `main`.
- Naming: `snake_case` variables and object fields, `camelCase` functions, no abbreviations.
- DB tables are PascalCase, DB columns camelCase passed explicitly as strings, `updatedAt` has no DB default and must be set on every insert.
- **Tailwind:** grep `tailwind.config.mjs` for an existing token before writing any sized or coloured class. The `bg-accent` / `text-accent-contrast` pair renders invisible text — use the `accent_button` constant already in `src/routes/admin/mail.tsx:32` as the reference.
- **`cn()` / `clsx()` goes directly in the JSX prop.** Never template literals, never an extracted variable for dynamic classes.

## Why the data repair is in this phase

Three defects were found on 2026-08-18 by querying the post-backfill database. All three make Phase 2's own surfaces wrong, so they are prerequisites rather than cleanup:

1. **`Message.senderId` is NULL on all 14,538 rows.** `server/mail/sync/writer.ts` builds sender aggregates and upserts them *after* the message insert (`writer.ts:64-85`, `writer.ts:230`) but never writes the foreign key back. `Message_senderId_idx` currently indexes an entirely null column. Tasks 6 and 7 fix forward and repair backwards.
2. **`dkimAligned` is NULL on 98.8% of rows** (176 of 14,538 set). The parser fix in commit `a1b25f2` landed 2026-08-17 at 11:02; the backfill finished at 06:50 the same morning, so every backfilled row was classified by the older parser that only read `header.d` and missed Gmail's `header.i`.
3. **`identity_addresses` holds only the login address on all four mailboxes**, while `MailboxObservedAddress` records the real recipients. `felix@listifyregistry.com` shows a **9% `to_me` rate** because its actual traffic arrives at `support@listifyregistry.com` (464), `dmarc@listifyregistry.com` (292), `felix@lunalemon.dev` (236) and `support@lunalemon.dev` (152). §1.10 warns this silently suppresses the entire Needs Action queue for an unrecognised alias, and that is exactly what has happened.

Defects 2 and 3 share a root cause: `to_me`, `cc_me` and `dkim_aligned` are computed at insert time (`writer.ts:191-204`) from `To`, `Cc`, `Delivered-To`, `X-Original-To` and `Authentication-Results` — **none of which are persisted**. The message upsert's `onDuplicateKeyUpdate` set (`writer.ts:216-224`) deliberately refreshes only flags and labels, so re-running a backfill does not recompute them either. Correcting them therefore requires re-fetching headers for rows that already exist, which is what Task 7 builds.

## File structure

| File | Responsibility |
|---|---|
| `server/mail/classify/signals.ts` | **New.** Pure `§5.1` signal derivation over a stored `Message` row. No IO. Phase 3's rules engine consumes this unchanged. |
| `server/mail/classify/signals.test.ts` | **New.** Fixture table driving every signal and volume bucket boundary. |
| `server/mail/query/senders.ts` | **New.** Cross-mailbox sender aggregation, filtering, sorting, pagination, and the single-sender profile. |
| `server/mail/query/needs-action.ts` | **New.** The `§1.9` predicate, grouped to one row per thread, each carrying its reasons. |
| `server/mail/query/deep-link.ts` | **New.** Pure Gmail thread-URL construction (`§9`). |
| `server/mail/query/deep-link.test.ts` | **New.** Decimal-to-hex conversion and the generic-IMAP fallback. |
| `server/mail/sync/reclassify.ts` | **New.** Re-fetches headers for stored messages and rewrites `to_me`, `cc_me`, `dkim_aligned`. |
| `server/mail/sync/repair.ts` | **New.** Backfills `Message.senderId` by address join. No mailbox access. |
| `server/mail/sync/writer.ts` | **Modify.** Resolve and write `sender_id` on insert. |
| `server/mail/types.ts` | **Modify.** Extend `SyncMode` with `reclassify` and `repair`. |
| `server/mail/sync/run.ts` | **Modify.** Dispatch the two new modes. |
| `server/db/schema.ts` | **Modify.** Two indexes: `Message.fromAddress`, `Message.internalDate`. |
| `server/orpc/mail.ts` | **Modify.** Four read procedures plus the identity-address writer already present. |
| `src/routes/admin/senders.tsx` | **New.** The Sender table surface. |
| `src/routes/admin/needs-action.tsx` | **New.** The Needs Action queue. |
| `src/routes/admin/mail.tsx` | **Modify.** Observed-address readout becomes a picker that writes `identity_addresses`. |
| `src/routes/admin/index.tsx` | **Modify.** Links to the two new surfaces. |

## Deliberately deferred

- **Snooze / done / "shouldn't be here"** need `thread_state` and `sender_suppression` rows (`§1.9`, `§3`). Phase 2 renders the queue read-only; the write path lands in Phase 3 alongside the tables. A dismiss button that cannot persist is worse than no button.
- **The policy and autonomy columns** on the Sender surface (`§9`) need `sender_policy`, which is Phase 3. The table ships with counts, reply counts and header flags — enough to do the triage work, which is the point of the surface.
- **Filing browser and Action Journal** (`§9`) belong to Phases 5 and 4 respectively.

---

### Task 1: Indexes for the dashboard read paths

**Files:**
- Modify: `server/db/schema.ts:150-200` (the `message` table's index block)
- Generated: `server/db/migrations/0002_*.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: `Message_fromAddress_idx` and `Message_internalDate_idx`, relied on by Tasks 4 and 5.

Every sender query joins `Message.fromAddress` to `Sender.address` (the `senderId` FK is null until Task 7, and even afterwards the address join stays the fallback for rows a repair has not reached). Needs Action sorts by staleness. Neither column is indexed today, and `Message` has 14,538 rows growing by a few hundred a day.

- [ ] **Step 1: Add the two indexes**

In `server/db/schema.ts`, inside the `message` table's second callback argument, alongside the existing `senderIndex`:

```ts
    fromAddressIndex: index("Message_fromAddress_idx").on(table.from_address),
    internalDateIndex: index("Message_internalDate_idx").on(table.internal_date),
```

- [ ] **Step 2: Generate the migration**

Run: `bun run db:generate`
Expected: a new `server/db/migrations/0002_*.sql` containing exactly two `CREATE INDEX` statements and nothing else. If it contains anything beyond those two statements, stop and report — the schema file has drifted from the live database.

- [ ] **Step 3: Verify and surface the SQL**

Run: `bun run tsc && bunx biome check --fix server/db/schema.ts && cat server/db/migrations/0002_*.sql`
Print the SQL in the response for the operator to apply with `bun run db:migrate`. Do not run the migration.

- [ ] **Step 4: Commit**

```bash
git add server/db/schema.ts server/db/migrations && git commit -m "feat: index the columns the dashboard reads" -- server/db/schema.ts server/db/migrations
```

---

### Task 2: Pure signal derivation

**Files:**
- Create: `server/mail/classify/signals.ts`
- Create: `server/mail/classify/signals.test.ts`

**Interfaces:**
- Consumes: nothing. Deliberately no IO and no Drizzle import — this is the module Phase 3's `rules.ts` composes with.
- Produces:
  - `type VolumeBucket = "low" | "medium" | "high" | "flood"`
  - `volumeBucket(message_count: number): VolumeBucket`
  - `type SignalInput` — the subset of stored `Message` columns the signals read, plus `my_reply_count` and `now`.
  - `type MessageSignals` — `{ is_bulk, is_automated, addressed_to_me, cc_me, sender_known, dkim_aligned, volume_bucket, age_days }`
  - `deriveSignals(input: SignalInput): MessageSignals`

`§5.1` defines these over headers. Phase 1 already distilled the headers into columns, so the Phase 2 implementation reads columns; the boundaries and names match the spec exactly so Phase 3 inherits them.

- [ ] **Step 1: Write the module**

```ts
export type VolumeBucket = "low" | "medium" | "high" | "flood";

export type SignalInput = {
  list_id: string | null;
  list_unsubscribe: string | null;
  precedence: string | null;
  auto_submitted: string | null;
  from_address: string | null;
  to_me: boolean;
  cc_me: boolean;
  dkim_aligned: boolean | null;
  internal_date: Date;
  sender_message_count: number;
  my_reply_count: number;
  now: Date;
};

export type MessageSignals = {
  is_bulk: boolean;
  is_automated: boolean;
  addressed_to_me: boolean;
  cc_me: boolean;
  sender_known: boolean;
  dkim_aligned: boolean | null;
  volume_bucket: VolumeBucket;
  age_days: number;
};

// §5.1 lists these three headers as the bulk markers. Precedence carries several values in the wild and
// only "bulk" and "list" mean automated distribution — "urgent" and "first-class" are ordinary mail.
const BULK_PRECEDENCE = new Set(["bulk", "list"]);
const AUTOMATED_LOCAL_PARTS = [/^no-?reply@/i, /^mailer-daemon@/i, /^postmaster@/i, /^do-?not-?reply@/i];

export function volumeBucket(message_count: number): VolumeBucket {
  if (message_count >= 1000) {
    return "flood";
  }
  if (message_count >= 100) {
    return "high";
  }
  if (message_count >= 10) {
    return "medium";
  }
  return "low";
}

export function deriveSignals(input: SignalInput): MessageSignals {
  const precedence = (input.precedence ?? "").trim().toLowerCase();
  const is_bulk = input.list_id !== null || input.list_unsubscribe !== null || BULK_PRECEDENCE.has(precedence);
  const from_address = input.from_address ?? "";
  const is_automated = input.auto_submitted !== null || AUTOMATED_LOCAL_PARTS.some((pattern) => pattern.test(from_address));
  const elapsed_ms = input.now.getTime() - input.internal_date.getTime();

  return {
    is_bulk,
    is_automated,
    addressed_to_me: input.to_me,
    cc_me: input.cc_me,
    sender_known: input.my_reply_count > 0,
    dkim_aligned: input.dkim_aligned,
    volume_bucket: volumeBucket(input.sender_message_count),
    age_days: Math.max(0, Math.floor(elapsed_ms / 86_400_000)),
  };
}
```

- [ ] **Step 2: Write the tests**

```ts
import { describe, expect, test } from "bun:test";
import { deriveSignals, volumeBucket } from "@server/mail/classify/signals";

const base = {
  list_id: null,
  list_unsubscribe: null,
  precedence: null,
  auto_submitted: null,
  from_address: "person@example.com",
  to_me: true,
  cc_me: false,
  dkim_aligned: true,
  internal_date: new Date("2026-08-01T00:00:00Z"),
  sender_message_count: 1,
  my_reply_count: 0,
  now: new Date("2026-08-11T00:00:00Z"),
};

describe("volumeBucket", () => {
  test("uses the §5.1 boundaries", () => {
    expect(volumeBucket(0)).toBe("low");
    expect(volumeBucket(9)).toBe("low");
    expect(volumeBucket(10)).toBe("medium");
    expect(volumeBucket(99)).toBe("medium");
    expect(volumeBucket(100)).toBe("high");
    expect(volumeBucket(999)).toBe("high");
    expect(volumeBucket(1000)).toBe("flood");
  });
});

describe("deriveSignals", () => {
  test("List-Id alone marks bulk", () => {
    expect(deriveSignals({ ...base, list_id: "<news.example.com>" }).is_bulk).toBe(true);
  });

  test("Precedence: urgent is not bulk", () => {
    expect(deriveSignals({ ...base, precedence: "urgent" }).is_bulk).toBe(false);
  });

  test("Precedence: bulk is bulk, case-insensitively", () => {
    expect(deriveSignals({ ...base, precedence: "Bulk" }).is_bulk).toBe(true);
  });

  test("a no-reply sender is automated without Auto-Submitted", () => {
    expect(deriveSignals({ ...base, from_address: "No-Reply@example.com" }).is_automated).toBe(true);
  });

  test("sender_known follows my_reply_count", () => {
    expect(deriveSignals({ ...base, my_reply_count: 0 }).sender_known).toBe(false);
    expect(deriveSignals({ ...base, my_reply_count: 1 }).sender_known).toBe(true);
  });

  test("age_days counts whole days and never goes negative", () => {
    expect(deriveSignals(base).age_days).toBe(10);
    expect(deriveSignals({ ...base, internal_date: new Date("2026-08-12T00:00:00Z") }).age_days).toBe(0);
  });
});
```

- [ ] **Step 3: Verify**

Run: `bun test server/mail/classify/signals.test.ts && bun run tsc && bunx biome check --fix server/mail/classify/signals.ts server/mail/classify/signals.test.ts`
Expected: all tests pass, tsc clean.

- [ ] **Step 4: Commit**

```bash
git add server/mail/classify/signals.ts server/mail/classify/signals.test.ts && git commit -m "feat: derive the message signals as pure functions" -- server/mail/classify/signals.ts server/mail/classify/signals.test.ts
```

---

### Task 3: Gmail deep links

**Files:**
- Create: `server/mail/query/deep-link.ts`
- Create: `server/mail/query/deep-link.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `type MessageLocation = { kind: "gmail"; url: string } | { kind: "generic"; folder: string; message_id: string | null }` and `buildMessageLocation(input)`.

`§9`: `X-GM-THRID` arrives as a decimal 64-bit integer and the Gmail URL fragment expects hexadecimal. The value exceeds `Number.MAX_SAFE_INTEGER`, so the conversion must go through `BigInt` — `parseInt` silently loses precision and produces a link to the wrong thread.

- [ ] **Step 1: Write the module**

```ts
export type MessageLocation = { kind: "gmail"; url: string } | { kind: "generic"; folder: string; message_id: string | null };

export function buildMessageLocation(input: {
  flavor: string;
  account_index: number | null;
  gm_thrid: string | null;
  folder: string;
  message_id: string | null;
}): MessageLocation {
  if (input.flavor !== "gmail" || input.gm_thrid === null) {
    return { kind: "generic", folder: input.folder, message_id: input.message_id };
  }

  // X-GM-THRID is a decimal 64-bit integer and the URL fragment expects hex; it exceeds
  // Number.MAX_SAFE_INTEGER, so BigInt is required — parseInt rounds and links to the wrong thread.
  const thread_hex = BigInt(input.gm_thrid).toString(16);
  return { kind: "gmail", url: `https://mail.google.com/mail/u/${input.account_index ?? 0}/#all/${thread_hex}` };
}
```

- [ ] **Step 2: Write the tests**

```ts
import { describe, expect, test } from "bun:test";
import { buildMessageLocation } from "@server/mail/query/deep-link";

describe("buildMessageLocation", () => {
  test("converts a 64-bit thread id without losing precision", () => {
    const location = buildMessageLocation({
      flavor: "gmail",
      account_index: 2,
      gm_thrid: "1839203948573920184",
      folder: "[Gmail]/All Mail",
      message_id: null,
    });
    expect(location).toEqual({ kind: "gmail", url: "https://mail.google.com/mail/u/2/#all/19862a3f283e8bb8" });
  });

  test("defaults a missing account index to 0", () => {
    const location = buildMessageLocation({ flavor: "gmail", account_index: null, gm_thrid: "255", folder: "x", message_id: null });
    expect(location).toEqual({ kind: "gmail", url: "https://mail.google.com/mail/u/0/#all/ff" });
  });

  test("falls back to folder and Message-ID for generic IMAP", () => {
    const location = buildMessageLocation({
      flavor: "generic",
      account_index: null,
      gm_thrid: null,
      folder: "INBOX.Finances - Ref",
      message_id: "<abc@example.com>",
    });
    expect(location).toEqual({ kind: "generic", folder: "INBOX.Finances - Ref", message_id: "<abc@example.com>" });
  });
});
```

Note: the expected hex was computed with `bun -e 'console.log(BigInt("1839203948573920184").toString(16))'` on 2026-08-18 and is correct as written.

- [ ] **Step 3: Verify**

Run: `bun test server/mail/query/deep-link.test.ts && bun run tsc && bunx biome check --fix server/mail/query/deep-link.ts server/mail/query/deep-link.test.ts`

- [ ] **Step 4: Commit**

```bash
git add server/mail/query/deep-link.ts server/mail/query/deep-link.test.ts && git commit -m "feat: build gmail thread deep links from the decimal thrid" -- server/mail/query/deep-link.ts server/mail/query/deep-link.test.ts
```

---

### Task 4: Sender query layer

**Files:**
- Create: `server/mail/query/senders.ts`

**Interfaces:**
- Consumes: `volumeBucket` from Task 2.
- Produces:
  - `type SenderFilter = { search: string | null; replied: "all" | "never" | "replied"; bulk: "all" | "bulk" | "direct"; mailbox_id: string | null; min_messages: number }`
  - `type SenderSort = "messages" | "replies" | "last_seen" | "address"`
  - `type SenderRow` — `{ address, domain, display_name, message_count, my_reply_count, volume_bucket, bulk_count, automated_count, unread_count, in_inbox_count, attachment_count, last_seen_at, mailbox_labels }`
  - `listSenders(input: { filter, sort, direction, limit, offset }): Promise<{ rows: SenderRow[]; total: number }>`
  - `getSenderProfile(address: string): Promise<SenderProfile | null>` where `SenderProfile` extends `SenderRow` with `first_seen_at`, `per_mailbox: { label, count }[]`, and `recent_subjects: { subject, internal_date, folder, location }[]` (up to 20, newest first).

Two things this layer must get right:

- **Join on `Message.fromAddress = Sender.address`, not on `senderId`.** The FK is null on every existing row and Task 7's repair is a separate, resumable pass — the dashboard must be correct before, during and after it.
- **`Sender` is global, not per mailbox** (`Sender_address_key` is unique on address alone), so `message_count` is a lifetime cross-mailbox total. `mailbox_labels` is derived by grouping `Message` and must not be assumed to match `message_count`.

- [ ] **Step 1: Write the module**

Use Drizzle's query builder with explicit `sql` fragments for the conditional aggregates. The shape:

```ts
import { db } from "@server/db";
import { mailbox, message, sender } from "@server/db/schema";
import { volumeBucket } from "@server/mail/classify/signals";
import { and, desc, asc, eq, gte, isNotNull, like, or, sql } from "drizzle-orm";

export type SenderSort = "messages" | "replies" | "last_seen" | "address";

export type SenderFilter = {
  search: string | null;
  replied: "all" | "never" | "replied";
  bulk: "all" | "bulk" | "direct";
  mailbox_id: string | null;
  min_messages: number;
};

export type SenderRow = {
  address: string;
  domain: string;
  display_name: string | null;
  message_count: number;
  my_reply_count: number;
  volume_bucket: ReturnType<typeof volumeBucket>;
  bulk_count: number;
  automated_count: number;
  unread_count: number;
  in_inbox_count: number;
  attachment_count: number;
  last_seen_at: string | null;
  mailbox_labels: string[];
};
```

The aggregate expressions to use, verified against the live schema on 2026-08-18:

```ts
const bulk_count = sql<number>`SUM(${message.list_id} IS NOT NULL OR ${message.list_unsubscribe} IS NOT NULL)`;
const automated_count = sql<number>`SUM(${message.auto_submitted} IS NOT NULL OR ${message.precedence} IS NOT NULL)`;
const unread_count = sql<number>`SUM(${message.is_seen} = 0)`;
const attachment_count = sql<number>`SUM(${message.has_attachment} = 1)`;
// Gmail keeps INBOX as a label on the canonical All Mail folder; generic IMAP uses a real folder.
const in_inbox_count = sql<number>`SUM(${message.folder} = 'INBOX' OR ${message.labels} LIKE '%Inbox%')`;
const mailbox_labels = sql<string>`GROUP_CONCAT(DISTINCT ${mailbox.label} ORDER BY ${mailbox.label} SEPARATOR '|')`;
```

`mailbox_labels` arrives as a pipe-joined string or `null`; split it with the existing `parseStringList` convention rather than returning the raw value — but note `parseStringList` in `server/mail/types.ts:17` parses JSON, so write a local `splitLabels(raw: string | null): string[]` here instead of reusing it.

Filters map as:
- `replied: "never"` → `eq(sender.my_reply_count, 0)`; `"replied"` → `gte(sender.my_reply_count, 1)`
- `bulk: "bulk"` → `HAVING` on `bulk_count > 0`; `"direct"` → `bulk_count = 0`
- `search` → `or(like(sender.address, ...), like(sender.domain, ...), like(sender.display_name, ...))` with `%` wrapping
- `mailbox_id` → `eq(message.mailbox_id, ...)` on the join
- `min_messages` → `gte(sender.message_count, ...)`

`total` comes from a second `count()` query using the same `where` clause, so pagination can render "showing 1–50 of 1,749".

Cap `limit` at 200 in the ORPC schema (Task 8), not here.

- [ ] **Step 2: Sanity-check against production, read-only**

The database is live, so verify by reading, never writing. Run a one-off script under `$CLAUDE_JOB_DIR/tmp` or `tmp/`:

```bash
bun --env-file=.env -e '
import { listSenders } from "./server/mail/query/senders";
const page = await listSenders({ filter: { search: null, replied: "never", bulk: "all", mailbox_id: null, min_messages: 15 }, sort: "messages", direction: "desc", limit: 5, offset: 0 });
console.log(page.total, page.rows.map((r) => `${r.address} ${r.message_count} ${r.volume_bucket}`));
process.exit(0);
'
```

Expected on 2026-08-18 data: `total` around 103, and the first rows are `felix@tellmann.co.za 1130 flood`, `no-reply@listifyregistry.com 517 high`, `no-reply@booknplay.co.za 490 high`. If `total` is 1749 the `replied` filter is not applied; if the counts are inflated the join is fanning out across mailboxes.

- [ ] **Step 3: Verify**

Run: `bun run tsc && bunx biome check --fix server/mail/query/senders.ts`

- [ ] **Step 4: Commit**

```bash
git add server/mail/query/senders.ts && git commit -m "feat: aggregate senders across every mailbox for the dashboard" -- server/mail/query/senders.ts
```

---

### Task 5: Needs Action query

**Files:**
- Create: `server/mail/query/needs-action.ts`

**Interfaces:**
- Consumes: `deriveSignals` from Task 2, `buildMessageLocation` from Task 3.
- Produces:
  - `type NeedsActionRow` — `{ thread_key, subject, from_address, from_name, mailbox_label, mailbox_id, internal_date, age_days, message_count, is_seen, reasons: string[], location: MessageLocation }`
  - `listNeedsAction(input: { mailbox_id: string | null; limit: number; offset: number }): Promise<{ rows: NeedsActionRow[]; total: number }>`

`§1.9`'s predicate, with the two clauses whose tables do not exist yet omitted:

```
NOT is_bulk AND NOT is_automated AND addressed_to_me
AND NOT last_in_thread_is_mine AND thread_state = 'open'      <- thread_state deferred to Phase 3
AND sender NOT IN sender_suppression                          <- deferred to Phase 3
```

What Phase 2 implements:

- `list_id IS NULL AND list_unsubscribe IS NULL` (not bulk)
- `auto_submitted IS NULL AND precedence IS NULL` (not automated)
- `to_me = 1` (addressed to me — **this is the clause the identity fix in Task 11 unblocks**)
- `disappeared_at IS NULL`
- the message is not in a Sent folder — exclude rows whose `folder` appears in that mailbox's `sent_folders`, which is how `last_in_thread_is_mine` is approximated until Phase 3 computes thread state properly

Group to one row per `thread_key`, keeping the newest message's subject and date, and sort by staleness (oldest newest-message first), which is what `§1.9` asks for.

**`reasons` is not decoration.** `§9` requires the surface to say *why it is here*, and it is the only thing that makes a false positive diagnosable. Build it from the signals: `"addressed directly to you"`, `"no reply sent"`, `"unread for 12 days"`, `"sender has written 4 times"`.

- [ ] **Step 1: Write the module**

Compose the `where` clause from the bullets above. Group with `GROUP BY thread_key` selecting `MAX(internalDate)` and the correlated newest subject. Because MySQL runs with `only_full_group_by`, every non-aggregated selected column must appear in `GROUP BY` or be wrapped — use `MAX()` on the display columns or a self-join on `(thread_key, MAX(internalDate))`. A grouped query that omits this fails at runtime with `ER_WRONG_FIELD_WITH_GROUP`, not at typecheck.

- [ ] **Step 2: Sanity-check against production, read-only**

```bash
bun --env-file=.env -e '
import { listNeedsAction } from "./server/mail/query/needs-action";
const page = await listNeedsAction({ mailbox_id: null, limit: 5, offset: 0 });
console.log("total", page.total);
for (const row of page.rows) console.log(row.age_days, row.mailbox_label, row.from_address, "|", row.reasons.join(", "));
process.exit(0);
'
```

Expected before the identity fix: a total in the low hundreds, with `felix@listifyregistry.com` badly under-represented (its `to_me` rate is 9%). Re-run this after Task 11 and expect the listify count to rise sharply — that delta is the acceptance test for the identity repair.

- [ ] **Step 3: Verify**

Run: `bun run tsc && bunx biome check --fix server/mail/query/needs-action.ts`

- [ ] **Step 4: Commit**

```bash
git add server/mail/query/needs-action.ts && git commit -m "feat: build the needs-action queue from the signal set" -- server/mail/query/needs-action.ts
```

---

### Task 6: Link messages to senders on write

**Files:**
- Modify: `server/mail/sync/writer.ts:64-85` (`upsertSenders`), `writer.ts:136-233` (the row build and insert)

**Interfaces:**
- Consumes: nothing new.
- Produces: `upsertSenders` returns `Map<string, string>` of lowercased address → `Sender.id`; every newly inserted `Message` carries `sender_id`.

Today `upsertSenders` runs *after* the message insert and discards the ids. Two changes: hoist the call above the insert, and have it return the id map so each row can set `sender_id`.

MySQL's `INSERT ... ON DUPLICATE KEY UPDATE` does not return ids for existing rows, and Phase 1 already learned that `$returningId` yields nothing when the primary key is a SQL default (recorded in the Phase 1 plan's task 15 deviation). So resolve the ids with a follow-up `SELECT` on the addresses just upserted, which is one query per batch rather than per sender.

- [ ] **Step 1: Change `upsertSenders` to return the id map**

```ts
async function upsertSenders(aggregates: SenderAggregate[]): Promise<Map<string, string>> {
  const now = new Date();
  for (const aggregate of aggregates) {
    // ...unchanged insert/onDuplicateKeyUpdate...
  }

  const addresses = aggregates.map((aggregate) => clamp(aggregate.address, 320) ?? "");
  if (addresses.length === 0) {
    return new Map();
  }
  const rows = await db.select({ id: sender.id, address: sender.address }).from(sender).where(inArray(sender.address, addresses));
  return new Map(rows.map((row) => [row.address.toLowerCase(), row.id]));
}
```

- [ ] **Step 2: Move the call above the message insert and set the column**

`upsertSenders` currently runs at `writer.ts:230`, after the insert loop. Move it to just before the `for (let offset = 0; ...)` chunk loop, capture the map, and add to the row object built at `writer.ts:136-210`:

```ts
      sender_id: from_address === null ? null : (sender_ids.get(from_address.toLowerCase()) ?? null),
```

Keep `upsertObservedAddresses` where it is.

- [ ] **Step 3: Verify**

Run: `bun test server/mail && bun run tsc && bunx biome check --fix server/mail/sync/writer.ts`
Expected: the existing 31 tests still pass. There is no unit test for the writer (it needs a database), so the real check is Task 7's repair reporting a small remainder after the next incremental sync.

- [ ] **Step 4: Commit**

```bash
git add server/mail/sync/writer.ts && git commit -m "fix: write the sender foreign key the message rows never carried" -- server/mail/sync/writer.ts
```

---

### Task 7: Repair and reclassify passes

**Files:**
- Create: `server/mail/sync/repair.ts`
- Create: `server/mail/sync/reclassify.ts`
- Modify: `server/mail/types.ts:5` and `:13` (the `SyncMode` union and its Zod schema)
- Modify: `server/mail/sync/run.ts` (dispatch)
- Modify: `docs/runbooks/2026-08-17-mail-sync-schedules.txt` (document both as one-off modes)

**Interfaces:**
- Consumes: `dkimAligned` from `classify/authentication`, `createIdentityMatcher` / `isAddressedToMe` / `isCcMe` from `classify/identity`, the provider contract from `providers/types`.
- Produces: `repairSenderLinks(input: { batch_size: number }): Promise<{ updated: number; remaining: number }>` and `reclassifyMailbox(input: { mailbox_row, provider, batch_size }): Promise<{ examined: number; changed: number }>`; `SyncMode` gains `"repair"` and `"reclassify"`.

**`repair.ts` needs no mailbox access.** `Sender.address` is unique, so the FK is recoverable by a join:

```sql
UPDATE Message m JOIN Sender s ON s.address = m.fromAddress SET m.senderId = s.id WHERE m.senderId IS NULL LIMIT ?
```

Batch it and report `remaining` so the operator can see it converge across runs rather than holding one transaction over 14,538 rows.

**`reclassify.ts` does need headers**, because `to_me`, `cc_me` and `dkim_aligned` derive from `To`, `Cc`, `Delivered-To`, `X-Original-To` and `Authentication-Results`, none of which are stored. It walks stored messages per mailbox and folder, re-fetches exactly the Phase 1 header set with `BODY.PEEK` (reuse `HEADER_FETCH_SPEC` from `providers/headers.ts:26` — do not write a second header list), recomputes the three columns with the mailbox's *current* `identity_addresses`, and writes only rows whose value actually changed.

Constraints that matter:

- Open the mailbox `{ readOnly: true }`. This pass must not set `\Seen` on 14,538 messages, which a non-PEEK fetch would do.
- Reuse the existing `SyncRun` logging so a reclassify shows up in the same table the operator already checks.
- Fetch by UID range in batches of 100, matching the backfill batch size set in commit `808f13f`.
- It is idempotent and resumable — track position in `MailboxCursor` under a new `kind` value `"reclassify"`, the same discriminator trick Phase 1 used to keep the Sent scan independent (`MailboxCursor_mailboxId_folder_kind_key`).

- [ ] **Step 1: Extend the sync mode union**

In `server/mail/types.ts`:

```ts
export type SyncMode = "incremental" | "reconcile" | "backfill" | "repair" | "reclassify";
export const sync_mode_schema = z.enum(["incremental", "reconcile", "backfill", "repair", "reclassify"]);
```

Then update the 400-response text in `src/routes/api/mail-sync.ts:34` so the error still lists the accepted values.

- [ ] **Step 2: Write `repair.ts`**

Batched `UPDATE ... JOIN` as above, looping until a batch updates 0 rows or `batch_size * 200` rows have been touched, returning `{ updated, remaining }` where `remaining` is a `COUNT(*) WHERE senderId IS NULL`.

- [ ] **Step 3: Write `reclassify.ts`**

Per folder: select stored `(id, uid, folder)` above the reclassify cursor in batches of 100, fetch their headers, recompute, and issue an `UPDATE` per changed row. Advance the cursor per batch. Count `examined` and `changed`.

- [ ] **Step 4: Dispatch both from `run.ts`**

Add the two modes to the switch in `runSyncForAllMailboxes`. `repair` runs once for the whole database rather than per mailbox — guard it so it executes on the first mailbox iteration only, or lift it above the loop and record it against a synthetic run row.

- [ ] **Step 5: Verify**

Run: `bun run tsc && bunx biome check --fix server/mail/sync/repair.ts server/mail/sync/reclassify.ts server/mail/sync/run.ts server/mail/types.ts src/routes/api/mail-sync.ts && bun test server/mail`

Then confirm the read-only contract still holds, exactly as Phase 1 verified at ship time:

```bash
grep -rn "getMailboxLock" server/mail | grep -v "readOnly: true"
grep -rn "messageFlagsAdd\|messageFlagsSet\|messageMove\|messageCopy\|messageDelete\|\.append(" server/mail
```

Expected: both print nothing.

- [ ] **Step 6: Commit**

```bash
git add server/mail/sync/repair.ts server/mail/sync/reclassify.ts server/mail/sync/run.ts server/mail/types.ts src/routes/api/mail-sync.ts && git commit -m "feat: add the repair and reclassify passes for the derived columns" -- server/mail/sync/repair.ts server/mail/sync/reclassify.ts server/mail/sync/run.ts server/mail/types.ts src/routes/api/mail-sync.ts
```

---

### Task 8: ORPC read procedures

**Files:**
- Modify: `server/orpc/mail.ts` (append to `mailProcedures`)

**Interfaces:**
- Consumes: Tasks 4, 5.
- Produces: `mail.listSenders`, `mail.getSenderProfile`, `mail.listNeedsAction`, `mail.getDashboardSummary`.

All four use the existing `authed` base from `server/orpc/base.ts:6` — the same gate `listMailboxes` already uses. Do not add a second auth mechanism.

- [ ] **Step 1: Add the procedures**

```ts
  listSenders: authed
    .input(
      z.object({
        search: z.string().nullable().default(null),
        replied: z.enum(["all", "never", "replied"]).default("all"),
        bulk: z.enum(["all", "bulk", "direct"]).default("all"),
        mailbox_id: z.string().nullable().default(null),
        min_messages: z.number().int().min(0).max(10_000).default(0),
        sort: z.enum(["messages", "replies", "last_seen", "address"]).default("messages"),
        direction: z.enum(["asc", "desc"]).default("desc"),
        limit: z.number().int().positive().max(200).default(50),
        offset: z.number().int().min(0).default(0),
      }),
    )
    .handler(async ({ input }) => listSenders({ filter: { ... }, sort: input.sort, direction: input.direction, limit: input.limit, offset: input.offset })),
```

`getDashboardSummary` returns the counts the two pages need in their headers: total messages, total senders, senders never replied to, needs-action total, and per-mailbox `{ label, messages, unread, last_sync_at, enabled, last_error }` so a failing mailbox is visible from the dashboard rather than only on `/admin/mail`.

- [ ] **Step 2: Verify**

Run: `bun run tsc && bunx biome check --fix server/orpc/mail.ts`

- [ ] **Step 3: Commit**

```bash
git add server/orpc/mail.ts && git commit -m "feat: expose the dashboard reads through the authed router" -- server/orpc/mail.ts
```

---

### Task 9: The Sender surface

**Files:**
- Create: `src/routes/admin/senders.tsx`

**Interfaces:**
- Consumes: `mail.listSenders`, `mail.getSenderProfile`, `mail.getDashboardSummary`.
- Produces: the `/admin/senders` route.

**Filter, sort and pagination state goes in URL search params**, per the project convention — use TanStack Router's `validateSearch` with a Zod schema mirroring Task 8's input, and read it with `Route.useSearch()`. This makes a filtered view linkable and survives a refresh, which matters when the triage session spans days.

Follow the existing admin page conventions from `src/routes/admin/mail.tsx`: the `Panel` component (`mail.tsx:24`), the `accent_button` / `field` / `secondary_button` class constants (`mail.tsx:32-35`), and `ActionButton` with its busy state (`mail.tsx:46`). Extract those five into `src/routes/admin/-ui.tsx` (the `-` prefix marks a private non-route file) and import them from both pages rather than duplicating — but only if that refactor stays mechanical; if it grows, leave `mail.tsx` alone and copy the constants.

Table columns: sender, mailboxes, total, replies, in inbox, unread, bulk / automated badges, volume bucket, last seen. Clicking a row opens the profile panel with the per-mailbox split and the 20 most recent subjects.

**Subjects are attacker-controlled text.** They are rendered as React children — never `dangerouslySetInnerHTML` — and long values truncate with CSS, not by slicing, so a crafted subject cannot break the layout.

- [ ] **Step 1: Write the route**

Loader reads `getDashboardSummary` and the first `listSenders` page from the validated search params. Subsequent filter changes navigate with `navigate({ search: ... })` so the URL stays the source of truth.

- [ ] **Step 2: Verify**

Run: `bun run tsc && bunx biome check --fix src/routes/admin/senders.tsx && bun run build`
Expected: build succeeds and `/admin/senders` appears in `src/routeTree.gen.ts`. Do not hand-edit that file.

- [ ] **Step 3: Commit**

```bash
git add src/routes/admin/senders.tsx && git commit -m "feat: add the cross-mailbox sender surface" -- src/routes/admin/senders.tsx
```

---

### Task 10: The Needs Action surface

**Files:**
- Create: `src/routes/admin/needs-action.tsx`
- Modify: `src/routes/admin/index.tsx`

**Interfaces:**
- Consumes: `mail.listNeedsAction`, `mail.getDashboardSummary`.
- Produces: the `/admin/needs-action` route, linked from the admin index alongside `/admin/mail` and `/admin/senders`.

One row per thread: sender, subject, mailbox, age, and the `reasons` list rendered as small badges. Gmail rows link out via `location.url`; generic rows show the folder and a copyable `Message-ID`, since `§9` notes IMAP has no equivalent addressing scheme.

Render the read-only state honestly: a short line stating that snooze and dismiss arrive in Phase 3, so the absence of those controls reads as "not yet" rather than "broken".

- [ ] **Step 1: Write the route and link it from the admin index**

- [ ] **Step 2: Verify**

Run: `bun run tsc && bunx biome check --fix src/routes/admin/needs-action.tsx src/routes/admin/index.tsx && bun run build`

- [ ] **Step 3: Commit**

```bash
git add src/routes/admin/needs-action.tsx src/routes/admin/index.tsx && git commit -m "feat: add the needs-action queue surface" -- src/routes/admin/needs-action.tsx src/routes/admin/index.tsx
```

---

### Task 11: Identity addresses from observed evidence

**Files:**
- Modify: `src/routes/admin/mail.tsx:220-235` (the observed-address action)

**Interfaces:**
- Consumes: the existing `mail.listObservedAddresses` and `mail.setIdentityAddresses` procedures (`server/orpc/mail.ts:146,161`).
- Produces: a picker that writes `identity_addresses`.

Today the button dumps observed addresses into a status string (`mail.tsx:226-228`). Turn it into a checkbox list, pre-ticked for addresses already in `identity_addresses`, ordered by `occurrences` descending, with a save that calls `setIdentityAddresses`.

**This is the highest-value fix in the phase and it is a UI change, not an algorithm.** The evidence is already in `MailboxObservedAddress`. As of 2026-08-18 the unregistered aliases are:

| Mailbox | Address | Occurrences |
|---|---|---|
| felix@tellmann.co.za | `tellmvdhst-felix@tellmann.co.za` | 7,658 |
| felix@tellmann.co.za | `tellmvdhst-info@tellmann.co.za` | 181 |
| felix@platter.com | `felix@platter.co` | 1,083 |
| felix@platter.com | `felix@frameworklabs.com` | 112 |
| felix@listifyregistry.com | `support@listifyregistry.com` | 464 |
| felix@listifyregistry.com | `dmarc@listifyregistry.com` | 292 |
| felix@listifyregistry.com | `felix@lunalemon.dev` | 236 |
| felix@listifyregistry.com | `support@lunalemon.dev` | 152 |

The operator decides which are genuinely theirs — `tellmvdhst-*` are xneelo's internal delivery forms and belong in the list; a shared alias might not.

**Setting these does not retroactively fix `to_me`.** That column was computed at insert. The reclassify pass from Task 7 is what applies the new identity list to existing rows, so the order is: set the addresses here, then run `reclassify`.

- [ ] **Step 1: Replace the readout with a picker**

- [ ] **Step 2: Verify**

Run: `bun run tsc && bunx biome check --fix src/routes/admin/mail.tsx && bun run build`

- [ ] **Step 3: Commit**

```bash
git add src/routes/admin/mail.tsx && git commit -m "feat: set identity addresses from the observed evidence" -- src/routes/admin/mail.tsx
```

---

### Task 12: Operator runbook and ship

**Files:**
- Modify: `docs/runbooks/2026-08-17-mail-sync-schedules.txt`
- Move: `docs/plans/active/2026-08-18-email-phase-2-dashboard.md` → `docs/plans/completed/`

**Interfaces:**
- Consumes: everything above.
- Produces: the documented one-off sequence and the shipped plan.

- [ ] **Step 1: Document the one-off repair sequence**

Add a section to the runbook, in the same style as its existing backfill note, stating that `repair` and `reclassify` are **one-off modes and must never be scheduled**, and giving the order that matters:

1. Set `identity_addresses` on every mailbox at `/admin/mail` (Task 11).
2. Run `repair` once — no mailbox access, fast.
3. Run `reclassify` per mailbox — re-fetches headers, expect roughly the backfill's duration (10,027 messages took 597 seconds for `felix@tellmann.co.za`), so run it from a terminal rather than the browser, exactly as the existing backfill note warns.
4. Re-run the Task 5 sanity check and confirm the `felix@listifyregistry.com` needs-action count has risen.

Use the same `bun -e` fetch form the runbook already uses — **the container has no `curl`**, verified in-container on 2026-08-17.

- [ ] **Step 2: Full verification**

Run: `bun run tsc && bunx biome check && bun test && bun run build`
Expected: zero tsc errors, biome clean, all tests pass, build registers `/admin/senders` and `/admin/needs-action`.

- [ ] **Step 3: Confirm the read-only invariants one final time**

```bash
grep -rn "getMailboxLock" server/mail | grep -v "readOnly: true"
grep -rn "messageFlagsAdd\|messageFlagsSet\|messageMove\|messageCopy\|messageDelete\|\.append(" server/mail
grep -rn "rejectUnauthorized" server/ src/ | grep -v "true"
grep -rn "db.delete" server/mail
```

Expected: all four print nothing.

- [ ] **Step 4: Ship**

```bash
git mv docs/plans/active/2026-08-18-email-phase-2-dashboard.md docs/plans/completed/
```

Append the closing marker:

```markdown
**Completed: YYYY-MM-DD**
- Verified: <what actually ran — tsc, biome, bun test, build, the four invariant greps>
- Open: <what wasn't checked — e.g. manual browser QA of the two new surfaces — silence = confirmed>
```

Then commit the move and the marker together.

---

## Self-review

| Spec section | Covered by |
|---|---|
| §1.9 Needs Action signal set | Task 5 (the two table-dependent clauses explicitly deferred, with reasons) |
| §1.10 identity addresses | Tasks 7 and 11 — the picker sets them, the reclassify pass applies them to existing rows |
| §3 data model | Task 1 (indexes only; no new tables in this phase, by design) |
| §5.1 signals | Task 2, as pure functions Phase 3's `rules.ts` consumes unchanged |
| §9 Sender Policy surface | Task 9 (policy and autonomy columns deferred to Phase 3 with `sender_policy`) |
| §9 Needs Action surface | Task 10 |
| §9 deep links | Task 3 (`BigInt` conversion) and Task 10 (rendering, with the generic-IMAP fallback) |
| §13 "Phase 2 is the first point of real value" | Tasks 9 and 10 |
| Data defects found 2026-08-18 | Tasks 6 and 7 (`senderId`), Task 7 (`dkimAligned`), Tasks 7 and 11 (`to_me`) |

**Known gaps, stated rather than hidden:**

- **`my_reply_count` can drift high.** Phase 1 recorded this: the Sent scan increments from a cursor, so a `UIDVALIDITY` change on a Sent folder re-counts history. Every consumer here uses `> 0`, so the ranking is unaffected and the displayed number is approximate. If the Sender surface makes the exact figure look authoritative, label the column "replies (approx)".
- **`reclassify` cost.** It re-fetches headers for every stored message. At the backfill's observed rate that is roughly 15 minutes across all four mailboxes. It is a one-off, and Task 12 documents it as such.
- **No test covers the query layer.** Both query modules need a database, and there is no dev database — `DATABASE_URL_DEV` points at production. The read-only sanity checks in Tasks 4 and 5 are the substitute, with expected values from the 2026-08-18 data recorded so a regression is visible.

**Completed: 2026-08-18**
- Verified: `bun run tsc` (0 errors). `bunx biome check` (195 files checked, 0 errors — 15 pre-existing warnings and 53 infos in unrelated files, e.g. `utils/scroll-to.tsx`'s `useDateNow` suggestions, none introduced by this task). `bun test` (49 pass, 0 fail, across 9 files). `bun run build` (succeeded; output includes `senders-*.mjs` and `needs-action-*.mjs` chunks, confirming `/admin/senders` and `/admin/needs-action` registered). The four read-only-contract greps: `getMailboxLock` non-readOnly, message-mutation calls, and `db.delete` in `server/mail` all printed nothing; `rejectUnauthorized` outside `server/mail/providers/tls.ts` and `server/db/drizzle.ts` printed nothing, and the three hits inside those two files are all `rejectUnauthorized: true` assignments plus two comments warning against `false` — no live violation. Documented the `repair`/`reclassify` one-off sequence, the migration-first ordering, and the reclassify-cursor no-op trap in `docs/runbooks/2026-08-17-mail-sync-schedules.txt`.
- Open: no browser ever rendered `/admin/senders`, `/admin/needs-action`, or the `/admin/mail` identity-address picker built in this phase — only `tsc`, `bun test`, and the production build confirmed they compile and bundle. `repair` and `reclassify` have never been executed against production; the operator sequence and the expected-numbers acceptance test in the runbook are unverified until someone runs it. `db:migrate` for `0002_absurd_cyclops.sql` has not been applied. Silence = confirmed.

**Post-ship: final whole-branch review, 2026-08-18**

The plan was moved to `completed/` at commit `6fc85e5`; a final whole-branch review then ran across all 16 commits and returned FIX FIRST. Three cross-cutting defects were found that no single-task review could have caught, and all were fixed in one wave (`39dd18c`, `d7e398d`, `1969001`), re-reviewed once, and cleared as SAFE TO MERGE.

- **Pagination was dead on both new dashboards.** The search-patch helper placed the literal `offset` key after the spread, so it overwrote the offset the Previous/Next handlers passed. The helper was duplicated into both route files, so each task review saw one copy with nothing to compare against. Only the first page of ~1,749 senders and ~6,749 threads was reachable.
- **The §5.1 signal rule was implemented three ways and two disagreed with `signals.ts`.** `needs-action.ts` excluded every row with a non-null `precedence`, dropping `urgent`/`first-class` mail from a surface §1.9 wants over-inclusive; `senders.ts` counted Precedence toward `automated_count` while `bulk_count` omitted it. `BULK_PRECEDENCE_VALUES` is now exported from `signals.ts` and the SQL in `server/mail/query/signal-sql.ts` is built from that same constant, so the rule has one source. The queue total was unchanged (6,750) because production currently holds only `bulk` and `list` values — the defect was latent and would have swallowed the first `urgent` message. The visible correction was on senders: automated-badged 268 → 190, bulk-badged 406 → 411.
- **The queue asserted a fact it did not establish.** `buildReasons` pushed `"no reply sent"` on every row — 200 of 200 — though no query condition established it. Replaced with `"you have never replied to this sender"`, emitted only when `sender_known` is false (95 of the first 200 rows), restoring a signal that was already computed and discarded. The comment claiming the Sent-folder exclusion approximates `NOT last_in_thread_is_mine` was corrected; that term remains unimplemented and belongs to Phase 3 with `thread_state`.

Also fixed: `disappeared_at` now filtered consistently across `senders.ts`; `runRepairOnce` no longer returns `status: "ok"` alongside a non-null `error`; the `/admin` index copy no longer claims mailbox management "arrives in phase 1"; invalid `<p>`-inside-`<button>` nesting removed; two runbook corrections (the cursor parks at `uid_next - 1`, and a `UIDVALIDITY` change produces the same silent no-op shape).

Verified after the fix wave: `bun run tsc` 0 errors, `bun test` 51 pass / 0 fail (up from 49), `bun run build` succeeded, biome clean, and all five read-only-contract greps clean — every `getMailboxLock` passes `readOnly: true`, no flag/COPY/MOVE/EXPUNGE/APPEND write exists in `server/mail`, the single fetch spec is `BODY.PEEK`, every `rejectUnauthorized` assignment is `true`, and there is no `db.delete` in `server/mail`.

Still open, unchanged: no browser has rendered any of the three new surfaces; `repair` and `reclassify` have never been executed; `0002_absurd_cyclops.sql` has not been applied.
