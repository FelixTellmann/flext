# Email Phase 5 — Filing to client folders: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to
> implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `file` a real action — derive a logical destination from the sender policy, resolve it
to a real folder on each server (creating it when needed), file the message, and queue everything that
cannot be resolved or trusted.

**Architecture:** A new pure `server/mail/filing/` module owns the logical-path model: derivation from
`(client, topic)`, the DKIM scope gate, and folder-path rendering. One impure resolver in the same
directory binds a logical path to a physical folder per mailbox and creates it on first use. The
executor's existing plan loop calls them; `planFor("file")` gains a `file_folder` the way `archive`
already has an `archive_folder`. The filing queue is not a table — it is `Action` rows at
`kind = 'file' AND status = 'deferred'`, and resolving one transitions it to `pending` so it rejoins
the Phase 4 executor path unchanged.

**Tech Stack:** TypeScript 7 (strict, `verbatimModuleSyntax`), Bun test, Drizzle + mysql2 (MySQL 8.4),
ORPC + Zod v3, imapflow 1.6.1, TanStack Start + React, Tailwind v3, Biome.

**Spec:** `docs/plans/specs/active/2026-08-20-email-phase-5-filing-design.md`, which amends §6 of
`docs/plans/specs/active/2026-07-27-email-management-design.md`. Read both; §6 carries a pointer.

---

## Global Constraints

- **Never run `bun run dev`** or any watch/long-running server. `bun run build` is fine and is required
  when the route tree must regenerate.
- **Never run `db:migrate`, `db:push`, or any DML.** `DATABASE_URL`, `DATABASE_URL_DEV` and
  `DATABASE_URL_PROD` all point at the same production MySQL. Read-only `SELECT` is fine.
  Schema work stops at `bun run db:generate` plus surfacing the SQL for the operator.
- **Never connect to a real IMAP server or mutate a real mailbox.** Everything is verified by
  `bun run tsc`, `bun test`, `bunx biome check` and reading.
- **Never `git push`.** Hand the operator the command.
- **Never `git add -A` / `git add .`.** Concurrent sessions commit into this tree. Run `git diff <file>`
  in an *earlier tool call* than the commit, then commit pathspec-limited:
  `git add <files> && git commit -m "..." -- <files>`. Keep gitignored paths out of that `&&` chain or
  `git add` aborts and the commit silently never runs.
- **Never run `git stash`, `git checkout`, `git restore`, or `git reset`** — not to isolate a failure,
  not to get a clean tree, not for any reason. Use `git diff`, `git show <ref>:<path>`, `git log -p`.
- **Never touch** `content/travel.tsx`, `content/travel-routes.ts`, `src/components/travel/` — another
  session owns them. **Never hand-edit** `src/routeTree.gen.ts` or `server/db/migrations/**`.
- **No `Co-Authored-By` trailers.**
- **Autonomy stays propose-only.** Nothing may set autonomy `"auto"`; `upsertPolicy` rejects it at the
  Zod boundary. Do not weaken that.
- **`purge` must not exist in any form** — no plan, no provider method, no kind. §1.7 keeps it for
  Phase 8.
- **The read-only invariant is redefined, not dropped** (Task 4). Mutating IMAP calls exist only in
  `server/mail/providers/imap.ts`, reached only through `MailboxProvider`'s mutation methods, called
  only from the files the runbook names. A task that leaves it undefined has removed the safety net.
- **One semantic, one spelling.** Phase 3 was bitten five times and Phase 4 twice more. The logical
  path is the Phase 5 candidate: it appears in TypeScript, in SQL, and in the UI. It is derived in
  exactly one function (Task 1) and every other consumer imports it or is pinned against it by a test.
- **Prefer unrepresentable over guarded.** Four Phase 4 fixes were durable because they made the wrong
  thing impossible — a `WHERE` clause instead of a caller check, an input type with no `status` field.
  Reach for that shape first.
- **Style:** Biome, line width 140, double quotes. Named exports only. `type` over `interface`.
  `snake_case` variables, `camelCase` functions. No `any`. `import type` for type-only imports.
  Run `bunx biome check --fix <file>` after editing a file.

---

## File Structure

**New — `server/mail/filing/`:**

| file | responsibility |
|---|---|
| `paths.ts` | pure. `logicalPathFor`, `filingDecisionFor`, the queue-reason constants. No IO. |
| `paths.test.ts` | pins both, including the two shapes `topic` can take. |
| `render.ts` | pure. `renderFolderPath`, `findNamespaceRoot`. Delimiter and namespace only. |
| `render.test.ts` | dot-delimited and slash-delimited cases, and the namespace hazard. |
| `resolver.ts` | impure. Binding lookup → render → create. The only new file allowed to mutate. |
| `resolver.test.ts` | over a fake provider. Never touches a real server. |
| `bindings.ts` | drizzle reads/writes for `FilingBinding`. |

**Modified:** `server/db/schema.ts`, `server/mail/actions/kinds.ts`, `server/mail/actions/executor.ts`,
`server/mail/actions/journal.ts`, `server/mail/providers/types.ts`, `server/mail/providers/imap.ts`,
`server/mail/shadow/run.ts`, `server/orpc/mail.ts`, `src/routes/admin/`,
`docs/runbooks/2026-08-17-mail-sync-schedules.txt`, `scripts/`.

---

### Task 1: The logical path model

The one place that knows how `(client, topic)` becomes a path, and when a message may be filed at all.
Pure: no IO, no provider, no database. Everything downstream imports from here.

**Files:**
- Create: `server/mail/filing/paths.ts`
- Create: `server/mail/filing/paths.test.ts`
- Modify: `server/mail/query/policies.ts` (Zod refinement on `client`)
- Modify: `server/orpc/mail.ts` (`upsertPolicy` input schema)

**Interfaces:**
- Consumes: `PolicyScope` from `@server/mail/classify/rules`.
- Produces:
  - `logicalPathFor(mapping: PolicyFilingMapping): string | null`
  - `filingDecisionFor(input: FilingGateInput): FilingDecision`
  - `FILING_QUEUE_REASONS`, `FilingQueueReason`, `CLIENTS_ROOT`

- [ ] **Step 1: Write `server/mail/filing/paths.ts`**

```ts
import type { PolicyScope } from "@server/mail/classify/rules";

// The logical path separator, which is NOT any server's hierarchy delimiter. A logical path is
// delimiter-free by construction and only server/mail/filing/render.ts is allowed to turn it into
// something a server understands — §6 says "paths are logical" and this is where that starts.
export const LOGICAL_SEPARATOR = "/";

export const CLIENTS_ROOT = "Clients";

// The closed set of reasons a message reaches the filing queue instead of a folder. Exported as a tuple
// so the admin route and the Zod boundary can both derive from it rather than restating four strings.
export const FILING_QUEUE_REASONS = ["no_mapping", "dkim_unaligned", "ambiguous_client", "unresolvable_folder"] as const;
export type FilingQueueReason = (typeof FILING_QUEUE_REASONS)[number];

export type PolicyFilingMapping = { client: string | null; topic: string | null };

// Trims each segment and drops empties, so "Ops//Shopify " and " Ops/Shopify" render the same path and
// neither can produce a zero-length folder name. Returns null when nothing survives.
function normalizeSegments(raw: string): string[] | null {
  const segments = raw
    .split(LOGICAL_SEPARATOR)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
  return segments.length === 0 ? null : segments;
}

// §6's axes, and the one place that knows how they compose.
//
//   client + topic  ->  Clients/<client>/<topic>
//   client          ->  Clients/<client>
//   topic           ->  <topic>, verbatim, and it MAY carry its own hierarchy
//   neither         ->  null
//
// The third branch is the one that needs justifying. Most of the seeded `file` traffic is records —
// tax, banking, travel, SaaS receipts — which have no client, and inventing one would make
// `Clients/Finances` a lie. Letting `topic` carry a slash-delimited path expresses `Finances`,
// `Ops/Shopify` and `Personal/Tennis` without a third column. The cost is that `topic` means two
// things depending on whether `client` is set, and the containment of that cost is this function:
// nothing else may split, join or interpret either column.
//
// `client` is never allowed to carry a separator — upsertPolicy rejects it at the Zod boundary, so a
// client cannot silently inject hierarchy — which is why only `topic` is passed through whole here.
export function logicalPathFor(mapping: PolicyFilingMapping): string | null {
  const client = mapping.client === null ? null : normalizeSegments(mapping.client);
  const topic = mapping.topic === null ? null : normalizeSegments(mapping.topic);

  if (client !== null) {
    const segments = topic === null ? [CLIENTS_ROOT, ...client] : [CLIENTS_ROOT, ...client, ...topic];
    return segments.join(LOGICAL_SEPARATOR);
  }

  if (topic !== null) {
    return topic.join(LOGICAL_SEPARATOR);
  }

  return null;
}

export type FilingGateInput = {
  logical_path: string | null;
  policy_scope: PolicyScope | null;
  dkim_aligned: boolean | null;
};

export type FilingDecision =
  | { outcome: "file"; logical_path: string }
  | { outcome: "queue"; reason: FilingQueueReason; detail: string };

// §6's DKIM gate as amended 2026-08-20: it applies to `domain`-scoped policies only.
//
// The threat §6 names is that "@acmecorp.com decides where a message is permanently filed, so a spoofed
// From would let anyone write into a client's record folder" — a threat specific to a mapping keyed on a
// domain. An address-scoped policy is a line the operator typed for one exact address. Measured
// 2026-08-20: 40 of the 41 file policies are address-scoped, and gating them all would queue 1,617 of
// 2,390 filable messages, every one of them on the mailbox whose host stamps no Authentication-Results.
//
// `dkim_aligned !== true` rather than `=== false`: §6 queues DKIM "failing or absent", and absent is NULL.
//
// A null scope means no policy produced this decision. rules.ts step 5 can only ever derive `archive`,
// `keep_inbox` or `needs_action`, so a derived `file` cannot exist and a null scope here means the row
// carries a logical path with no policy behind it. It is left ungated rather than queued because the
// path had to come from somewhere, and queuing on a condition that cannot occur would be untestable.
export function filingDecisionFor(input: FilingGateInput): FilingDecision {
  if (input.logical_path === null) {
    return {
      outcome: "queue",
      reason: "no_mapping",
      detail: "the sender policy sets neither a client nor a topic, so §6 has no axis to file this on. Set one on the policy and resolve this row.",
    };
  }

  if (input.policy_scope === "domain" && input.dkim_aligned !== true) {
    return {
      outcome: "queue",
      reason: "dkim_unaligned",
      detail: `a domain-scoped policy chose ${input.logical_path}, and this message is not DKIM-aligned, so the From header deciding a permanent destination is exactly the spoofing risk §6 gates. Confirm the destination to file it anyway.`,
    };
  }

  return { outcome: "file", logical_path: input.logical_path };
}
```

- [ ] **Step 2: Write `server/mail/filing/paths.test.ts`**

```ts
import { describe, expect, test } from "bun:test";
import { filingDecisionFor, logicalPathFor } from "@server/mail/filing/paths";

describe("logicalPathFor", () => {
  test("composes client and topic under the Clients root", () => {
    expect(logicalPathFor({ client: "Listify", topic: "Invoices" })).toBe("Clients/Listify/Invoices");
  });

  test("uses the client alone when there is no topic", () => {
    expect(logicalPathFor({ client: "KidsLiving", topic: null })).toBe("Clients/KidsLiving");
  });

  test("passes a client-less topic through verbatim, hierarchy included", () => {
    expect(logicalPathFor({ client: null, topic: "Ops/Shopify" })).toBe("Ops/Shopify");
    expect(logicalPathFor({ client: null, topic: "Finances" })).toBe("Finances");
  });

  test("returns null when neither axis is set", () => {
    expect(logicalPathFor({ client: null, topic: null })).toBeNull();
  });

  test("normalizes empty and whitespace segments away", () => {
    expect(logicalPathFor({ client: null, topic: "Ops//Shopify " })).toBe("Ops/Shopify");
    expect(logicalPathFor({ client: "  ", topic: null })).toBeNull();
    expect(logicalPathFor({ client: null, topic: "///" })).toBeNull();
  });
});

describe("filingDecisionFor", () => {
  test("files an address-scoped policy regardless of DKIM state", () => {
    for (const dkim_aligned of [true, false, null]) {
      const decision = filingDecisionFor({ logical_path: "Finances", policy_scope: "address", dkim_aligned });
      expect(decision).toEqual({ outcome: "file", logical_path: "Finances" });
    }
  });

  test("files a domain-scoped policy only when DKIM is aligned", () => {
    const aligned = filingDecisionFor({ logical_path: "Finances", policy_scope: "domain", dkim_aligned: true });
    expect(aligned.outcome).toBe("file");
  });

  test("queues a domain-scoped policy when DKIM fails or is absent", () => {
    for (const dkim_aligned of [false, null]) {
      const decision = filingDecisionFor({ logical_path: "Finances", policy_scope: "domain", dkim_aligned });
      expect(decision.outcome).toBe("queue");
      expect(decision).toMatchObject({ reason: "dkim_unaligned" });
    }
  });

  test("queues a policy with no mapping before it looks at DKIM at all", () => {
    const decision = filingDecisionFor({ logical_path: null, policy_scope: "domain", dkim_aligned: true });
    expect(decision).toMatchObject({ outcome: "queue", reason: "no_mapping" });
  });
});
```

- [ ] **Step 3: Reject a separator in `client` at the write boundary**

Make the invalid mapping unrepresentable rather than handled. In `server/orpc/mail.ts`, the
`upsertPolicy` input schema's `client` field gains a refinement; mirror the same rule on
`UpsertPolicyInput` handling in `server/mail/query/policies.ts` if it validates there too.

```ts
client: z
  .string()
  .max(191)
  .refine((value) => !value.includes("/"), {
    message: "a client name may not contain \"/\": it is one segment of a logical path, and a separator here would let a policy inject folder hierarchy that logicalPathFor never sees.",
  })
  .nullable()
  .optional(),
```

- [ ] **Step 4: Verify**

```bash
bun test server/mail/filing/paths.test.ts
bun run tsc
bunx biome check --fix server/mail/filing/paths.ts server/mail/filing/paths.test.ts server/orpc/mail.ts
```

Expected: tests pass, 0 tsc errors.

- [ ] **Step 5: Commit**

```bash
git diff server/orpc/mail.ts server/mail/query/policies.ts   # earlier tool call than the commit
git add server/mail/filing/paths.ts server/mail/filing/paths.test.ts server/orpc/mail.ts && \
  git commit -m "feat: derive one logical filing path and gate it on policy scope" -- \
  server/mail/filing/paths.ts server/mail/filing/paths.test.ts server/orpc/mail.ts
```

---

### Task 2: Schema — `Action.targetPath` and `FilingBinding`

**Files:**
- Modify: `server/db/schema.ts`
- Generated (do not hand-edit): `server/db/migrations/**`

**Interfaces:**
- Produces: `filingBinding` drizzle table; `action.target_path` column.

- [ ] **Step 1: Add the column to `Action`**

In `server/db/schema.ts`, inside the `action` table definition, after `to_state_json`:

```ts
    // The logical path §6 chose for a `file` action — "Clients/KidsLiving", never a server-native folder
    // name. Written by the shadow runner as the proposal and by filing-queue resolution as the operator's
    // confirmation; server/mail/filing/render.ts is the only thing that turns it into a real folder.
    // Nullable for the same reason mailboxId is: 29,375 rows predate it, and it is meaningless on the
    // archive and trash kinds.
    target_path: varchar("targetPath", { length: 191 }),
```

- [ ] **Step 2: Add the `FilingBinding` table**

After the `action` table:

```ts
// ─── FilingBinding ───────────────────────────────────────────────────────────
// One mailbox's answer to "where does this logical path actually live?". §6 says filing paths are
// logical; this is what makes that true across servers that disagree about names. felix@tellmann.co.za
// carries thirteen hand-built folders flat under INBOX ("INBOX.KidsLiving", "INBOX.Finances - Ref") and
// the three Gmail mailboxes carry no user labels at all, so the same logical path has to reach an
// existing folder on one server and a folder created on first use on another.
//
// A logical path with no binding is not an error: render.ts derives a folder from its segments and the
// resolver creates it. A binding exists to override that, which is why `folder` is stored verbatim,
// delimiter already applied, and never re-rendered.
export const filingBinding = mysqlTable(
  "FilingBinding",
  {
    id: varchar("id", { length: 191 }).primaryKey().default(sql`(UUID())`),
    createdAt: datetime("createdAt", { fsp: 3 }).default(sql`CURRENT_TIMESTAMP(3)`).notNull(),
    updatedAt: datetime("updatedAt", { fsp: 3 }).notNull(),
    mailbox_id: varchar("mailboxId", { length: 191 }).notNull(),
    // 191 to match the `client` and `topic` columns a path is derived from.
    logical_path: varchar("logicalPath", { length: 191 }).notNull(),
    // 191 because Message.folder is 191: a bound folder is one a message will actually be stored under,
    // so a binding this column could hold and that one could not would fail at the next sync rather than
    // here. A server-native path, delimiter already applied.
    folder: varchar("folder", { length: 191 }).notNull(),
  },
  (table) => ({
    mailboxLogicalPathUnique: uniqueIndex("FilingBinding_mailboxId_logicalPath_key").on(table.mailbox_id, table.logical_path),
  }),
);
```

- [ ] **Step 3: Generate the migration**

```bash
bun run db:generate
```

Expected: a new `server/db/migrations/0006_*.sql` adding one column and one table. **Do not run
`db:migrate`.** Read the generated SQL and confirm it is additive only — no `DROP`, no `MODIFY` on an
existing column. Migration `0005` is still unapplied; the operator applies both together.

- [ ] **Step 4: Verify**

```bash
bun run tsc
bunx biome check --fix server/db/schema.ts
cat server/db/migrations/0006_*.sql
```

- [ ] **Step 5: Commit**

```bash
git diff server/db/schema.ts   # earlier tool call than the commit
git add server/db/schema.ts server/db/migrations && \
  git commit -m "feat: add Action.targetPath and the FilingBinding table" -- \
  server/db/schema.ts server/db/migrations
```

Report the generated SQL in the task report so the controller can surface it to the operator.

---

### Task 3: Rendering a logical path onto a real server

Pure. Turns `Clients/KidsLiving` into `INBOX.Clients.KidsLiving` on a dot-delimited server and
`Clients/KidsLiving` on a slash-delimited one. Knows nothing about bindings or folder creation.

**Files:**
- Create: `server/mail/filing/render.ts`
- Create: `server/mail/filing/render.test.ts`

**Interfaces:**
- Consumes: `FolderInfo` from `@server/mail/providers/types`; `LOGICAL_SEPARATOR` from `paths.ts`.
- Produces:
  - `findNamespaceRoot(folders: FolderInfo[], delimiter: string): string | null`
  - `renderFolderPath(input: { logical_path: string; delimiter: string; namespace_root: string | null }): string`

- [ ] **Step 1: Write `server/mail/filing/render.ts`**

```ts
import { LOGICAL_SEPARATOR } from "@server/mail/filing/paths";
import type { FolderInfo } from "@server/mail/providers/types";

const INBOX = "INBOX";

// Where a new user folder belongs on this server. On felix@tellmann.co.za every user folder lives under
// "INBOX." — INBOX.KidsLiving, INBOX.Finances - Ref, INBOX.Sent — so a folder rendered as
// "Clients.KidsLiving" would be created as a SIBLING of INBOX rather than inside it, which is a
// different mailbox from the one the operator's thirteen existing folders live in. On Gmail the folder
// list is "INBOX" and "[Gmail]/All Mail", which is not INBOX-rooted, and a new label belongs at the top
// level.
//
// Derived from the server's own LIST output rather than from the flavour: this is a namespace fact, and
// a generic IMAP server may be either shape. Returns null for "top level", which is a determination and
// not a failure — the caller only has to refuse when there is no folder list at all to reason from.
export function findNamespaceRoot(folders: FolderInfo[], delimiter: string): string | null {
  const selectable = folders.filter((folder) => folder.selectable && folder.path.length > 0);
  if (selectable.length === 0) {
    throw new Error(
      "the server returned no selectable folders, so there is no evidence for where a new folder belongs. Refusing rather than guessing a namespace: creating a filing folder in the wrong namespace puts mail somewhere the operator's mail client does not show it.",
    );
  }

  const prefix = `${INBOX}${delimiter}`;
  const all_inbox_rooted = selectable.every((folder) => folder.path === INBOX || folder.path.startsWith(prefix));
  return all_inbox_rooted ? INBOX : null;
}

// The logical path's separator is replaced by the server's delimiter, never the other way round. §6 calls
// this out and the live data confirms it: hardcoding "/" produces a literal folder named "Clients/Acme"
// on a dot-delimited server, and felix@tellmann.co.za is dot-delimited.
//
// A segment containing the server's own delimiter would inject hierarchy the logical path never asked
// for, so it is refused rather than escaped — there is no portable escape, and the fix belongs in the
// policy that named the segment.
export function renderFolderPath(input: { logical_path: string; delimiter: string; namespace_root: string | null }): string {
  if (input.delimiter.length === 0) {
    throw new Error(
      "the mailbox has no hierarchy delimiter, so a multi-segment logical path cannot be rendered. Mailbox.hierarchyDelimiter is populated at sync time from the LIST response; an empty one means the mailbox was never synced.",
    );
  }

  const segments = input.logical_path.split(LOGICAL_SEPARATOR).filter((segment) => segment.length > 0);
  if (segments.length === 0) {
    throw new Error(`the logical path "${input.logical_path}" has no segments, so there is no folder to render.`);
  }

  for (const segment of segments) {
    if (segment.includes(input.delimiter)) {
      throw new Error(
        `the path segment "${segment}" contains this server's hierarchy delimiter "${input.delimiter}", so rendering it would create folder levels the logical path never named. Rename the client or topic on the sender policy.`,
      );
    }
  }

  const rooted = input.namespace_root === null ? segments : [input.namespace_root, ...segments];
  return rooted.join(input.delimiter);
}
```

- [ ] **Step 2: Write `server/mail/filing/render.test.ts`**

Cover, with a `folder(path)` helper building `FolderInfo` values:

```ts
import { describe, expect, test } from "bun:test";
import { findNamespaceRoot, renderFolderPath } from "@server/mail/filing/render";
import type { FolderInfo } from "@server/mail/providers/types";

function folder(path: string): FolderInfo {
  return { path, delimiter: ".", special_use: null, subscribed: true, selectable: true };
}

describe("findNamespaceRoot", () => {
  test("returns INBOX when every folder is INBOX-rooted, as on felix@tellmann.co.za", () => {
    const folders = [folder("INBOX"), folder("INBOX.Sent"), folder("INBOX.KidsLiving"), folder("INBOX.Finances - Ref")];
    expect(findNamespaceRoot(folders, ".")).toBe("INBOX");
  });

  test("returns null when a folder lives outside INBOX, as on Gmail", () => {
    const folders = [folder("INBOX"), folder("[Gmail]/All Mail")];
    expect(findNamespaceRoot(folders, "/")).toBeNull();
  });

  test("ignores unselectable folders", () => {
    const folders = [folder("INBOX"), folder("INBOX.KidsLiving"), { ...folder("[Gmail]"), selectable: false }];
    expect(findNamespaceRoot(folders, ".")).toBe("INBOX");
  });

  test("refuses an empty folder list rather than guessing", () => {
    expect(() => findNamespaceRoot([], ".")).toThrow(/no selectable folders/);
  });
});

describe("renderFolderPath", () => {
  test("renders with the server's delimiter under its namespace root", () => {
    expect(renderFolderPath({ logical_path: "Clients/KidsLiving", delimiter: ".", namespace_root: "INBOX" })).toBe(
      "INBOX.Clients.KidsLiving",
    );
  });

  test("renders at the top level when there is no namespace root", () => {
    expect(renderFolderPath({ logical_path: "Clients/KidsLiving", delimiter: "/", namespace_root: null })).toBe("Clients/KidsLiving");
  });

  test("never emits a literal slash on a dot-delimited server", () => {
    const rendered = renderFolderPath({ logical_path: "Ops/Shopify", delimiter: ".", namespace_root: "INBOX" });
    expect(rendered).not.toContain("/");
  });

  test("refuses a segment carrying the server's own delimiter", () => {
    expect(() => renderFolderPath({ logical_path: "Finances - Ref/A.B", delimiter: ".", namespace_root: "INBOX" })).toThrow(
      /hierarchy delimiter/,
    );
  });

  test("refuses an empty delimiter", () => {
    expect(() => renderFolderPath({ logical_path: "Finances", delimiter: "", namespace_root: null })).toThrow(/no hierarchy delimiter/);
  });
});
```

- [ ] **Step 3: Verify and commit**

```bash
bun test server/mail/filing/render.test.ts && bun run tsc
bunx biome check --fix server/mail/filing/render.ts server/mail/filing/render.test.ts
git add server/mail/filing/render.ts server/mail/filing/render.test.ts && \
  git commit -m "feat: render a logical filing path with the server's own delimiter" -- \
  server/mail/filing/render.ts server/mail/filing/render.test.ts
```

---

### Task 4: `createFolder` on the provider, and the widened invariant

This is the task that opens a new mutating call. Phase 4 redefined the read-only invariant rather than
dropping it; do the same, in the same commit.

**Files:**
- Modify: `server/mail/providers/types.ts`
- Modify: `server/mail/providers/imap.ts`
- Modify: `docs/runbooks/2026-08-17-mail-sync-schedules.txt`

**Interfaces:**
- Produces: `MailboxProvider.createFolder: (folder: string) => Promise<void>`

- [ ] **Step 1: Add the method to `MailboxProvider`**

Extend the existing block comment above `MailboxProvider` in `server/mail/providers/types.ts` — do not
replace it, it carries the reasoning for why `purge`, `copyMessages` and `expungeUids` are absent. Add:

```ts
  // Phase 5 (§6): filing creates a destination folder on first use. Deliberately the narrowest possible
  // mutation — it creates, and it cannot delete, rename, unsubscribe or move anything. A folder that
  // already exists is success, not an error, so the create-then-use path is idempotent under a race with
  // the operator's own mail client. Unlike moveMessages and setLabels this needs no selected mailbox and
  // therefore no write lock, which is why imap.ts still holds exactly one non-read-only getMailboxLock.
  createFolder: (folder: string) => Promise<void>;
```

- [ ] **Step 2: Implement it in `server/mail/providers/imap.ts`**

Inside `buildImapProvider`, alongside `moveMessages` and `setLabels`:

```ts
    createFolder: async (folder: string): Promise<void> => {
      // imapflow resolves with { created: false } when the mailbox already exists on servers that report
      // ALREADYEXISTS, and throws on those that return a plain NO. Both mean the folder is there, which is
      // the postcondition this method promises, so neither is an error. Anything else propagates.
      try {
        await client.mailboxCreate(folder);
      } catch (error) {
        if (!isAlreadyExistsError(error)) {
          throw error;
        }
      }
    },
```

with a module-level helper next to the other error predicates:

```ts
// ALREADYEXISTS (RFC 5530) is the tagged response code; servers that predate it answer with a NO whose
// text says so. Matching the code first and the text second keeps the string test from being the only
// thing standing between a real failure and a silently swallowed one.
function isAlreadyExistsError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const response_code = "responseCode" in error ? String(error.responseCode) : "";
  if (response_code.toUpperCase() === "ALREADYEXISTS") {
    return true;
  }
  const text = "responseText" in error ? String(error.responseText) : "";
  return /already exists/i.test(text);
}
```

- [ ] **Step 3: Update every other `MailboxProvider` implementation**

Adding a member to the type breaks every fake. Run `bun run tsc` and fix each — test fakes get a
`createFolder` that records the call and resolves.

- [ ] **Step 4: Redefine the invariant in the runbook**

In `docs/runbooks/2026-08-17-mail-sync-schedules.txt`, the read-only invariant section names three greps
and their real output. Update the contract text to:

> Mutating IMAP calls exist only in `server/mail/providers/imap.ts`, reached only through
> `MailboxProvider`'s mutation methods (`moveMessages`, `setLabels`, `createFolder`), called only from
> `server/mail/actions/executor.ts`, `server/mail/actions/undo.ts` and
> `server/mail/filing/resolver.ts`. Exactly one non-read-only `getMailboxLock` exists, inside
> `withWriteLock`.

Re-run each of the three greps, paste the **real** new output, and confirm the write-lock count is still
one. A grep whose output was edited by hand rather than re-run is worse than no grep.

- [ ] **Step 5: Verify and commit**

```bash
bun run tsc && bun test
bunx biome check --fix server/mail/providers/types.ts server/mail/providers/imap.ts
git diff server/mail/providers/imap.ts server/mail/providers/types.ts docs/runbooks/2026-08-17-mail-sync-schedules.txt
git add server/mail/providers/types.ts server/mail/providers/imap.ts docs/runbooks/2026-08-17-mail-sync-schedules.txt && \
  git commit -m "feat: let the provider create a filing folder, and widen the invariant to match" -- \
  server/mail/providers/types.ts server/mail/providers/imap.ts docs/runbooks/2026-08-17-mail-sync-schedules.txt
```

---

### Task 5: The resolver — binding, then render, then create

The only new impure file. Binding wins over rendering; a rendered folder that does not exist is created
once and cached for the rest of the run.

**Files:**
- Create: `server/mail/filing/bindings.ts`
- Create: `server/mail/filing/resolver.ts`
- Create: `server/mail/filing/resolver.test.ts`

**Interfaces:**
- Consumes: `MailboxProvider`, `FolderInfo`; `renderFolderPath`, `findNamespaceRoot`.
- Produces:
  - `type FilingBindingRow = { logical_path: string; folder: string }`
  - `loadFilingBindings(input: { mailbox_id: string }): Promise<FilingBindingRow[]>` (bindings.ts)
  - `createFilingResolver(input: CreateFilingResolverInput): Promise<FilingResolver>`
  - `type FilingResolver = { resolve: (logical_path: string) => Promise<string> }`

- [ ] **Step 1: Write `server/mail/filing/bindings.ts`**

```ts
import { db } from "@server/db/drizzle";
import { filingBinding } from "@server/db/schema";
import { eq } from "drizzle-orm";

export type FilingBindingRow = { logical_path: string; folder: string };

export async function loadFilingBindings(input: { mailbox_id: string }): Promise<FilingBindingRow[]> {
  return db
    .select({ logical_path: filingBinding.logical_path, folder: filingBinding.folder })
    .from(filingBinding)
    .where(eq(filingBinding.mailbox_id, input.mailbox_id));
}
```

- [ ] **Step 2: Write `server/mail/filing/resolver.ts`**

```ts
import { findNamespaceRoot, renderFolderPath } from "@server/mail/filing/render";
import type { FolderInfo, MailboxProvider } from "@server/mail/providers/types";

export type FilingResolver = {
  resolve: (logical_path: string) => Promise<string>;
};

export type CreateFilingResolverInput = {
  provider: MailboxProvider;
  bindings: readonly { logical_path: string; folder: string }[];
  delimiter: string;
};

// Resolution order, and the reason for it:
//
//   1. a binding, which is the operator saying "this logical path already has a home". Returned verbatim
//      and never re-rendered: "INBOX.Finances - Ref" is a folder that exists with 99 messages in it, and
//      re-deriving it from segments would produce "INBOX.Finances - Ref" only by luck.
//   2. otherwise render from the logical segments with this server's delimiter and namespace.
//   3. create it if the server did not already list it.
//
// The folder list is read once per run, and every resolution is memoised — filing a batch of 400
// messages into one client folder issues at most one CREATE, and re-filing into a folder created earlier
// in the same run issues none.
export async function createFilingResolver(input: CreateFilingResolverInput): Promise<FilingResolver> {
  const folders: FolderInfo[] = await input.provider.listFolders();
  const namespace_root = findNamespaceRoot(folders, input.delimiter);
  const existing = new Set(folders.map((folder) => folder.path));
  const bound = new Map(input.bindings.map((binding) => [binding.logical_path, binding.folder]));
  const resolved = new Map<string, string>();

  // A binding matches a logical path EXACTLY. A sub-path does not inherit its parent's binding, on
  // purpose: `Finances` is bound to `INBOX.Finances - Ref` on felix@tellmann.co.za, and letting
  // `Finances/Tax` inherit it would have to invent `INBOX.Finances - Ref.Tax` from a name the operator
  // never wrote. Longest-prefix matching would also give every binding an unbounded, invisible blast
  // radius — re-parenting one path would silently move mail filed under all of its children. An unbound
  // sub-path renders and is created like any other, which is visible and correctable.
  return {
    resolve: async (logical_path: string): Promise<string> => {
      const cached = resolved.get(logical_path);
      if (cached !== undefined) {
        return cached;
      }

      const binding = bound.get(logical_path);
      if (binding !== undefined) {
        // Not created and not checked for existence: a binding names a folder the operator says is
        // already there, and creating it would be this module inventing a folder from a name it was
        // handed. If it is missing, the move fails loudly against the real server, which is the correct
        // place for that to surface.
        resolved.set(logical_path, binding);
        return binding;
      }

      const folder = renderFolderPath({ logical_path, delimiter: input.delimiter, namespace_root });
      if (!existing.has(folder)) {
        await input.provider.createFolder(folder);
        existing.add(folder);
      }
      resolved.set(logical_path, folder);
      return folder;
    },
  };
}
```

- [ ] **Step 3: Write `server/mail/filing/resolver.test.ts`**

Over a fake provider that records `createFolder` calls. Assert:
- a bound path returns the bound folder verbatim and issues **no** `createFolder`
- an unbound path renders and creates once
- resolving the same path twice issues exactly one `createFolder`
- an unbound path that the server already lists issues **no** `createFolder`
- `listFolders` is called exactly once for the resolver's whole lifetime

- [ ] **Step 4: Verify and commit**

```bash
bun test server/mail/filing/ && bun run tsc
bunx biome check --fix server/mail/filing/bindings.ts server/mail/filing/resolver.ts server/mail/filing/resolver.test.ts
git add server/mail/filing/bindings.ts server/mail/filing/resolver.ts server/mail/filing/resolver.test.ts && \
  git commit -m "feat: resolve a logical filing path to a real folder, creating it once" -- \
  server/mail/filing/bindings.ts server/mail/filing/resolver.ts server/mail/filing/resolver.test.ts
```

---

### Task 6: `planFor("file")` on both flavours

The task the whole phase exists for. `kinds.ts` currently returns `{ outcome: "deferred" }` for `file`;
replace that with a real plan, and keep the module pure — the folder arrives through `PlanContext`.

**Files:**
- Modify: `server/mail/actions/kinds.ts`
- Modify: `server/mail/actions/kinds.test.ts`

**Interfaces:**
- Produces: `PlanContext` gains `file_folder: string | null`; `FILE_KIND` is added;
  `FILE_DEFERRED_REASON` is deleted.

- [ ] **Step 1: Extend `PlanContext`**

```ts
export type PlanContext = {
  source_folder: string;
  archive_folder: string | null;
  trash_folder: string | null;
  // The destination for `file`, already resolved to a real folder on this server by
  // server/mail/filing/resolver.ts. Null carries the same meaning the other two do: the caller could not
  // name it, so planFor refuses rather than guessing — this module never learns what a client is.
  file_folder: string | null;
};
```

- [ ] **Step 2: Replace the deferral with a plan**

Delete `FILE_DEFERRED_REASON` and its export, and replace the `if (kind === "file")` branch:

```ts
  // §6: filing means the message leaves the inbox and lands in its destination. On a generic server a
  // move out of the source folder does both at once.
  //
  // On Gmail it must NOT be a move. The canonical folder is [Gmail]/All Mail, which a message cannot
  // meaningfully be moved out of, and applyToState models a Gmail move as a label rewrite that discards
  // every user label — so a move would file the message by destroying the labels the operator filed it
  // under. Adding the destination label and dropping \Inbox is the same semantic with a stable UID,
  // which matters because `message` rows and undo are keyed on folder plus UID.
  //
  // The inverse needs no new code: inverseOf's set_labels branch computes
  // add_labels = mutation.remove_labels ∩ original and remove_labels = mutation.add_labels \ original,
  // which removes the destination label and restores \Inbox exactly.
  if (kind === "file" && flavor === "gmail") {
    return {
      outcome: "planned",
      kind,
      flavor,
      mutation: {
        verb: "set_labels",
        add_labels: [requireTargetFolder(context.file_folder, kind, "filing destination")],
        remove_labels: [GMAIL_INBOX_LABEL],
      },
    };
  }

  if (kind === "file") {
    return {
      outcome: "planned",
      kind,
      flavor,
      mutation: {
        verb: "move",
        source_folder: context.source_folder,
        target_folder: requireTargetFolder(context.file_folder, kind, "filing destination"),
      },
    };
  }
```

`DeferredAction` and `ActionPlan` stay in the type — the executor still defers filing rows the gate
queues, and Phase 8 will need the shape.

Also export the kind as a constant, so Task 9's `WHERE kind = 'file'` guard and this module cannot
drift apart:

```ts
// The one spelling of the filing kind. Task 9's transition out of `deferred` is guarded on it, and a
// literal in that WHERE clause is exactly the two-spellings shape this module exists to prevent.
export const FILE_KIND = "file" as const satisfies ExecutableActionKind;
```

- [ ] **Step 3: Extend `kinds.test.ts`**

Add, alongside the existing archive and trash cases:
- generic `file` plans a move from the source folder to `file_folder`
- gmail `file` plans `set_labels` adding `file_folder` and removing `\Inbox`, and **never** a move
- `planFor("file", …, { file_folder: null })` throws
- **round trip, both flavours:** `applyToState(mutation, from)` then applying every mutation from
  `inverseOf(plan, from)` returns a state equal to `from`. This is the test that would have caught the
  Phase 4 Gmail-trash label loss; it is the reason filing is defined here and not in the executor.

- [ ] **Step 4: Verify and commit**

```bash
bun test server/mail/actions/ && bun run tsc
bunx biome check --fix server/mail/actions/kinds.ts server/mail/actions/kinds.test.ts
git add server/mail/actions/kinds.ts server/mail/actions/kinds.test.ts && \
  git commit -m "feat: plan a file action as a move, and as a label edit on gmail" -- \
  server/mail/actions/kinds.ts server/mail/actions/kinds.test.ts
```

`bun run tsc` will now fail in `executor.ts` (missing `file_folder`). Task 8 fixes it; leave it failing
and say so in the report, or add `file_folder: null` at the single existing call site as a stopgap and
note that Task 8 replaces it.

---

### Task 7: The shadow runner records the proposed path

`target_path` is server-free — it comes from the policy — so the proposal is written when the decision
is made, not when it is executed. That is also what keeps §8's approval keyed on what the run recorded
rather than on what the policy says today.

**Files:**
- Modify: `server/mail/shadow/run.ts`
- Modify: `server/mail/query/policies.ts` (only if `loadPolicyIndex` drops `client`/`topic`)
- Modify: `server/mail/classify/rules.ts` (only if `Decision` cannot carry the mapping)
- Modify: `server/mail/shadow/run.test.ts`

**Interfaces:**
- Produces: `ShadowActionRow` gains `target_path: string | null`.

- [ ] **Step 1: Carry the mapping to the row builder**

`PolicyRow` already has `client: string | null` and `topic: string | null`, so `loadPolicyIndex` needs no
change. Thread them to `buildShadowActionRow`, which computes the path:

```ts
export function buildShadowActionRow(input: {
  message_id: string;
  mailbox_id: string;
  decision: Decision;
  mapping: PolicyFilingMapping | null;
  run_id: string;
  now: Date;
}): ShadowActionRow {
  return {
    // ... unchanged fields ...
    // The proposal, not the confirmation: §6's destination as the policy names it right now. Null on
    // every kind but `file` — archive and trash take their targets from SPECIAL-USE at execution time,
    // and a path on those rows would be a destination nothing reads.
    target_path: input.decision.action === "file" && input.mapping !== null ? logicalPathFor(input.mapping) : null,
  };
}
```

- [ ] **Step 2: Add it to the upsert's SET clause**

`writeShadowBatch`'s `onDuplicateKeyUpdate` carries a long comment about why `status` is absent. **Read
that comment before editing this clause** — a fix in this exact SET clause is where Phase 4 hid a
data-loss bug for two review rounds. Add one line, change nothing else:

```ts
        target_path: sql`VALUES(\`targetPath\`)`,
```

Safe for the same reason `source` and `sender_policy_id` are: it is part of the proposal, and a re-run
of the same run id should carry the current mapping forward. It is **not** safe to add `status` here.

- [ ] **Step 3: Extend `server/mail/shadow/run.test.ts`**

- a `file` decision from a policy with a client writes `target_path = "Clients/<client>"`
- a `file` decision from a policy with neither axis writes `target_path = null`
- an `archive` decision writes `target_path = null` **even when the policy has a client**

- [ ] **Step 4: Verify and commit**

```bash
bun test server/mail/shadow/ && bun run tsc
bunx biome check --fix server/mail/shadow/run.ts server/mail/shadow/run.test.ts
git add server/mail/shadow/run.ts server/mail/shadow/run.test.ts && \
  git commit -m "feat: record the proposed filing path when the decision is made" -- \
  server/mail/shadow/run.ts server/mail/shadow/run.test.ts
```

---

### Task 8: The executor files, or queues

Where the pure pieces meet the server. The plan loop currently builds every plan synchronously; filing
needs a folder that may have to be created, so the loop becomes two passes with one round of resolution
between them. Do not make it `await` per row — a batch of 400 messages into one client folder must issue
one CREATE, not 400 sequential resolutions.

**Files:**
- Modify: `server/mail/actions/executor.ts`
- Modify: `server/mail/actions/journal.ts`
- Modify: `server/mail/actions/executor.test.ts`
- Modify: `server/mail/actions/undo.ts` (step 3b)
- Modify: `server/mail/actions/undo.test.ts`
- Modify: `server/orpc/mail.ts` (`applyPending` passes the delimiter)

**Interfaces:**
- Consumes: `filingDecisionFor` (Task 1), `createFilingResolver` (Task 5), `PlanContext.file_folder`
  (Task 6), `Action.targetPath` (Task 2).
- Produces: `PendingActionRow` gains three fields; `ActionJournal` gains `loadFilingBindings`;
  `ExecuteActionsInput` gains `hierarchy_delimiter`.

- [ ] **Step 1: Widen `PendingActionRow` and `loadPendingActions`**

```ts
export type PendingActionRow = {
  action_id: string;
  message_id: string;
  kind: ExecutableActionKind;
  run_id: string;
  folder: string;
  uid: number;
  // The three inputs the filing gate needs, carried on the row rather than fetched per message: the
  // proposal (Action.targetPath), the scope of the policy that made it, and the message's DKIM state.
  // Joined in loadPendingActions so the gate stays one pure function over data the executor already has.
  target_path: string | null;
  policy_scope: PolicyScope | null;
  dkim_aligned: boolean | null;
};
```

In `journal.ts`, `loadPendingActions` gains a `leftJoin` to `senderPolicy` on `action.sender_policy_id`
(selecting `scope`) — the existing join to `message` already supplies `dkim_aligned`. Left joins, not
inner: a row whose policy was deleted must still be loadable and must still be reportable.

Add to the `ActionJournal` port, next to the other loaders:

```ts
  // Behind the port for the same reason every other read is: a test that reached a real implementation
  // would open a connection to the production database.
  loadFilingBindings: (input: { mailbox_id: string }) => Promise<FilingBindingRow[]>;
```

- [ ] **Step 2: Split the plan loop into two passes**

Replace the single loop in `executeActions`. Pass one classifies every row and collects the distinct
logical paths; the resolution round runs once; pass two builds the plans.

```ts
  const folders = await resolveActionFolders(input.provider);

  type ClassifiedRow = { row: PendingActionRow; logical_path: string | null };
  const classified: ClassifiedRow[] = [];
  const deferred: DeferredEntry[] = [];
  const unplannable: FailedEntry[] = [];
  const wanted_paths = new Set<string>();

  for (const row of rows) {
    if (row.kind !== "file") {
      classified.push({ row, logical_path: null });
      continue;
    }

    const decision = filingDecisionFor({
      logical_path: row.target_path,
      policy_scope: row.policy_scope,
      dkim_aligned: row.dkim_aligned,
    });
    if (decision.outcome === "queue") {
      // §6's filing queue: kind `file` at status `deferred`, with the reason in `error`. Nothing was sent
      // to the mailbox, and status.ts already reads `error` on a deferred row as an explanation rather
      // than a failure. Resolution moves the row to `pending` and it re-enters this function unchanged.
      deferred.push({ action_id: row.action_id, reason: `${decision.reason}: ${decision.detail}` });
      continue;
    }

    wanted_paths.add(decision.logical_path);
    classified.push({ row, logical_path: decision.logical_path });
  }

  // One resolution round for the distinct paths, before any plan is built. A path that cannot be resolved
  // queues every row wanting it rather than failing them: nothing was mutated, the operator can bind the
  // path to an existing folder, and the row is then retryable — which is what `deferred` means and
  // `failed` does not.
  const resolved_folders = new Map<string, string>();
  if (wanted_paths.size > 0) {
    const resolver = await createFilingResolver({
      provider: input.provider,
      bindings: await input.journal.loadFilingBindings({ mailbox_id: input.mailbox_id }),
      delimiter: input.hierarchy_delimiter,
    });
    for (const logical_path of wanted_paths) {
      try {
        resolved_folders.set(logical_path, await resolver.resolve(logical_path));
      } catch (error) {
        const detail = toRecordedError(error);
        for (const entry of classified) {
          if (entry.logical_path === logical_path) {
            deferred.push({ action_id: entry.row.action_id, reason: `unresolvable_folder: ${detail}` });
          }
        }
      }
    }
  }

  const groups = new Map<string, ExecutionGroup>();

  for (const entry of classified) {
    const { row } = entry;
    if (entry.logical_path !== null && !resolved_folders.has(entry.logical_path)) {
      continue; // already queued by the resolution round above
    }

    let plan: ActionPlan;
    try {
      plan = planFor(row.kind, input.flavor, {
        source_folder: row.folder,
        archive_folder: folders.archive_folder,
        trash_folder: folders.trash_folder,
        file_folder: entry.logical_path === null ? null : (resolved_folders.get(entry.logical_path) ?? null),
      });
    } catch (error) {
      unplannable.push({ action_id: row.action_id, error: toRecordedError(error) });
      continue;
    }

    if (plan.outcome === "deferred") {
      deferred.push({ action_id: row.action_id, reason: plan.reason });
      continue;
    }

    const key = groupKeyFor(row.folder, plan.mutation);
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, { folder: row.folder, mutation: plan.mutation, rows: [row] });
      continue;
    }
    group.rows.push(row);
  }
```

The existing `markDeferred` / `markFailed` block below this stays exactly as it is.

Note that `groupKeyFor` already handles filing correctly with no change: two rows headed for different
folders produce different keys because `target_folder` is part of the move key and the label set is part
of the label key.

- [ ] **Step 3: Thread the delimiter through**

`ExecuteActionsInput` gains `hierarchy_delimiter: string`. In `server/orpc/mail.ts`, `applyPending`
already loads the mailbox row to get its flavour — read `hierarchyDelimiter` from the same row and pass
it. A mailbox with an empty delimiter fails at `renderFolderPath`, which is the correct place: it means
the mailbox was never synced.

- [ ] **Step 3b: Undo has to resolve the destination too**

`server/mail/actions/undo.ts:120` rebuilds the plan with `planFor` and inverts it, so an `applied` `file`
row needs a real `file_folder` there as well — Task 6 left a `null` stopgap. Without this, undo of a
filing throws instead of reversing, and undo is the whole trust surface §9 rests on.

- `UndoableActionRow` and `ActionUndoLookup` gain `target_path: string | null`; both loaders select it.
- `requirePlan` takes the resolved folder as a parameter rather than resolving inside itself — it is
  pure today and must stay that way.
- The undo entry points build a resolver exactly as the executor does and resolve `row.target_path`
  before calling `requirePlan`.

Re-resolving rather than reading the destination back out of `to_state_json` is deliberate, and safe for
a reason already in this file: `resumeIndexFor` compares every projected state against the recorded
`to_state` and refuses when none matches. A binding edited since the action would therefore produce a
plan that matches nothing and a refusal, never a move out of a folder the message was never in — the
same protection the comment above `resumeIndexFor` already claims for a renamed `\Archive` folder.
Deriving the folder from the recorded states instead would mean a second piece of code that knows what
the `file` mutation does to a state, which is the duplication `kinds.ts` exists to prevent.

A `file` row that is `applied` with `target_path IS NULL` cannot be planned. That is data that should not
exist; let the existing "no executable plan" throw report it rather than inventing a destination.

- [ ] **Step 4: Extend `server/mail/actions/executor.test.ts`**

- a generic `file` row with a resolvable path issues one move to the resolved folder and is `applied`
- a gmail `file` row issues `set_labels`, **never** `moveMessages`
- a domain-scoped `file` row with `dkim_aligned: null` is `deferred` with a `dkim_unaligned` reason and
  **nothing is sent to the provider** — assert the fake recorded zero mutations
- a `file` row with `target_path: null` is `deferred` with `no_mapping`
- **undo of a filed message**, both flavours: the inverse moves it back to `from_state.folder` (generic)
  or removes the destination label and restores `\Inbox` (gmail), and an undo whose resolved folder no
  longer matches the recorded `to_state` REFUSES rather than mutating
- a resolver that throws queues **every** row wanting that path, and rows wanting other paths still file
- **two rows, same path, one CREATE** — the batching property this task exists to preserve
- archive and trash rows are unaffected by all of the above

- [ ] **Step 5: Verify and commit**

```bash
bun test && bun run tsc
bunx biome check --fix server/mail/actions/executor.ts server/mail/actions/journal.ts server/mail/actions/executor.test.ts server/orpc/mail.ts
git diff server/orpc/mail.ts
git add server/mail/actions/executor.ts server/mail/actions/journal.ts server/mail/actions/executor.test.ts server/orpc/mail.ts && \
  git commit -m "feat: file a message to its resolved folder, or queue it with a reason" -- \
  server/mail/actions/executor.ts server/mail/actions/journal.ts server/mail/actions/executor.test.ts server/orpc/mail.ts
```

---

### Task 9: The path out of `deferred`

`deferred` is terminal today: `promoteShadowActions` is guarded `WHERE status = 'shadow'` and
`loadPendingActions` selects only `pending`, so nothing can move a row forward. Every `file` row Phase 4
parked is stranded, and every row Task 8 queues would be too.

**Files:**
- Modify: `server/mail/actions/journal.ts`
- Modify: `server/mail/actions/executor.ts` (the port type)
- Modify: `server/mail/actions/promote.ts`
- Modify: `server/orpc/mail.ts`
- Modify: `server/mail/actions/promote.test.ts`

**Interfaces:**
- Produces: `resolveFilingActions(entries: FilingResolutionEntry[]): Promise<void>` on the journal;
  `resolveFiling` ORPC procedure.

- [ ] **Step 1: Add the entry type and the port method**

Follow the shape that made `PromotedEntry` durable — the entry carries no `status` field, so only one
value can ever be written:

```ts
// Carries no `status`: journal.ts writes `pending` and nothing else can be expressed here. That is the
// same shape PromotedEntry uses, and for the same reason — a status the caller could name is a status
// the caller could get wrong.
export type FilingResolutionEntry = { action_id: string; target_path: string };
```

```ts
  // Moves ONE deferred filing row to `pending` with the operator's confirmed destination. Guarded in the
  // UPDATE's WHERE clause on both status and kind, not in the caller: a check the caller performs is a
  // check a second caller can skip, and this is the only transition that can un-defer a row.
  resolveFilingActions: (entries: FilingResolutionEntry[]) => Promise<void>;
```

- [ ] **Step 2: Implement it in `journal.ts`**

```ts
  resolveFilingActions: async (entries) => {
    for (const entry of entries) {
      await db
        .update(action)
        .set({ status: PENDING_STATUS, target_path: entry.target_path, error: null, updatedAt: new Date() })
        .where(and(eq(action.id, entry.action_id), eq(action.status, DEFERRED_STATUS), eq(action.kind, FILE_KIND)));
    }
  },
```

`error: null` is deliberate: the queue reason described why the row could not proceed, and it has just
proceeded. Leaving it would make a `pending` row carry an explanation that is no longer true, and
`status.ts` reads `error` on a non-failed row as an explanation rather than a failure.

The `kind` guard matters as much as the status guard: without it this method can un-defer an
`auto_trash` row, and §1.7 keeps destruction behind a policy a human created.

- [ ] **Step 3: Expose it over ORPC**

In `server/orpc/mail.ts`, alongside `approveDecision`, following the existing `requireEnabledMailbox`
pattern and the same input conventions — every field `.default()`ed, none `.optional()`, limits
`.max(200)`:

```ts
  resolveFiling: authed
    .input(
      z.object({
        mailbox_id: z.string().min(1),
        action_id: z.string().min(1),
        target_path: z.string().min(1).max(191),
      }),
    )
    .handler(async ({ input }) => { /* requireEnabledMailbox, then resolveFilingActions */ }),
```

Reject a `target_path` whose segments do not survive `logicalPathFor`-style normalization, so the queue
UI cannot write a path the resolver will then refuse.

- [ ] **Step 4: The Phase 4 guard that Phase 5 retires**

Phase 4 deferred a server-side check that `approveDecision` refuses `file` policies; the UI enforces it
in `src/routes/admin/shadow.tsx` only. **With filing real, that guard is retired rather than
implemented** — approving a `file` decision is now a legitimate operation, and a row whose mapping is
missing is queued by Task 8 rather than refused at approval. Delete the UI-side refusal in the same
commit so the two stop disagreeing, and say so in the report.

- [ ] **Step 5: Test**

- a `deferred` `file` row moves to `pending` and its `error` is cleared
- a `deferred` `auto_trash` row is **not** touched
- an `applied` row is **not** touched
- resolving a row twice is idempotent — the second call matches nothing

- [ ] **Step 6: Verify and commit**

```bash
bun test && bun run tsc
bunx biome check --fix server/mail/actions/journal.ts server/mail/actions/executor.ts server/mail/actions/promote.ts server/orpc/mail.ts
git diff server/orpc/mail.ts src/routes/admin/shadow.tsx
git add server/mail/actions/journal.ts server/mail/actions/executor.ts server/orpc/mail.ts server/mail/actions/promote.test.ts src/routes/admin/shadow.tsx && \
  git commit -m "feat: let a queued filing row be resolved back into the executor" -- \
  server/mail/actions/journal.ts server/mail/actions/executor.ts server/orpc/mail.ts server/mail/actions/promote.test.ts src/routes/admin/shadow.tsx
```

---

### Task 10: The filing queue surface

§9 calls the action journal the trust surface. The filing queue is the half of it that asks the operator
for a decision rather than reporting one.

**Files:**
- Create: `server/mail/query/filing.ts`
- Create: `src/routes/admin/filing.tsx`
- Create: `src/routes/admin/-filing-reasons.ts`
- Create: `src/routes/admin/-filing-reasons.test.ts`
- Modify: `server/orpc/mail.ts` (`listFilingQueue`)
- Modify: `src/routes/admin/-ui.tsx` or `src/routes/admin/route.tsx` (nav entry)

**Interfaces:**
- Produces: `listFilingQueue(input: { mailbox_id: string | null; limit: number; offset: number })`

- [ ] **Step 1: Write `server/mail/query/filing.ts`**

The queue is a query, not a table: `kind = 'file' AND status = 'deferred'`, joined to `message` for the
subject, sender and date, and to `mailbox` for the label. Reuse `buildMessageLocation` from
`server/mail/query/deep-link.ts` so a queued row deep-links into the real mail client exactly as the
shadow report and the journal already do. Follow `server/mail/query/shadow.ts` for shape: a `total`
alongside the rows, every predicate applied to both, and all of it before `LIMIT`.

Each row carries: `action_id`, `message_id`, `subject`, `from_address`, `internal_date`,
`mailbox_label`, `target_path` (the proposal, possibly null), `reason` and `detail` parsed from `error`,
and `location`.

- [ ] **Step 2: Write `src/routes/admin/-filing-reasons.ts`**

The queue reasons live in `server/mail/filing/paths.ts`, which the route cannot import — it would pull
the database handle into the client bundle. This is the same situation `-shadow-kinds.ts` is in, and it
takes the same answer: a small private module holding the route's copy, plus a test that pins it against
the server-side tuple. Copy the pattern from `-shadow-kinds.ts` and `-shadow-kinds.test.ts` exactly,
including the mutation check that proves the pin actually bites.

Each reason maps to a label and to what the operator can do about it:

| reason | label | operator action |
|---|---|---|
| `no_mapping` | Needs a client or topic | set one on the sender policy, then resolve |
| `dkim_unaligned` | Sender not verified | confirm the destination to file anyway |
| `ambiguous_client` | Thread spans two clients | pick one |
| `unresolvable_folder` | Folder could not be created | bind the path to an existing folder |

- [ ] **Step 3: Write `src/routes/admin/filing.tsx`**

Follow `src/routes/admin/shadow.tsx` and `journal.tsx` for structure, loader shape and styling. Rows
show the message, the proposed path (or its absence), the reason, and a control that calls
`resolveFiling` with a confirmed path. Filter and pagination state goes in URL params, not a store.

A row whose `target_path` is null needs the operator to type one; a row with a path needs only
confirmation. Both call the same procedure.

- [ ] **Step 4: Verify and commit**

```bash
bun test && bun run tsc && bun run build
bunx biome check --fix server/mail/query/filing.ts src/routes/admin/filing.tsx src/routes/admin/-filing-reasons.ts src/routes/admin/-filing-reasons.test.ts server/orpc/mail.ts
```

`bun run build` regenerates `src/routeTree.gen.ts` for the new route. It is gitignored — do not add it.

---

### Task 11: Seed the mapping and the bindings

Filing cannot propose a destination for any of the 103 policies today: all have `client IS NULL` and
`topic IS NULL`. This ships the mapping as a reviewable script, the way the policies themselves shipped.

**Files:**
- Create: `scripts/seed-filing-mapping.ts`
- Reference (read-only): `tmp/2026-08-18-mail-triage-run-1.md`

- [ ] **Step 1: Write the script**

Model it on `scripts/seed-sender-policies.ts` exactly: `--apply` performs the write, without it the run
is a dry run that writes nothing and prints what it would do. Two sections.

**Mapping** — sets `client` and `topic` on existing `file` policies. From the triage doc.

**The left column below is a LOGICAL PATH, not a column value.** Storing it verbatim is wrong in both
directions: `client = "Clients/Listify"` is rejected by Task 1's Zod refinement, and
`topic = "Clients/Listify"` silently yields `Clients/Clients/Listify`. The rule:

- a `Clients/<name>` row → `client = "<name>"`, `topic = null`
- every other row → `client = null`, `topic = "<the path verbatim>"`

so that `logicalPathFor` returns exactly the left column. Assert that in the script: for every seeded
policy, `logicalPathFor({ client, topic })` must equal the intended path, and the dry run should print
the derived path rather than the columns.

| logical path | senders |
|---|---|
| `Clients/Listify` | `no-reply@listifyregistry.com`, `noreply@shopify.com`, `partners@shopify.com`, `app-audits@shopify.zendesk.com`, `no-reply@lunalemon.dev` |
| `Clients/KidsLiving` | `support@bobgo.co.za` |
| `Ops/Shopify` | `mailer@shopify.com`, `store+26179660@t.shopifyemail.com` |
| `Finances` | the sixteen Group E senders — FNB ×3, PayPal, bobpay, Google payments ×2, takealot, stripe.com, sendgrid, Shopify billing, Figma ×2, Apple, xneelo billing, Anthropic — **plus all six** of `seed-sender-policies.ts`'s Group H tax/banking/legal records: `noreply@sars.gov.za`, `donotreply@usvisa-info.com`, `no-reply@carta.com`, `no-reply@deel.support`, `noreply@dkb.de`, `noreply@wise.com` |
| `Personal/Tennis` | `no-reply@booknplay.co.za` |
| `Personal/Restaurants` | `reservations@mailer.dineplan.com` |
| `Personal/Medical` | `dailyclaims@discovery.co.za` |
| `Personal/Travel` | booking, uber, deutschebahn, oebb, easyjet, amadeus, flyairlink, webtickets |

Everything above uses the `topic` axis except the two `Clients/` groups, which use `client`. A sender in
the `file` set that this table does not name keeps `client` and `topic` null, and its messages queue as
`no_mapping` — which is correct and visible, not a silent gap.

`contact-form@tellmann.co.za` stays unmapped on purpose. It is inbound leads from the operator's own
site, and the triage doc calls it "worth a look before filing" — the one `file` policy whose destination
is a judgement the operator has not made yet. It queues as `no_mapping`, which is the visible, correct
outcome for an undecided mapping.

**No `Finances/Tax` split.** Bindings match a logical path exactly and a sub-path does NOT inherit its
parent's binding, so with `Finances` bound to `INBOX.Finances - Ref`, a `Finances/Tax` path would render
as `INBOX.Finances.Tax` — a folder under a different parent, because `INBOX.Finances - Ref` and
`INBOX.Finances` are different mailboxes. §6 splits by topic "only where volume earns it", and two
senders do not, so the tax senders go to `Finances` with the rest of the records.

**Bindings** — `FilingBinding` rows for `felix@tellmann.co.za` only, pointing logical paths at the
thirteen folders that already exist:

```
Clients/KidsLiving         -> INBOX.KidsLiving              (303 messages)
Clients/Broadwayjewellers  -> INBOX.Broadwayjewellers       (77)
Clients/VW                 -> INBOX.VW                      (71)
Clients/Moritz             -> INBOX.Moritz                  (21)
Finances                   -> INBOX.Finances - Ref          (99)
Ops/Invoices               -> INBOX.Invoices                (19)
Personal/Travel            -> INBOX.Travel                  (10)
Personal                   -> INBOX.Personal                (26)
```

Leave `INBOX.docs`, `INBOX.Tellmann` and `INBOX.Move Knysna - CPT 2020` unbound: no sender policy points
at them, and binding a path nothing files to is a mapping that can only ever be wrong later. Say so in
the script's output rather than omitting them silently.

The three Gmail mailboxes get **no** bindings — they have no user labels at all, so every path renders
and is created on first use.

- [ ] **Step 1b: Refuse to apply against an unmigrated database**

The apply path writes policy mappings first and `FilingBinding` rows second, and nothing in this repo
uses `db.transaction`. So `--apply` before migration `0006` commits all 37 mappings and then throws on
the first binding insert — leaving mappings with NO bindings, which is worse than doing nothing:
`Finances` mapped but unbound makes filing render and CREATE a fresh `INBOX.Finances` instead of using
the operator's `INBOX.Finances - Ref` and its 99 messages, and `INBOX.Clients.KidsLiving` beside the real
`INBOX.KidsLiving` and its 303.

Two changes, both before any write:
- A preflight existence probe for `FilingBinding` — a caught `SELECT 1 … LIMIT 1`, or an
  `information_schema.tables` lookup — that aborts with "run `bun run db:migrate` first" when absent.
- Wrap the whole apply path in one `db.transaction`, as the backstop for every other partial failure.
  This is the first transaction in the repo; that is fine, it is also the first script that writes two
  dependent kinds of row.

- [ ] **Step 2: Dry-run it and report**

```bash
bun --env-file=.env scripts/seed-filing-mapping.ts
```

Expected: the counts it would write, and no database change. **Do not pass `--apply`** — that is a
write, and it is the operator's to run after reading the dry run.

- [ ] **Step 3: Commit**

```bash
git add scripts/seed-filing-mapping.ts && \
  git commit -m "feat: seed the filing mapping and tellmann's legacy folder bindings" -- \
  scripts/seed-filing-mapping.ts
```

---

### Task 12: Runbook, ceremony, and ship

**Files:**
- Modify: `docs/runbooks/2026-08-17-mail-sync-schedules.txt`
- Modify: `docs/plans/active/2026-08-20-email-phase-5-filing.md` (this file → `completed/`)

- [ ] **Step 1: Document the Phase 5 operator sequence**

Add a `PHASE 5` section, in the same voice as the existing `PHASE 4` one. Order is load-bearing and must
be stated as such:

1. `bun run db:migrate` — applies `0005` (Action.mailboxId) **and** `0006` (targetPath, FilingBinding).
2. `bun --env-file=.env scripts/seed-filing-mapping.ts` — dry run, read it.
3. `bun --env-file=.env scripts/seed-filing-mapping.ts --apply`.
4. A fresh shadow pass — `bun --env-file=.env tmp/run-shadow.ts`. Required, not optional: `target_path`
   is written at decision time, so rows minted before step 3 carry no proposal and every one of them
   queues as `no_mapping`.
5. `/admin/shadow` — approve **one** `file` decision, on a sender whose destination is obvious.
6. `/admin/mail` — apply it. **This creates a folder on a real server.** Check the folder appeared where
   expected, with the right name and the right delimiter.
7. Undo it. Check the message went back. Note that undo does **not** remove the created folder — it
   restores the message, and an empty folder is not a mutation worth reversing.
8. Only then approve a batch.

Also record the empirical bounds the way the Phase 4 section does: what was measured, and what was not.

- [ ] **Step 2: Re-run the three invariant greps**

Paste their real output into the runbook. The write-lock count must still be one.

- [ ] **Step 3: Full verification**

```bash
bun run tsc
bun test
bun run build
bunx biome check
```

All four green before the ship commit.

- [ ] **Step 4: Ship**

Per the project's shipping ritual — `git mv` this plan to `docs/plans/completed/`, add the closing
marker, and commit. Move the design spec from `docs/plans/specs/active/` to `completed/` in the same
commit. Always `git mv`, never delete-and-create.

```markdown
**Completed: YYYY-MM-DD**
- Verified: <what actually ran — tsc, biome, build, the test count, the grep sweep>
- Open: <what wasn't checked — the operator ceremony above, live folder creation — silence = confirmed>
```

---

## Self-Review

Run this checklist before dispatching Task 1.

**Spec coverage** — every §6 requirement against a task:

| §6 requirement | task |
|---|---|
| client as primary axis, topic as secondary split | 1 |
| logical paths, rendered with the server's delimiter | 3 |
| folders created on first use | 4, 5 |
| deterministic sender → client assignment in Sender Policy | 1, 11 |
| DKIM gate (as amended: domain-scoped only) | 1, 8 |
| `filing_queue` for gated and ambiguous cases | 8, 10 |
| assignment stored in the flext database | 2, 7 |
| cross-mailbox client view | 2, 7 (the join key); the view itself is not Phase 5 |

**Known gaps, deliberate:** `ambiguous_client` is defined and reachable through resolution but nothing
*produces* it — no thread-level client detection exists yet. It is in the reason set because the queue
UI must render it, and leaving it out would mean a fifth reason appearing later with no home.
Bulk re-filing after a mapping edit is §6's third payoff and is explicitly out of scope.

**Type consistency:** `logicalPathFor` and `filingDecisionFor` (Task 1) are consumed by Tasks 7 and 8;
`renderFolderPath`/`findNamespaceRoot` (Task 3) by Task 5; `createFolder` (Task 4) by Task 5;
`PlanContext.file_folder` (Task 6) by Task 8; `Action.targetPath` (Task 2) by Tasks 7, 8, 9 and 10.

**Ordering:** Task 6 leaves `bun run tsc` failing at the single `planFor` call site until Task 8 lands.
That is the only intentional red gate in the sequence, and Task 6 says so in its own text.

**Task interface conflicts to watch:** Tasks 8 and 9 both edit `server/mail/actions/executor.ts` (the
port type) and `server/orpc/mail.ts`. Task 9 must be dispatched after Task 8, never in parallel.
Tasks 1, 9 and 10 all edit `server/orpc/mail.ts`. Sequential dispatch throughout, as the skill requires.
