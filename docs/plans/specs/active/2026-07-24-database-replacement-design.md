# Database Setup (replacing PlanetScale)

The original PlanetScale free tier is dead. You need a new MySQL-compatible database.

## Current Setup

- **ORM:** Drizzle ORM (`drizzle-orm/mysql2`)
- **Driver:** `mysql2/promise`
- **Schema:** `server/db/schema.ts` (13 tables: Books, Post, Comment, User, Account, Session, etc.)
- **Config:** `drizzle.config.ts`
- **Connection:** `server/db/drizzle.ts` (strips `?sslaccept=strict` from URL, passes `ssl: {}`)

## Usage audit (added 2026-07-26) — the schema is mostly dead weight

Before picking a provider, note what actually touches the database. Only **four files** import it:
`server/orpc/books.ts`, `server/auth/credentials.ts`, `server/auth/email.ts`, `server/orpc/context.ts`.

| Table | Status |
| --- | --- |
| `Books` | **Live today.** Four queries total: one `select`, two `insert`, one `votes + 1` update |
| `User`, `Account`, `Session`, `VerificationToken` | **Needed only when `/auth/*` ships** — the UI is still five scaffold stubs, so nothing exercises them yet |
| `Comment`, `Telemetry`, `HabitTracking`, `Food`, `FoodUnit`, `FoodUnitConversion`, `FoodMethod`, `FoodRated`, `Habits` | **Zero live consumers.** Verified by grep across `server/` and `src/` (the one `comment` hit was a CSS token class in `prism.css`) |

Two consequences:

1. **This decision is downstream of the auth decision.** If `/auth/*` ships, you need real user/session
   persistence and a proper hosted database. If it does not, the only thing the database buys you is a
   persistent vote counter on `/books` — everything else on the site is static content in `content/*.tsx`.
2. **A schema port is far cheaper than this document assumed.** Options A and B were weighed against
   "rewriting 13 tables". The real number is **5** (Books + the four auth tables), and the other nine
   should be deleted rather than migrated. That makes Postgres/SQLite genuinely viable instead of costly.

Also worth knowing: `/books` currently renders a **static fallback** (`src/routes/books.tsx:30-55`) whenever
the database is unreachable, which is why the page still works with 87 books and zero votes. That fallback
derives `id` from `isbn10`, which both causes the duplicate-key warnings and means an upvote would send an
ISBN to a mutation matching on the UUID primary key — it would update zero rows and silently fail. Fix that
alongside whichever option is chosen.

## Option A: Turso (free tier, serverless)

Turso is SQLite-based (libSQL), so you'd need to swap `drizzle-orm/mysql2` to `drizzle-orm/libsql`. This means rewriting the schema from MySQL types to SQLite types. More work, but free and fast.

## Option B: Neon Postgres (free tier, serverless)

Similar to Turso — swap to `drizzle-orm/neon-http`. Requires converting MySQL schema to Postgres. Good free tier.

## Option C: PlanetScale Scaler Pro ($39/mo)

Keep everything as-is. Just update `DATABASE_URL` in `.env.local`.

## Option D: Local MySQL (free, easiest migration)

Keep the exact same code, just point to a local MySQL instance.

### Steps

1. **Install MySQL locally** (or use Docker):
   ```bash
   # Docker one-liner
   docker run -d --name flext-mysql -e MYSQL_ROOT_PASSWORD=root -e MYSQL_DATABASE=flext -p 3306:3306 mysql:8
   ```

2. **Update `.env.local`:**
   ```
   DATABASE_URL="mysql://root:root@localhost:3306/flext"
   ```

3. **Update `server/db/drizzle.ts`** — remove PlanetScale-specific config:
   ```ts
   const pool = mysql.createPool({
     uri: process.env.DATABASE_URL ?? "",
     // Remove ssl: {} for local MySQL
   });

   export const db = drizzle(pool, {
     schema: { ...schema, ...relations },
     // Remove mode: "planetscale" for standard MySQL
   });
   ```

4. **Push the schema to the database:**
   ```bash
   bunx drizzle-kit push
   ```

5. **Seed the books data:**
   Use the ORPC `books.addMany` procedure or write a quick seed script:
   ```ts
   // seed.ts
   import { BOOKS } from "./content/books";
   import { db } from "./server/db/drizzle";
   import { books } from "./server/db/schema";

   await db.insert(books).values(
     BOOKS.filter((b) => b.read).map((b) => ({
       name: b.name,
       image: b.image,
       url: b.url,
       author: b.author,
       author_url: b.author_url,
       asin: b.asin || null,
       isbn10: b.isbn10 || null,
       read: b.read,
       published: true,
       rating: b.rating ?? 0,
       votes: 0,
       updatedAt: new Date(),
     }))
   );
   ```
   Run: `bun run seed.ts`

6. **Verify:** Restart the dev server and visit `/books` — should load from the DB now.

## Option E: self-hosted MySQL on the existing Hetzner/Coolify server (added 2026-07-26)

**This is the best fit and supersedes the recommendation below.** The server already exists, so there is
no new bill, and — unlike Turso or Neon — **no schema port at all**: `drizzle-orm/mysql2` and every table
definition stay exactly as they are. Coolify ships a one-click MySQL service with volume-backed storage.

Two code changes are needed in `server/db/drizzle.ts`, both already described under Option D: drop
`mode: "planetscale"` and replace the PlanetScale `ssl: {}` handling with the server's own TLS setup —
pass the CA explicitly, e.g. `ssl: { ca: readFileSync(process.env.DATABASE_CA_PATH) }`. Do **not** reach
for `rejectUnauthorized: false`; that disables certificate verification and exposes the connection to
interception. Either add the server's CA to the trust store or issue a proper certificate (Coolify can
provision one via Let's Encrypt).

What to weigh against the managed options:

- **Backups are now yours.** Coolify can schedule dumps to S3-compatible storage; set that up on day one,
  because nothing else will.
- **Reachability.** If the site is deployed somewhere other than that Hetzner box, the database must be
  exposed over the network — put it behind the private network or a firewall allowlist rather than a
  public port, and keep TLS on.
- **It is a machine you maintain** (updates, disk, restarts). That is the real cost, not money.

### Can the original PlanetScale database be reconnected?

**Almost certainly not.** PlanetScale deleted free-tier databases when the tier ended; the branch and its
data are gone unless the account was upgraded in time. Two things to check before assuming loss:

1. Log into PlanetScale — if the database still lists as hibernated/archived rather than deleted, a paid
   plan may restore it long enough to export.
2. Look for an existing dump (`.sql`) locally or in any backup.

If a dump exists, restoring into self-hosted MySQL is a straight `mysql < dump.sql` and everything works
unchanged. If not, `/books` can be re-seeded from `content/books.tsx` (the seed snippet under Option D
does exactly this), and the auth tables start empty — which costs nothing, since `/auth/*` has no users yet.

Note the nine unused tables were deleted from `server/db/schema.ts` on 2026-07-26. A restored dump would
still contain them; drop them manually if the data is not wanted.

## Recommendation (2026-07-26, superseded by Option E above)

**Decide auth first, because it decides this.**

- **If `/auth/*` ships:** take **Option B (Neon Postgres)**. Free, serverless, no cold-start pain on a
  personal site, and Drizzle's Postgres support is the best-trodden path. Port only the five live tables
  and drop the other nine. Turso is also fine, but SQLite buys nothing here and Postgres is the safer
  long-term default.
- **If `/auth/*` is not shipping soon:** don't take a hosted database at all. One list of books and a
  vote counter does not justify it. Either keep the static content as the source of truth and remove the
  vote feature, or keep the database code and run **Option D (local MySQL via Docker)** so `/books`
  works in development without a monthly bill or a production dependency.
- **Avoid Option C ($39/mo)** unless the paid tier is wanted for reasons beyond this site — it is the
  most expensive way to keep nine unused tables alive.

Whichever path is chosen, delete the nine dead tables from `server/db/schema.ts` first. That shrinks the
migration, the generated SQL, and the mental model all at once.

**Not yet done and needs your say-so:** no schema changes, migrations, seeds, or writes of any kind have
been run. `bun run db:generate` output would be surfaced for you to apply.

## Key Files

| File | Purpose |
|------|---------|
| `server/db/schema.ts` | All table definitions (Drizzle MySQL) |
| `server/db/drizzle.ts` | DB connection pool + Drizzle instance |
| `server/db/relations.ts` | Table relations |
| `drizzle.config.ts` | Drizzle Kit config (migrations, push) |
| `env.ts` | Zod validation for env vars |
| `.env.local` | Actual env values (DATABASE_URL) |
| `content/books.tsx` | Static book data (used as fallback + seed source) |
