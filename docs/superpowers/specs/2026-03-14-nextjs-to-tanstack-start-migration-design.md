# Next.js to TanStack Start Migration — Design Spec

**Date:** 2026-03-14
**Status:** Approved
**Scope:** Strict infrastructure migration. No content, UI, or feature changes.

## Summary

Migrate the flext personal portfolio/resume site from Next.js 12 to TanStack Start, replacing the entire toolchain while keeping all features, components, and visual output identical.

### Migration Map

| Current | Target |
|---------|--------|
| Next.js 12 (Pages Router) | TanStack Start (file-based routing, Vinxi/Nitro) |
| ESLint + Prettier + fx-style | Biome 2.x (format + lint) |
| pnpm | Bun |
| Vercel | Coolify / Nixpacks (auto-detected) |
| Prisma (MySQL / PlanetScale) | Drizzle ORM (MySQL / PlanetScale) |
| TRPC v10 | ORPC |
| NextAuth v4 (6 providers) | Custom JWT auth (jose) |
| next.config.js | vite.config.ts |

### What Stays Unchanged

- All React components, content, styles, public assets
- Zustand stores (same pattern)
- Tailwind theme/plugins (migrated to `.mjs` format)
- SCSS files
- All utility functions
- PlanetScale MySQL database (same data, same schema)
- `framer-motion` / `LazyMotion` for animations

---

## 1. Project Structure

Flat project (no monorepo). All source code under `src/`, server-side code under `server/`.

```
flext/
├── src/
│   ├── client.tsx              # Client entry (hydrateRoot)
│   ├── router.tsx              # TanStack Router setup
│   ├── global-middleware.ts    # JWT auth middleware
│   ├── routes/
│   │   ├── __root.tsx          # Root route (HTML shell, head, fonts, providers)
│   │   ├── index.tsx           # Homepage (portfolio/hero/about/timeline)
│   │   ├── books.tsx
│   │   ├── components.tsx      # Component showcase
│   │   ├── gallery.tsx
│   │   ├── notes.tsx
│   │   ├── portfolio.tsx
│   │   ├── resume.tsx
│   │   ├── liz.tsx
│   │   ├── test.tsx            # Dev/test page
│   │   ├── posts/
│   │   │   └── redesign.tsx    # Blog post (nested route)
│   │   ├── api/                # API routes
│   │   │   ├── orpc.ts         # ORPC handler
│   │   │   ├── tweets.ts       # Twitter data fetch endpoint
│   │   │   └── typeform-webhook.ts  # Typeform webhook endpoint
│   │   └── auth/               # Auth routes
│   │       ├── sign-in.tsx
│   │       ├── sign-out.tsx
│   │       ├── sign-up.tsx
│   │       ├── error.tsx
│   │       ├── verify-request.tsx
│   │       └── callback.$provider.tsx  # OAuth callback
│   ├── components/             # All existing components (migrated as-is)
│   ├── hooks/                  # Custom hooks
│   ├── stores/                 # Zustand stores
│   ├── integrations/
│   │   ├── orpc.tsx            # ORPC client setup (server/client split)
│   │   └── tanstack-query.tsx  # React Query config
│   ├── styles/                 # CSS/SCSS files
│   └── utils/                  # Utility functions
├── server/
│   ├── orpc/                   # ORPC router & procedures
│   │   ├── index.ts            # Root router
│   │   ├── context.ts          # Request context builder
│   │   └── ...                 # Procedure files (mapped from TRPC routers)
│   ├── auth/
│   │   ├── jwt.ts              # JWT sign/verify/encrypt/decrypt (jose)
│   │   ├── oauth.ts            # OAuth flows (GitHub, Google, Twitter, Facebook)
│   │   ├── credentials.ts      # Email/password sign-up & sign-in logic
│   │   └── email.ts            # Magic link email sending (nodemailer)
│   └── db/
│       ├── drizzle.ts          # Drizzle client instance (mysql2 + PlanetScale)
│       ├── schema.ts           # All table schemas (migrated from Prisma)
│       ├── relations.ts        # Drizzle relations
│       └── migrations/         # Drizzle Kit migrations
├── drizzle.config.ts           # Drizzle Kit config (root level for CLI)
├── content/                    # Static content (unchanged)
├── public/                     # Static assets (unchanged)
├── @types/                     # Type definitions
├── vite.config.ts              # Vite + TanStack Start + Nitro (bun preset)
├── tsr.config.json             # TanStack Router config
├── biome.json                  # Biome linter/formatter config
├── bunfig.toml                 # Bun config (isolated linker)
├── tsconfig.json               # TypeScript config
├── tailwind.config.mjs         # Tailwind config (migrated from .js)
├── postcss.config.mjs          # PostCSS config
├── env.ts                      # Zod environment validation
├── package.json                # Scripts, dependencies
└── bun.lock                    # Bun lockfile
```

---

## 2. Framework Migration (Next.js → TanStack Start)

### Entry Points

- **`src/client.tsx`** — Client entry using `hydrateRoot` from React 19, renders `<StartClient />`
- **`src/router.tsx`** — Creates TanStack Router with route tree, default error/404 components, React Query context, scroll restoration
- **`src/routes/__root.tsx`** — Root route containing HTML document shell (replaces `_document.tsx` + `_app.tsx`): head meta, stylesheets, fonts, global providers (QueryClient, theme), Umami analytics script

### TanStack Router Config (`tsr.config.json`)

```json
{
  "rootDirectory": ".",
  "routeFileIgnorePrefix": "-",
  "routesDirectory": "./src/routes",
  "generatedRouteTree": "./src/routeTree.gen.ts"
}
```

### Routing Mapping

| Next.js Page | TanStack Route |
|---|---|
| `pages/index.tsx` | `src/routes/index.tsx` |
| `pages/books.tsx` | `src/routes/books.tsx` |
| `pages/components.tsx` | `src/routes/components.tsx` |
| `pages/gallery.tsx` | `src/routes/gallery.tsx` |
| `pages/notes.tsx` | `src/routes/notes.tsx` |
| `pages/portfolio.tsx` | `src/routes/portfolio.tsx` |
| `pages/resume.tsx` | `src/routes/resume.tsx` |
| `pages/liz.tsx` | `src/routes/liz.tsx` |
| `pages/test.tsx` | `src/routes/test.tsx` |
| `pages/posts/redesign.tsx` | `src/routes/posts/redesign.tsx` |
| `pages/_error.tsx` | `defaultErrorComponent` in router config |
| `pages/api/trpc/[trpc].ts` | `src/routes/api/orpc.ts` (ORPC handler) |
| `pages/api/auth/[...nextauth].ts` | `src/routes/auth/` + `server/auth/` |
| `pages/api/tweets.ts` | `src/routes/api/tweets.ts` (server function) |
| `pages/api/typeform-webhook.ts` | `src/routes/api/typeform-webhook.ts` (server function) |

### Next.js API Replacements

| Next.js | TanStack Start / Vinxi |
|---|---|
| `next/link` → `Link` | `@tanstack/react-router` → `Link` |
| `next/image` → `Image` | Rewritten lightweight wrapper (see Section 9) |
| `next/head` + `next-seo` | Route `meta` function + `<Meta />` from TanStack Start |
| `next/router` → `useRouter` | `@tanstack/react-router` → `useRouter`, `useNavigate`, `useParams`, etc. |
| `next/dynamic` | `React.lazy()` + `Suspense` |
| `getServerSideProps` | `route.beforeLoad` or `route.loader` with `createServerFn` |
| `next-themes` | Lightweight `ThemeProvider` + `useTheme` hook (see Section 10) |
| `_app.tsx` providers | `__root.tsx` `Wrap` component or inline providers |
| `@svgr/webpack` | `vite-plugin-svgr` |

### SSR

TanStack Start runs SSR by default via Vinxi/Nitro. Server functions (`createServerFn`) replace API routes for data fetching. Nitro preset set to `'bun'` for production.

---

## 3. ORM Migration (Prisma → Drizzle)

### Driver

- `drizzle-orm` with `mysql2` driver (standard TCP connection)
- PlanetScale connection via `DATABASE_URL` environment variable
- SSL enabled for PlanetScale (`ssl: { rejectUnauthorized: true }`)

### PlanetScale / Vitess Constraints

**Important:** PlanetScale uses Vitess which does NOT support foreign key constraints at the database level. The current Prisma schema uses `referentialIntegrity = "prisma"` to handle this at the application level. In Drizzle:
- Table schemas must NOT include `.references()` with `onDelete`/`onUpdate` actions
- All relations must be defined in `relations.ts` (query-time only, not DB-level constraints)
- This matches PlanetScale's recommended approach

### Schema Translation

All 15 Prisma models translated to Drizzle `mysqlTable` definitions:

**Auth tables:**
- `User` — id, name, email, emailVerified, password, image, registeredAt, acceptMarketing
- `Account` — OAuth accounts linked to users (column mapping: `refreshToken`, `accessToken`, etc.)
- `Session` — sessions (kept for backward compat, not used with JWT)
- `VerificationToken` — email verification tokens

**Content tables:**
- `Post` — blog posts with views/likes counters
- `Comment` — user comments on posts (references User, Post)

**Habit tracking domain:**
- `HabitTracking` — daily habit entries with 17 duration fields, wake time, weight, exercise, booleans
- `Habits` — user habit definitions (JSON data stored as text)

**Food tracking domain (multi-table relational graph):**
- `Food` — food items with default unit/quantity/price
- `FoodUnit` — measurement units (name, abbreviation)
- `FoodUnitConversion` — conversion factors between units (fromUnit → toUnit × multiply)
- `FoodMethod` — cooking/preparation methods
- `FoodRated` — rated food entries linking Food + FoodUnit + FoodMethod + HabitTracking

**Other:**
- `Books` — book entries with read/published status, ASIN/ISBN, author, rating
- `Telemetry` — simple name + timestamp tracking

Relations defined in separate `relations.ts` file:
- User → Account[], Session[], Comment[], Habits[]
- Post → Comment[]
- HabitTracking → FoodRated[]
- Food → FoodUnit (default), FoodRated[]
- FoodUnit → Food[], FoodUnitConversion[] (fromUnit, toUnit), FoodRated[]
- FoodRated → Food, FoodUnit, FoodMethod, HabitTracking

### Migration Strategy

1. Manually translate all 15 Prisma models to Drizzle `mysqlTable` definitions
2. Use `drizzle-kit introspect` to verify schema matches live PlanetScale database
3. No data migration needed — same database, same tables
4. Drop Prisma client, remove `prisma/` directory

### Drizzle Config

```typescript
// drizzle.config.ts
export default defineConfig({
  schema: "./server/db/schema.ts",
  out: "./server/db/migrations",
  dialect: "mysql",
  dbCredentials: {
    url: process.env.DATABASE_URL
  }
});
```

---

## 4. API Migration (TRPC → ORPC)

### Structure

ORPC router lives in `server/orpc/`. Each procedure file exports typed procedures matching the existing TRPC router structure.

### Client Setup

`src/integrations/orpc.tsx` provides:
- **Server-side:** Direct router client with context (JWT, db)
- **Client-side:** RPCLink to `/api/orpc` endpoint with JWT headers
- **Exports:** `orpc` client instance, `orpcQuery` for TanStack Query integration

### ORPC Route Handler

`src/routes/api/orpc.ts` — API route that accepts ORPC requests, creates context from JWT headers, and delegates to the router.

### Procedure Migration

Each TRPC procedure maps 1:1 to an ORPC procedure:
- Input validation stays with Zod
- SuperJSON serialization preserved
- Context provides same data (db, session/JWT, etc.)

### Batching Note

ORPC does not support request batching (TRPC's `splitLink`/`httpBatchLink`). The current TRPC setup uses `splitLink` with conditional batching plus standalone `trpcZustand` and `trpcZustandNonBatching` clients for Zustand stores. In ORPC:
- Drop batching — individual requests replace batched calls
- Standalone Zustand client pattern → direct `orpc` client calls from stores (no React Query wrapper needed for store mutations)

---

## 5. Auth Migration (NextAuth → Custom JWT)

### Approach

Follow listify's JWT pattern adapted for flext's 6 auth providers.

### Auth Providers (all 6 must be migrated)

1. **GitHub** — OAuth 2.0 flow
2. **Google** — OAuth 2.0 flow
3. **Twitter** — OAuth 1.0a flow (current config uses v1)
4. **Facebook** — OAuth 2.0 flow
5. **Email (magic link)** — Sends verification email via SMTP (nodemailer), user clicks link with token, server verifies token and creates session
6. **Credentials (sign-up + sign-in)** — Two separate flows:
   - **sign-up:** Validates name/email/password, checks for existing account, hashes password with bcrypt, creates user
   - **sign-in:** Validates email/password, checks account exists, verifies bcrypt hash

### Components

- **`server/auth/jwt.ts`** — `sign()`, `verify()`, `encryptToken()`, `decryptToken()` using `jose`
- **`server/auth/oauth.ts`** — Manual OAuth flows for GitHub, Google, Twitter, Facebook
- **`server/auth/credentials.ts`** — Password-based sign-up and sign-in logic (bcrypt hashing, validation, account-exists detection)
- **`server/auth/email.ts`** — Magic link email sending via SMTP (nodemailer), token generation and verification
- **`src/global-middleware.ts`** — Decodes JWT from cookies/headers, injects into router context
- **Auth routes** under `src/routes/auth/`:
  - `sign-in.tsx` — Sign-in page (maps from NextAuth `pages.signIn`)
  - `sign-out.tsx` — Sign-out page
  - `sign-up.tsx` — Sign-up page (credentials)
  - `error.tsx` — Error page with query string error codes (validation-error, account-exists, account-not-found, incorrect-password, email-not-verified)
  - `verify-request.tsx` — "Check your email" page (magic link)
  - `callback.$provider.tsx` — OAuth callback handler

### Callback Logic (must be preserved)

The current NextAuth `signIn` callback contains critical business logic:
- **Credentials flow:** Detects `validationError`, `accountExists` (returns providers list), `accountNotFound`, `incorrectPassword`, `emailVerified` check → redirects to error page with specific error codes
- **OAuth flow:** Checks if account with same email already exists with a different provider → redirects to error page with `account-exists|||provider1,provider2`
- **Account linking:** If user has no existing accounts, allows new OAuth account linking

This logic must be replicated in the custom auth route handlers.

### Session Flow

1. User authenticates via any provider
2. Server creates/updates user in DB, signs JWT with user data
3. JWT stored in httpOnly cookie (120-day maxAge, matching current NextAuth config)
4. Global middleware decodes JWT on every request, populates router context
5. Client reads auth state from router context

### JWT Payload

```typescript
type AuthJWT = {
  user_id: string;
  email: string;
  name: string;
  image?: string;
  provider: string;
  email_verified?: boolean;
  accept_marketing?: boolean;
};
```

### Database

- `User` and `Account` tables kept as-is
- `Session` table kept for backward compatibility (not actively used with JWT)
- `VerificationToken` table kept (used by magic link email flow)

---

## 6. Tooling Configuration

### Biome (`biome.json`)

Modeled on listify's config:
- Formatter: spaces, line width 140, double quotes
- Linter: recommended rules with project-specific overrides
- CSS: Tailwind directives support
- Assist: organize imports
- VCS: git integration, use `.gitignore`

### Bun (`bunfig.toml`)

```toml
[install]
linker = "isolated"
```

### TypeScript (`tsconfig.json`)

- Target: ES2022, Module: ESNext, ModuleResolution: bundler
- **`strict: false`** initially (matching current tsconfig), tighten later in a separate pass
- JSX: react-jsx
- Path aliases: `~/` → `src/`, `@server/` → `server/`
- Lib: DOM, ESNext, dom.iterable

### Vite (`vite.config.ts`)

```typescript
// Plugins:
// 1. vite-tsconfig-paths (path alias resolution)
// 2. vite-plugin-svgr (SVG as React components, replaces @svgr/webpack)
// 3. @tanstack/react-start/plugin/vite (TanStack Start SSR)
// 4. nitro({ preset: 'bun' })
// 5. @vitejs/plugin-react

// Server: port 3000
```

### Tailwind (`tailwind.config.mjs`)

Migrated from `.js` to `.mjs`. Same theme, plugins, custom classes. Content paths updated to scan:
- `src/**/*.{ts,tsx}`
- `content/**/*.{ts,tsx,mdx}`

### PostCSS (`postcss.config.mjs`)

```javascript
export default {
  plugins: {
    "postcss-import": {},
    "tailwindcss/nesting": {},
    tailwindcss: {},
    autoprefixer: {}
  }
};
```

### Environment (`env.ts`)

Complete Zod schema — all variables from current `server/trpc/env.js`:

```typescript
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]),

  // Database (PlanetScale)
  DATABASE_URL: z.string(),
  DATABASE_URL_PROD: z.string(),
  DATABASE_URL_DEV: z.string(),
  PLANETSCALE_SSL_CERT_PATH: z.string(),
  PLANETSCALE_DB_HOST: z.string(),
  PLANETSCALE_DB_PASSWORD: z.string(),
  PLANETSCALE_DB_USERNAME: z.string(),
  PLANETSCALE_DB: z.string(),
  PLANETSCALE_ORG: z.string(),
  PLANETSCALE_TOKEN: z.string(),
  PLANETSCALE_TOKEN_NAME: z.string(),

  // Auth - JWT (replaces NEXTAUTH_URL + NEXTAUTH_SECRET)
  JWT_SECRET: z.string(),    // was NEXTAUTH_SECRET
  SCRIPT_SECRET: z.string(),

  // Auth - OAuth providers
  GITHUB_APP_ID: z.string(),
  GITHUB_ID: z.string(),
  GITHUB_SECRET: z.string(),
  GOOGLE_CLIENT_ID: z.string(),
  GOOGLE_CLIENT_SECRET: z.string(),
  TWITTER_CLIENT_ID: z.string(),
  TWITTER_CLIENT_SECRET: z.string(),
  TWITTER_CLIENT_BEARER_TOKEN: z.string(),
  TWITTER_CLIENT_ID_2022_08: z.string(),
  TWITTER_CLIENT_SECRET_2022_08: z.string(),
  FACEBOOK_CLIENT_ID: z.string(),
  FACEBOOK_CLIENT_SECRET: z.string(),
  FACEBOOK_CLIENT_PROD_ID: z.string(),
  FACEBOOK_CLIENT_PROD_SECRET: z.string(),

  // Auth - Email (magic link)
  EMAIL_SERVER_USER: z.string(),
  EMAIL_SERVER_PASSWORD: z.string(),
  EMAIL_SERVER_HOST: z.string(),
  EMAIL_SERVER_PORT: z.string(),
  EMAIL_FROM: z.string(),

  // Public (NEXT_PUBLIC_* → VITE_PUBLIC_*)
  VITE_PUBLIC_APP_VERSION: z.string(),  // was NEXT_PUBLIC_APP_VERSION
  VITE_PUBLIC_HOSTNAME: z.string(),     // was NEXT_PUBLIC_HOSTNAME
});
```

**Retired variables:** `NEXTAUTH_URL`, `NEXTAUTH_SECRET` (replaced by `JWT_SECRET`)
**Renamed variables:** `NEXT_PUBLIC_*` → `VITE_PUBLIC_*` (Vite convention)

---

## 7. Deployment

Coolify with Nixpacks auto-detection (no config file needed).

### Build & Start

```json
{
  "scripts": {
    "dev": "vite dev",
    "build": "vite build",
    "start": "bun run .output/server/index.mjs"
  }
}
```

Nixpacks detects Bun from `bun.lock`, runs `bun install` → `bun run build` → `bun run start`.

### Nitro Output

Build produces `.output/server/index.mjs` — single server entry point running on Bun.

---

## 8. Component Migration Notes

### Custom `Image` Component (`components/image.tsx`)

The current component wraps `next/future/image` with:
- Blur placeholder generation via `/_next/image?...&w=32&q=1` (Next.js-specific URL)
- Preload management via a Zustand store
- Aspect ratio calculations
- Pixel density multiplier

**Migration approach:** Rewrite as a lightweight `<img>` wrapper. Drop the blur-up effect (the `/_next/image` URL pattern won't work outside Next.js). Keep aspect ratio calculation and preload store logic. If blur-up is desired later, can generate blur placeholders at build time with `sharp`.

### Custom `Link` Component (`components/link.tsx`)

Wraps `next/link` with:
- External URL detection (opens in new tab)
- iframe `postMessage` communication (for theme content embedding)
- URL rewriting (`/products/` path stripping)

**Migration approach:** Wrap TanStack Router's `<Link>` with same external URL detection and postMessage logic. URL rewriting logic preserved as-is.

### `next-themes` Replacement

Used in 4 files: `_context-providers.tsx`, `darkmode-icon.tsx`, `hero.tsx`, `header.settings.tsx`.

**Migration approach:** Create a lightweight `ThemeProvider` + `useTheme` hook:
- Persists theme to localStorage
- Applies `dark` class to `<html>` element
- Detects system color preference
- Avoids flash of wrong theme on SSR (inject inline script in `__root.tsx` head)

### `next/dynamic` Usage

`_load-initial-data.tsx` uses `next/dynamic` for lazy-loading `react-tooltip`.

**Migration approach:** Replace with `React.lazy()` + `<Suspense>`.

### SVG Imports

`@svgr/webpack` in `next.config.js` enables importing SVGs as React components.

**Migration approach:** Add `vite-plugin-svgr` to `vite.config.ts`.

### Umami Analytics

`_document.tsx` includes an inline Umami analytics script.

**Migration approach:** Move to `__root.tsx` head scripts section.

### Sitemap

Currently uses `next-sitemap` as a post-build script.

**Migration approach:** Add a build-time script or Nitro server route to generate `sitemap.xml`.

---

## 9. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| OAuth flow complexity (6 providers) | Start with GitHub OAuth, verify full flow, then add remaining providers one at a time |
| Credentials auth callback logic | Port all error redirect logic from NextAuth callbacks verbatim |
| Magic link email flow | Keep nodemailer, test with existing SMTP config |
| PlanetScale FK constraints | Drizzle relations in `relations.ts` only, no `.references()` in schema |
| SCSS compatibility with Vite | Vite supports SCSS natively via `sass` package — no changes needed |
| PlanetScale SSL/connection | Test Drizzle mysql2 connection early in migration |
| Component import path churn | Use path aliases (`~/`, `@server/`) to minimize changes |
| Custom Image component | Rewrite wrapper, accept loss of blur-up effect |
| Custom Link component | Preserve iframe postMessage and external URL logic |
| TRPC batching removal | Monitor for performance regression, individual ORPC calls should be fine for this site's scale |
| TypeScript strict mode | Keep `strict: false` initially, tighten in separate pass |
| react-tooltip v4 + React 19 | Verify compatibility, upgrade if needed |

---

## 10. Out of Scope

- UI/UX changes
- Content changes
- Database schema changes (tables stay identical)
- New features
- Monorepo structure
- CI/CD pipeline setup
- Domain/DNS configuration
- TypeScript strict mode migration (separate future task)
