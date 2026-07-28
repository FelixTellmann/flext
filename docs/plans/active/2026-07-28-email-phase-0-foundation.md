# Email Suite Phase 0: Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An auth-gated `/admin` route group running against Coolify MySQL, with a tested AES-256-GCM credential store ready for mailbox passwords.

**Architecture:** The existing `server/auth/` modules already work correctly but have zero consumers — no cookie is set, no session is read, no route is guarded. This phase wires them up rather than rewriting them, and deliberately leaves the OAuth surface untouched (§1.8 of the spec specifies one account with signup disabled, so OAuth, magic links, and the `Session` table are all out of scope). Route protection is a `beforeLoad` on an `/admin` layout route calling a server function, which avoids converting `__root.tsx` to `createRootRouteWithContext` and keeps the diff small.

**Tech Stack:** TanStack Start, Drizzle ORM (`mysql2`), ORPC, `jose` (already present), `bcrypt` (already present), Node `crypto` (built in), Bun test runner (built in).

**Spec:** `docs/plans/specs/active/2026-07-27-email-management-design.md` §1.8.

## Global Constraints

- **Never run `bun run dev`** or any watch/long-running server. Verify with `bun run tsc` and `bunx biome check --fix <file>`.
- **Never run `bun run db:push`, `db:migrate`, or raw DML.** Phase 0 adds no tables, so this should not arise; if it does, generate SQL and surface it.
- TypeScript strict + `verbatimModuleSyntax` — type-only imports must use `import type`. No `any`; use `unknown` plus narrowing.
- Named exports only, never `export default`.
- `type` over `interface`. Functions/factories over classes. Two `if` blocks over `if/else` unless trivial.
- Biome: line width 140, double quotes, spaces. Run `bunx biome check --fix <file>` after editing any file.
- Comments: default to none. Write one only for a non-obvious *why* — a gotcha and its cause, an invariant, a spec reference. Never narrate the edit.
- `cn()` directly in the JSX prop for dynamic classes; never template literals. Check `tailwind.config.mjs` for an existing token before writing any sized/coloured class.
- Git: add specific files by name, never `git add -A` / `git add .`. No `Co-Authored-By` trailers.
- Path aliases: `~/*` → `src/*`, `@server/*` → `server/*`, `utils/*`, `content/*`, `types/*`.

## Environment variables this phase introduces

Add to the Coolify service before deploying. `MAIL_ENCRYPTION_KEY` must be backed up **separately from the database** — a dump without it restores nothing usable.

| Variable | Value |
|---|---|
| `DATABASE_URL` | `mysql://user:pass@host:3306/flext` — the Coolify MySQL service |
| `DATABASE_CA_PATH` | Optional. Path to the CA PEM if MySQL TLS terminates outside the Docker network. |
| `MAIL_ENCRYPTION_KEY` | 64 hex characters (32 bytes). Generate with `openssl rand -hex 32`. |
| `ADMIN_EMAIL` | The single account permitted to sign in. |
| `JWT_SECRET` | Already in use by `server/auth/jwt.ts`. Must be ≥ 32 characters. |

---

### Task 1: Server env validation and Coolify MySQL connection

`env.ts` at the repo root validates ~40 keys and calls `process.exit(1)` on failure — but **nothing imports it**, so it enforces nothing today. It also cannot safely be imported from a module that might reach a client bundle. This task adds a server-only, lazily-validated env module instead, and repoints Drizzle from PlanetScale to Coolify MySQL.

**Files:**
- Create: `server/env.ts`
- Modify: `server/db/drizzle.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `serverEnv(): ServerEnv` where `ServerEnv = { DATABASE_URL: string; DATABASE_CA_PATH?: string; JWT_SECRET: string; MAIL_ENCRYPTION_KEY: string; ADMIN_EMAIL: string }`.

- [ ] **Step 1: Create `server/env.ts`**

```ts
import { z } from "zod";

const server_env_schema = z.object({
  DATABASE_URL: z.string().min(1),
  DATABASE_CA_PATH: z.string().optional(),
  JWT_SECRET: z.string().min(32),
  MAIL_ENCRYPTION_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/, "must be 64 hex characters (32 bytes)"),
  ADMIN_EMAIL: z.string().email(),
});

export type ServerEnv = z.infer<typeof server_env_schema>;

let cached: ServerEnv | null = null;

// Validation is lazy so this module stays safe to import from anything that might
// end up in a client bundle: the throw can only fire on first read, which never
// happens in the browser. The root env.ts calls process.exit(1) at import time,
// which is why it cannot be used here.
export function serverEnv(): ServerEnv {
  if (cached) {
    return cached;
  }

  const parsed = server_env_schema.safeParse(process.env);

  if (!parsed.success) {
    throw new Error(`Invalid server environment:\n${JSON.stringify(parsed.error.format(), null, 2)}`);
  }

  cached = parsed.data;
  return cached;
}
```

- [ ] **Step 2: Replace `server/db/drizzle.ts`**

Drops `mode: "planetscale"` (wrong for a real MySQL server), drops the `?sslaccept=strict` string surgery (a PlanetScale-only URL quirk), and makes TLS explicit.

```ts
import { readFileSync } from "node:fs";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import * as relations from "./relations";
import * as schema from "./schema";

const ca_path = process.env.DATABASE_CA_PATH;

const pool = mysql.createPool({
  uri: process.env.DATABASE_URL ?? "",
  // Omitted entirely when the database is reached over Coolify's private Docker
  // network. Never set rejectUnauthorized:false — see spec §1.2.
  ssl: ca_path ? { ca: readFileSync(ca_path, "utf8") } : undefined,
});

export const db = drizzle(pool, {
  schema: { ...schema, ...relations },
  mode: "default",
});
```

- [ ] **Step 3: Verify**

Run: `bun run tsc && bunx biome check --fix server/env.ts server/db/drizzle.ts`
Expected: no type errors. (`mode: "default"` is verified valid — `drizzle-orm`'s `Mode` type is `'default' | 'planetscale'`.)

- [ ] **Step 4: Commit**

```bash
git add server/env.ts server/db/drizzle.ts && git commit -m "feat: point drizzle at coolify mysql and add lazy server env validation" -- server/env.ts server/db/drizzle.ts
```

---

### Task 2: Credential encryption

Mailbox passwords are stored encrypted so a database dump alone is inert (spec §1.8). This is the one module in Phase 0 where a silent failure is unrecoverable, so it ships with tests — Bun's runner is built in, no dependency.

**Files:**
- Create: `server/mail/crypto/credentials.ts`
- Create: `server/mail/crypto/credentials.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `serverEnv()` from Task 1.
- Produces:
  ```ts
  type EncryptedCredential = { ciphertext: string; iv: string; auth_tag: string; key_version: number };
  function encryptCredential(plaintext: string): EncryptedCredential;
  function decryptCredential(record: EncryptedCredential): string;
  ```
  Phase 1 stores these four fields as four columns on the `Mailbox` table.

- [ ] **Step 1: Create `server/mail/crypto/credentials.ts`**

```ts
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { serverEnv } from "@server/env";

export type EncryptedCredential = {
  ciphertext: string;
  iv: string;
  auth_tag: string;
  key_version: number;
};

const CURRENT_KEY_VERSION = 1;
const IV_BYTES = 12;

function encryption_key(): Buffer {
  return Buffer.from(serverEnv().MAIL_ENCRYPTION_KEY, "hex");
}

export function encryptCredential(plaintext: string): EncryptedCredential {
  // A fresh IV per record is mandatory under GCM. Reusing one does not raise an
  // error — it silently destroys both confidentiality and unforgeability.
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", encryption_key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);

  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    auth_tag: cipher.getAuthTag().toString("base64"),
    key_version: CURRENT_KEY_VERSION,
  };
}

export function decryptCredential(record: EncryptedCredential): string {
  if (record.key_version !== CURRENT_KEY_VERSION) {
    throw new Error(`Unsupported credential key_version ${record.key_version}`);
  }

  const decipher = createDecipheriv("aes-256-gcm", encryption_key(), Buffer.from(record.iv, "base64"));
  decipher.setAuthTag(Buffer.from(record.auth_tag, "base64"));

  return Buffer.concat([decipher.update(Buffer.from(record.ciphertext, "base64")), decipher.final()]).toString("utf8");
}
```

- [ ] **Step 2: Create `server/mail/crypto/credentials.test.ts`**

Env is seeded before the dynamic import because `serverEnv()` caches on first read.

```ts
import { describe, expect, test } from "bun:test";

process.env.DATABASE_URL ??= "mysql://test:test@localhost:3306/test";
process.env.JWT_SECRET ??= "x".repeat(32);
process.env.MAIL_ENCRYPTION_KEY ??= "a".repeat(64);
process.env.ADMIN_EMAIL ??= "test@example.com";

const { encryptCredential, decryptCredential } = await import("./credentials");

describe("credential encryption", () => {
  test("round-trips a password", () => {
    const record = encryptCredential("hunter2-app-password");
    expect(decryptCredential(record)).toBe("hunter2-app-password");
  });

  test("uses a distinct IV and ciphertext per call for identical input", () => {
    const first = encryptCredential("same-input");
    const second = encryptCredential("same-input");
    expect(first.iv).not.toBe(second.iv);
    expect(first.ciphertext).not.toBe(second.ciphertext);
  });

  test("rejects tampered ciphertext", () => {
    const record = encryptCredential("hunter2");
    const bytes = Buffer.from(record.ciphertext, "base64");
    bytes[0] ^= 0xff;
    expect(() => decryptCredential({ ...record, ciphertext: bytes.toString("base64") })).toThrow();
  });

  test("rejects a tampered auth tag", () => {
    const record = encryptCredential("hunter2");
    const tag = Buffer.from(record.auth_tag, "base64");
    tag[0] ^= 0xff;
    expect(() => decryptCredential({ ...record, auth_tag: tag.toString("base64") })).toThrow();
  });

  test("rejects an unknown key_version", () => {
    const record = encryptCredential("hunter2");
    expect(() => decryptCredential({ ...record, key_version: 99 })).toThrow();
  });
});
```

- [ ] **Step 3: Add the test script to `package.json`**

Insert into `"scripts"`, after `"tsc"`:

```json
    "test": "bun test",
```

- [ ] **Step 4: Verify**

Run: `bun test server/mail/crypto/credentials.test.ts`
Expected: 5 pass, 0 fail. The tamper tests must actually throw — if either passes silently, the auth tag is not being verified and the module is unsafe to use.

Run: `bun run tsc && bunx biome check --fix server/mail/crypto/`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add server/mail/crypto/credentials.ts server/mail/crypto/credentials.test.ts package.json && git commit -m "feat: add AES-256-GCM credential encryption with per-record IV" -- server/mail/crypto/credentials.ts server/mail/crypto/credentials.test.ts package.json
```

---

### Task 3: Session cookie and reader

`signJWT` / `verifyJWT` work but nothing calls them. This adds the cookie layer.

**Files:**
- Create: `server/auth/session.ts`

**Interfaces:**
- Consumes: `signJWT(payload: AuthJWT, maxAge?: string): Promise<string>` and `verifyJWT(token: string): Promise<AuthJWT | null>` from `server/auth/jwt.ts`.
- Produces:
  ```ts
  const SESSION_COOKIE = "flext_session";
  function startSession(payload: AuthJWT): Promise<void>;
  function endSession(): void;
  function readSession(): Promise<AuthJWT | null>;
  ```

`getCookie`, `getCookies`, `setCookie`, and `deleteCookie` are verified present on `@tanstack/react-start/server` in the installed version (1.168.32) — no import-path hunting needed.

- [ ] **Step 1: Create `server/auth/session.ts`**

```ts
import { deleteCookie, getCookie, setCookie } from "@tanstack/react-start/server";
import { type AuthJWT, signJWT, verifyJWT } from "./jwt";

export const SESSION_COOKIE = "flext_session";

// Must track signJWT's default maxAge of "120d", or the cookie outlives the token
// and produces a signed-in-looking UI that fails every request.
const MAX_AGE_SECONDS = 120 * 24 * 60 * 60;

export async function startSession(payload: AuthJWT): Promise<void> {
  const token = await signJWT(payload);

  setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

export function endSession(): void {
  deleteCookie(SESSION_COOKIE, { path: "/" });
}

export async function readSession(): Promise<AuthJWT | null> {
  const token = getCookie(SESSION_COOKIE);

  if (!token) {
    return null;
  }

  return verifyJWT(token);
}
```

- [ ] **Step 2: Verify**

Run: `bun run tsc && bunx biome check --fix server/auth/session.ts`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add server/auth/session.ts && git commit -m "feat: add session cookie helpers" -- server/auth/session.ts
```

---

### Task 4: Sign-in page, sign-out, signup disabled

`src/routes/auth/sign-in.tsx` and `sign-up.tsx` are 9-line stubs today. `signIn()` in `server/auth/credentials.ts` already does bcrypt verification and returns a discriminated result — this task gives it a UI and a cookie.

**Files:**
- Modify: `src/routes/auth/sign-in.tsx`
- Modify: `src/routes/auth/sign-up.tsx`
- Modify: `src/routes/auth/sign-out.tsx`

**Interfaces:**
- Consumes: `startSession`, `endSession` from Task 3; `signIn(input: { email: string; password: string })` from `server/auth/credentials.ts`, which returns `{ success: true; user: { id, email, name, image, emailVerified } } | { success: false; error: string; providers?: string[] }`.
- Produces: a working `/auth/sign-in` that sets the session cookie, and `/auth/sign-out` that clears it.

- [ ] **Step 1: Replace `src/routes/auth/sign-in.tsx`**

The `ADMIN_EMAIL` check is what makes this single-user: even if another `User` row exists, only one address can obtain a session.

```tsx
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { type FC, useState } from "react";
import { signIn } from "@server/auth/credentials";
import { serverEnv } from "@server/env";
import { startSession } from "@server/auth/session";

const submitSignIn = createServerFn({ method: "POST" })
  .validator((input: { email: string; password: string }) => input)
  .handler(async ({ data }) => {
    if (data.email.toLowerCase() !== serverEnv().ADMIN_EMAIL.toLowerCase()) {
      return { ok: false as const, message: "Invalid email or password." };
    }

    const result = await signIn(data);

    if (!result.success) {
      return { ok: false as const, message: "Invalid email or password." };
    }

    await startSession({
      user_id: result.user.id,
      email: result.user.email,
      name: result.user.name,
      image: result.user.image ?? undefined,
      provider: "credentials",
      email_verified: result.user.emailVerified !== null,
    });

    return { ok: true as const };
  });

const SignInPage: FC = () => {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <div className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4">
      <h1 className="text-2xl font-semibold text-zinc-800 dark:text-zinc-100">Sign in</h1>
      <form
        className="mt-6 flex flex-col gap-4"
        onSubmit={async (event) => {
          event.preventDefault();
          setPending(true);
          setError(null);

          const form = new FormData(event.currentTarget);
          const response = await submitSignIn({
            data: { email: String(form.get("email") ?? ""), password: String(form.get("password") ?? "") },
          });

          setPending(false);

          if (!response.ok) {
            setError(response.message);
            return;
          }

          await router.navigate({ to: "/admin" });
        }}
      >
        <input
          name="email"
          type="email"
          autoComplete="username"
          required
          placeholder="Email"
          className="rounded-md border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
        />
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          placeholder="Password"
          className="rounded-md border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-zinc-800 px-3 py-2 text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {pending ? "Signing in…" : "Sign in"}
        </button>
        {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
      </form>
    </div>
  );
};

export const Route = createFileRoute("/auth/sign-in")({
  component: SignInPage,
});
```

- [ ] **Step 2: Replace `src/routes/auth/sign-up.tsx`**

Signup is disabled (spec §1.8). Redirecting rather than deleting the route keeps any existing link from 404ing.

```tsx
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/auth/sign-up")({
  beforeLoad: () => {
    throw redirect({ to: "/auth/sign-in" });
  },
});
```

- [ ] **Step 3: Replace `src/routes/auth/sign-out.tsx`**

```tsx
import { createFileRoute, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { endSession } from "@server/auth/session";

const submitSignOut = createServerFn({ method: "POST" }).handler(async () => {
  endSession();
  return { ok: true as const };
});

export const Route = createFileRoute("/auth/sign-out")({
  beforeLoad: async () => {
    await submitSignOut();
    throw redirect({ to: "/auth/sign-in" });
  },
});
```

- [ ] **Step 4: Verify**

Run: `bun run tsc && bunx biome check --fix src/routes/auth/`
Expected: no errors. (The installed `createServerFn` exposes both `.validator()` and the newer `.inputValidator()` alias; either compiles.)

- [ ] **Step 5: Commit**

```bash
git add src/routes/auth/sign-in.tsx src/routes/auth/sign-up.tsx src/routes/auth/sign-out.tsx && git commit -m "feat: wire credentials sign-in and sign-out, disable signup" -- src/routes/auth/sign-in.tsx src/routes/auth/sign-up.tsx src/routes/auth/sign-out.tsx
```

---

### Task 5: The `/admin` guard

There is no route protection anywhere in the app today. This adds a single layout route that guards everything nested under it, so every later phase's screens are protected by construction rather than by remembering to add a check.

**Files:**
- Create: `src/routes/admin/route.tsx`
- Create: `src/routes/admin/index.tsx`

**Interfaces:**
- Consumes: `readSession()` from Task 3.
- Produces: an authenticated layout at `/admin`. Nested routes read the session via `Route.useRouteContext().session`.

- [ ] **Step 1: Create `src/routes/admin/route.tsx`**

```tsx
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import type { FC } from "react";
import { readSession } from "@server/auth/session";

const fetchSession = createServerFn({ method: "GET" }).handler(async () => {
  return readSession();
});

const AdminLayout: FC = () => {
  const { session } = Route.useRouteContext();

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <header className="mb-8 flex items-baseline justify-between border-b border-zinc-200 pb-4 dark:border-zinc-800">
        <h1 className="text-lg font-semibold text-zinc-800 dark:text-zinc-100">Admin</h1>
        <span className="text-sm text-zinc-500">{session.email}</span>
      </header>
      <Outlet />
    </div>
  );
};

export const Route = createFileRoute("/admin")({
  beforeLoad: async () => {
    const session = await fetchSession();

    if (!session) {
      throw redirect({ to: "/auth/sign-in" });
    }

    return { session };
  },
  component: AdminLayout,
});
```

- [ ] **Step 2: Create `src/routes/admin/index.tsx`**

A placeholder landing page. Phase 2 replaces its contents with the Sender Policy and Needs Action surfaces.

```tsx
import { createFileRoute } from "@tanstack/react-router";
import type { FC } from "react";

const AdminHome: FC = () => {
  return <p className="text-zinc-600 dark:text-zinc-400">Mailbox management arrives in phase 1.</p>;
};

export const Route = createFileRoute("/admin/")({
  component: AdminHome,
});
```

- [ ] **Step 3: Verify**

Run: `bun run tsc && bunx biome check --fix src/routes/admin/`
Expected: no errors. `src/routeTree.gen.ts` is gitignored and regenerated by the build — do not hand-edit it, and do not commit it.

- [ ] **Step 4: Commit**

```bash
git add src/routes/admin/route.tsx src/routes/admin/index.tsx && git commit -m "feat: add auth-gated admin route group" -- src/routes/admin/route.tsx src/routes/admin/index.tsx
```

---

### Task 6: ORPC session context

`server/orpc/context.ts` exists with `session` hardcoded to `null` and is never called — both entrypoints pass `context: {}` instead. Procedures are built on the bare `os` singleton with no context type. Phase 1's mailbox procedures must be authenticated, so this task makes the context real and adds an `authed` base.

**Files:**
- Modify: `server/orpc/context.ts`
- Create: `server/orpc/base.ts`
- Modify: `src/routes/api/orpc/$.ts`
- Modify: `src/integrations/orpc.tsx`

**Interfaces:**
- Consumes: `readSession()` from Task 3.
- Produces:
  ```ts
  type ORPCContext = { db: typeof db; session: AuthJWT | null };
  const pub: /* os with ORPCContext */;
  const authed: /* pub + session guarantee, context.session is non-null */;
  ```
  Phase 1 builds all mailbox procedures on `authed`.

- [ ] **Step 1: Replace `server/orpc/context.ts`**

```ts
import type { AuthJWT } from "@server/auth/jwt";
import { readSession } from "@server/auth/session";
import { db } from "@server/db/drizzle";

export type ORPCContext = {
  db: typeof db;
  session: AuthJWT | null;
};

export async function createContext(): Promise<ORPCContext> {
  return { db, session: await readSession() };
}
```

- [ ] **Step 2: Create `server/orpc/base.ts`**

```ts
import { ORPCError, os } from "@orpc/server";
import type { ORPCContext } from "./context";

export const pub = os.$context<ORPCContext>();

export const authed = pub.use(({ context, next }) => {
  if (!context.session) {
    throw new ORPCError("UNAUTHORIZED");
  }

  return next({ context: { ...context, session: context.session } });
});
```

- [ ] **Step 3: Wire the HTTP entrypoint — `src/routes/api/orpc/$.ts`**

Replace the `context: {}` line so the handler builds a real context per request:

```ts
import { RPCHandler } from "@orpc/server/fetch";
import { orpcRouter } from "@server/orpc";
import { createContext } from "@server/orpc/context";
import { createFileRoute } from "@tanstack/react-router";

const handler = new RPCHandler(orpcRouter);

async function handle({ request }: { request: Request }) {
  const { response } = await handler.handle(request, {
    prefix: "/api/orpc",
    context: await createContext(),
  });
  return response ?? new Response("Not Found", { status: 404 });
}

export const Route = createFileRoute("/api/orpc/$")({
  server: { handlers: { GET: handle, POST: handle, PUT: handle, DELETE: handle, OPTIONS: handle } },
});
```

- [ ] **Step 4: Wire the in-process client — `src/integrations/orpc.tsx`**

Change the server-side branch's `context: async () => ({})` to `context: createContext`, adding `import { createContext } from "@server/orpc/context";` at the top. Leave the browser branch (`RPCLink`) alone — it goes over HTTP and picks the session up from the cookie, which is already sent automatically as a same-origin request.

- [ ] **Step 5: Verify**

Run: `bun run tsc && bunx biome check --fix server/orpc/ src/routes/api/orpc/\$.ts src/integrations/orpc.tsx`
Expected: no errors. Existing `booksProcedures` are unchanged — they are built on bare `os`, which stays compatible; they simply ignore the context.

- [ ] **Step 6: Commit**

```bash
git add server/orpc/context.ts server/orpc/base.ts src/routes/api/orpc/\$.ts src/integrations/orpc.tsx && git commit -m "feat: wire session into orpc context and add authed procedure base" -- server/orpc/context.ts server/orpc/base.ts src/routes/api/orpc/\$.ts src/integrations/orpc.tsx
```

---

## Manual verification

Automated checks cover types, lint, and the crypto module. These need a browser and the user's own `bun run dev` — **the implementing agent must not run the dev server**; hand this list to the user.

1. `/admin` while signed out → redirects to `/auth/sign-in`.
2. Sign in with the `ADMIN_EMAIL` account → lands on `/admin`, header shows the email.
3. Sign in with a wrong password, and with a valid non-admin address → both show "Invalid email or password" and set no cookie. The two must be indistinguishable; a different message for a valid-but-not-admin address leaks which address is the admin one.
4. `/auth/sign-up` → redirects to `/auth/sign-in`.
5. `/auth/sign-out` → clears the cookie, redirects, and `/admin` is guarded again.
6. Reload `/admin` after signing in → still authenticated (cookie survives).

## Self-review

| Spec requirement | Task |
|---|---|
| §1.8 Coolify MySQL, `mode: "planetscale"` removed | 1 |
| §1.8 credentials AES-256-GCM, per-record IV, `key_version` | 2 |
| §1.8 `MAIL_ENCRYPTION_KEY` in env, not credentials in env | 1, 2 |
| §1.8 single account, signup disabled | 4 |
| §1.8 minimal auth gate | 3, 4, 5 |
| §1.6/Phase 7 authenticated procedures for later phases | 6 |

**Deliberately out of scope:** OAuth sign-in (the Twitter provider throws, `state` is never persisted or validated, and `Account` linking is unwritten — a half-wired OAuth flow with no CSRF check is worse than none), magic-link sign-in, and the `Session` table (auth is stateless JWT by design). None are needed for a single-operator admin gate. `env.ts` at the repo root is left untouched and remains unenforced; `server/env.ts` supersedes it for server-side values.

**Not started until Phase 1:** every `server/mail/` module other than `crypto/`, all thirteen new tables, and any IMAP connection.
