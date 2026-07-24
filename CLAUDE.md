# CLAUDE.md

Personal site + blog of Felix Tellmann — live at https://flext.dev. TanStack Start + Vite + Bun, single-package repo (no workspaces). MySQL via Drizzle (`mysql2`), API via ORPC, custom JWT auth (jose) under `server/auth/`.

## Commands

```bash
bun run tsc          # Type check (TypeScript 7 native compiler)
bunx biome check --fix <file>   # Lint+format after editing a file
bun run check        # biome check --write across the repo
bun run build        # vite build (production)
bun run db:generate  # drizzle-kit generate migrations from schema
bun run upgrade-packages  # ncu latest-with-holds + bun install
```

## Critical: Never Run Dev Servers

Never run `bun run dev` (or any watch/long-running server) — the user runs it themselves. Verify changes with `bun run tsc` and `bunx biome check` instead.

## Critical: Database Writes

Never run `bun run db:push`, `db:migrate`, or raw DML — wherever `DATABASE_URL` points (production once the PlanetScale replacement lands; see `docs/plans/specs/active/2026-07-24-database-replacement-design.md`, decision still open). Schema changes: edit `server/db/schema.ts`, run `bun run db:generate`, keep implementing against the new types, and surface the generated SQL (in `server/db/migrations/`) for the user to apply.

## Critical: Git

- Never `git add -A` / `git add .` — add specific files by name; check `git diff --cached --name-status` before committing.
- Never push to `main`/`master`.

## Generated code — exempt from style/convention checks

Never hand-edit, never flag in audits or simplify/review passes:
- `src/routeTree.gen.ts` (TanStack Router, gitignored — regenerate via `bun run build`)
- `server/db/migrations/**` (drizzle-kit output — edit `server/db/schema.ts` instead)

## Architecture

```
src/
  routes/        # File-based routes: __root.tsx, index, posts/, auth/, api/ (orpc splat, webhooks)
  components/    # Shared React components
  stores/        # Custom store factory (_make-store.tsx + _context-providers.tsx) — NOT bare zustand create()
  hooks/  integrations/  styles/  assets/
server/
  auth/          # JWT auth (jose), sign-in/up flows
  db/            # Drizzle schema.ts + migrations/
  orpc/          # ORPC routers — the API layer
content/         # Page content as typed TSX data modules (hero, timeline, cv, projects, ...)
utils/           # Small pure helpers, one function per file
@types/          # Ambient module declarations (assets, svg?react)
env.ts           # Env validation
```

Path aliases: `~/*` → `src/*`, `@server/*` → `server/*`, `content/*`, `utils/*`, `types/*` → `@types/*`.

## Conventions

- **Formatting**: Biome. Line width 140, spaces, double quotes. Run `bunx biome check --fix <file>` after editing.
- **TypeScript**: full strict + `verbatimModuleSyntax` (type-only imports use `import type`). No `any` — type properly or use `unknown` + narrowing.
- **React components**: Arrow functions with `FC<{ prop types }>`. Single-use handlers/helpers inline — pass `onClick={() => doThing()}` directly or declare inside the component body. Don't extract to module scope.
- **Exports**: Named exports only, never `export default`. (Exception: config files where the tool requires it.)
- **Tailwind — check the config FIRST**: Before writing any sized/colored class, grep `tailwind.config.mjs` for an existing token. Drop to bracketed arbitrary (`text-[13px]`) ONLY after confirming no config token matches. Bare `Npx` suffixes (`gap-8px`) are invalid Tailwind — config token or bracketed arbitrary, never the bare form.
- **classNames**: `cn()` (tailwind-merge/clsx) directly in the JSX prop for dynamic classes — never template literals or extracted variables.
- **State**: shared state goes through the store factory in `src/stores/` (`_make-store.tsx`, seeded via `_load-initial-data.tsx`) — follow that pattern, don't add bare `zustand` `create()` stores. Filter/sort/search/pagination state lives in URL params, not stores.
- **Route files**: `_prefix` = pathless layout group, `$param` = dynamic segment, `-prefix` = private (non-route) file, `api/` = server-only handlers.
- **Content**: page copy/data lives in `content/*.tsx` as typed modules — edit there, not inline in routes.

## Held packages (deliberate, do not "fix")

`upgrade-packages` excludes: `tailwindcss` (v3 until a dedicated v4 migration), `zod` (v3 until a dedicated v4 migration), `react-tooltip` (v4 API used by the tooltip store + 9 components), `@types/react`/`@types/react-dom`, `vite-tsconfig-paths`. Migration ideas tracked in `docs/plans/ideas.md`.

## Superpowers Workflow Overrides

- **Disabled skills** — do NOT invoke: `test-driven-development`, `writing-skills`, `requesting-code-review`, `receiving-code-review`.
- **Spec → Plan → Code**: non-trivial features get a spec before a plan (spec = design: problem, alternatives, decisions, tradeoffs; plan = task breakdown). Spec required when the feature touches >3 files, OR changes auth/data model/public URLs, OR introduces a new pattern. Plan steps = write code → commit (no TDD ceremony). One review pass (`simplify` or review agent) at end of feature, not per-task.
- **Paths** — NEVER create `docs/superpowers/`:
  - Plans → `docs/plans/{active,completed,deprecated}/YYYY-MM-DD-<feature>.md`
  - Specs → `docs/plans/specs/{active,completed,deprecated}/YYYY-MM-DD-<topic>-design.md`
  - Testing docs → `docs/testing/YYYY-MM-DD-<topic>.md`
  - Mockups → `docs/mockups/YYYY-MM-DD-<topic>/` (entry `index.html`) — in-repo, never OS temp
  - Ideas → `docs/plans/ideas.md`
- **Shipping ritual**: when tsc/biome pass on the final commit, the next action same turn is `git mv` the plan to `completed/` + closing marker + ship commit — manual QA goes in the `Open:` line, never a pre-ship gate; silence = confirmed; on regression, fix forward. Always `git mv` (preserve history). Closing marker:

  ```markdown
  **Completed: YYYY-MM-DD**
  - Verified: <what actually ran — tsc, biome, build, grep sweep, etc.>
  - Open: <what wasn't checked — e.g. manual browser QA — silence = confirmed>
  ```

## Reference

- `docs/plans/active/2026-03-14-nextjs-to-tanstack-start-migration.md` — the ongoing Next.js → TanStack Start migration plan (+ its design spec in `docs/plans/specs/active/`).
- `docs/plans/specs/active/2026-07-24-database-replacement-design.md` — open decision: PlanetScale free-tier replacement.
