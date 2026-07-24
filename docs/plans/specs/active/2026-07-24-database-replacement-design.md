# Database Setup (replacing PlanetScale)

The original PlanetScale free tier is dead. You need a new MySQL-compatible database.

## Current Setup

- **ORM:** Drizzle ORM (`drizzle-orm/mysql2`)
- **Driver:** `mysql2/promise`
- **Schema:** `server/db/schema.ts` (13 tables: Books, Post, Comment, User, Account, Session, etc.)
- **Config:** `drizzle.config.ts`
- **Connection:** `server/db/drizzle.ts` (strips `?sslaccept=strict` from URL, passes `ssl: {}`)

## Option A: Turso (recommended, free tier, serverless)

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
