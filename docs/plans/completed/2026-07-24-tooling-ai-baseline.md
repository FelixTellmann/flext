# Tooling + AI Baseline (listify port) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port listify's Claude/AI documentation setup, upgrade-packages workflow, TypeScript 7 (native) strict tsconfig, and Biome config into flext (single-package TanStack Start app), so future features start from a clean, verified baseline.

**Architecture:** flext is a single-package Bun repo (no workspaces): `src/` (routes/components/stores/styles), `server/` (auth/db/orpc), `content/` (page content as TSX modules), `utils/`, `@types/`. All listify monorepo mechanics (workspace filters, per-package tsconfigs, `@listify/*` paths) collapse into single root configs.

**Tech Stack:** Bun, TanStack Start + Vite 7, TypeScript 7 (native `tsc`), Biome 2.5+, Tailwind 3.4 (held), Drizzle + MySQL (PlanetScale), ORPC, Zod 3 (held).

## Global Constraints

- Decisions locked by user (2026-07-24): match listify upgrade holds **plus hold `zod`**; flip to **full strict + `verbatimModuleSyntax` now** and fix all errors; **full workflow port** (plans lifecycle + settings + CLAUDE.md); full housekeeping cleanup **but keep** `nextjs-site.png` / `tanstack-site.png`.
- Work happens directly on branch `migration/tanstack-start` (user-approved). NEVER push to `main`/`master`.
- `git add` specific files by name only — never `git add -A` / `git add .`. Verify staged set with `git diff --cached --name-status` before each commit.
- No `Co-Authored-By` trailers in commits. Commit message style: `<type>: <summary>` matching recent history (`fix:`, `feat:`, `chore:`, `docs:`).
- Never start dev servers (`bun run dev`). Verification gate = `bun run tsc` + `bunx biome check` + `bun run build`.
- Never run `bun run db:push` / `db:migrate` — the DATABASE_URL points at the live flext.dev database.
- TypeScript: no `any` escapes when fixing strict errors — type properly, use `unknown` + narrowing where needed.
- Upgrade holds (ncu `-x` list): `tailwindcss`, `@types/react`, `@types/react-dom`, `vite-tsconfig-paths`, `zod`.

---

### Task 1: Docs workflow structure

**Files:**
- Create: `docs/plans/ideas.md`
- Move: `docs/superpowers/plans/2026-03-14-nextjs-to-tanstack-start-migration.md` → `docs/plans/active/`
- Move: `docs/superpowers/specs/2026-03-14-nextjs-to-tanstack-start-migration-design.md` → `docs/plans/specs/active/`

**Interfaces:**
- Produces: the `docs/plans/{active,completed,deprecated}` + `docs/plans/specs/{active,completed,deprecated}` lifecycle used by Task 7's CLAUDE.md and Task 8's ship ritual.

- [ ] **Step 1: Create structure and move existing docs (history-preserving)**

```bash
mkdir -p docs/plans/active docs/plans/completed docs/plans/deprecated docs/plans/specs/active docs/plans/specs/completed docs/plans/specs/deprecated docs/testing docs/mockups
git mv docs/superpowers/plans/2026-03-14-nextjs-to-tanstack-start-migration.md docs/plans/active/
git mv docs/superpowers/specs/2026-03-14-nextjs-to-tanstack-start-migration-design.md docs/plans/specs/active/
rmdir docs/superpowers/plans docs/superpowers/specs docs/superpowers 2>/dev/null || true
```

If `rmdir` fails, list leftover files in `docs/superpowers/` and `git mv` them to the matching new location before removing the dir.

- [ ] **Step 2: Create `docs/plans/ideas.md`**

```markdown
# Ideas

Unsorted backlog. One bullet per idea; date + one-line summary. Promote to a spec/plan in `docs/plans/` when picked up.
```

- [ ] **Step 3: Commit**

```bash
git add docs/plans docs/superpowers 2>/dev/null; git add docs/plans/ideas.md
git diff --cached --name-status
git commit -m "docs: adopt plans/specs lifecycle structure, retire docs/superpowers" -- docs
```

(This plan file itself — `docs/plans/active/2026-07-24-tooling-ai-baseline.md` — is included in the `-- docs` pathspec; that is intended.)

---

### Task 2: .gitignore rewrite + tracked-stray cleanup

**Files:**
- Rewrite: `.gitignore`
- Delete (tracked): `flext.iml`, `TODO_tmp.md` (after salvage), stale `.next/` (untracked dir on disk)
- Keep: `nextjs-site.png`, `tanstack-site.png` (user decision)

- [ ] **Step 1: Salvage TODO_tmp.md**

Read `TODO_tmp.md`. If it contains live ideas/tasks, append them as dated bullets to `docs/plans/ideas.md`. If it is stale migration scratch, skip. Then `git rm TODO_tmp.md`.

- [ ] **Step 2: Rewrite `.gitignore`** (full replacement; commented like listify's):

```gitignore
# Dependencies
node_modules/

# Build output
.output/
.nitro/
.tanstack/
.vinxi/
dist/
build/
out/
# Stale Next.js output from pre-migration — dir deleted, kept ignored defensively
.next/

# Generated
src/routeTree.gen.ts
*.tsbuildinfo
# Local-only Shopify schema dump (used ad hoc for the tweets/shop API work)
shopify.graphql

# Env & secrets
.env
.env.*
.secret-*
# Local dev TLS certs (mkcert) — never commit private keys
*.pem
firebaseAdminKey.json

# IDE / OS
.idea/
*.iml
.DS_Store

# Claude working state (settings + skills stay tracked)
.claude/worktrees/
.claude/state/
.claude/tmp/
.superpowers/

# Deploy
.vercel

# Legacy tooling caches (pre-migration leftovers)
.contentlayer
.linaria-cache
.swc
warehouse
```

Note: `.env.*` covers `.env.local`, `.env.development`, `.env.production`, `.env*.local` from the old file. The amplify/aws block is dropped — no amplify files exist in the repo (verify with `ls amplify aws-exports.js 2>/dev/null` first; if anything exists, keep those lines).

- [ ] **Step 3: Remove tracked strays + stale artifacts**

```bash
git rm --cached flext.iml
git rm -r --cached .idea 2>/dev/null || true
rm -rf .next tsconfig.tsbuildinfo
```

(`flext.iml` stays on disk for IntelliJ — `--cached` only. `.next/` and `tsconfig.tsbuildinfo` are untracked build artifacts; safe to delete.)

- [ ] **Step 4: Verify + commit**

```bash
git status --short
git add .gitignore TODO_tmp.md flext.iml docs/plans/ideas.md
git diff --cached --name-status
git commit -m "chore: rewrite .gitignore (commented, TanStack-era), drop tracked IDE/stray files" -- .gitignore TODO_tmp.md flext.iml docs/plans/ideas.md
```

Expected `git status` after: `nextjs-site.png`/`tanstack-site.png` still tracked, `flext.iml` now untracked-and-ignored.

---

### Task 3: Dependency housekeeping + upgrade-packages

**Files:**
- Modify: `package.json` (scripts, devDependencies, packageManager)
- Modify: `vite.config.ts` (remove scss preprocessor block)
- Regenerated: `bun.lock`

**Interfaces:**
- Produces: `bun run upgrade-packages` script; `typescript@^7` installed (Task 4 depends on it); `@biomejs/biome` at latest (Task 5 depends on it).

- [ ] **Step 1: Remove dead sass stack**

```bash
bun remove sass
```

Read `vite.config.ts` and delete the `css.preprocessorOptions` scss block (the `modern-compiler` config, ~lines 23-30). Zero `.scss` files exist in the repo — verified during recon.

- [ ] **Step 2: Add upgrade tooling + packageManager field**

```bash
bun add -d npm-check-updates
```

In `package.json` add top-level field (after `"type"`):

```json
"packageManager": "bun@1.x",
```

Add script (listify's, minus `--workspaces --root`, with flext's hold list):

```json
"upgrade-packages": "ncu --upgrade -x tailwindcss,@types/react,@types/react-dom,vite-tsconfig-paths,zod && bun install"
```

- [ ] **Step 3: Run the upgrade**

```bash
bun run upgrade-packages
```

Expected: `typescript` → `^7.x` (the native compiler ships as the plain `typescript` package — same as listify's `"typescript": "^7.0.2"`), `@biomejs/biome` → `2.5.x`, react → `19.2.x`, `@tanstack/*` → latest 1.x, vite/drizzle/orpc bumps. `nitro`: ncu moves prerelease → latest in its channel or stable if released; if it lands on something that breaks the build in Step 4, pin back to `^3.0.1-alpha.2` and add `nitro` to the `-x` list with a comment-free hold (record the reason in the plan's Completed marker instead).

- [ ] **Step 4: Verify against the still-lax tsconfig (bisect point: upgrades green before strict flip)**

```bash
bun run tsc
bun run build
```

Both must pass. Fix any upgrade-caused breakage now (API renames in bumped packages etc.) — do NOT start strict-mode fixes yet.

- [ ] **Step 5: Commit**

```bash
git add package.json bun.lock vite.config.ts
git diff --cached --name-status
git commit -m "chore: add upgrade-packages workflow, upgrade deps (TS7, held: tailwind/zod/react-types), drop sass" -- package.json bun.lock vite.config.ts
```

---

### Task 4: TypeScript 7 strict tsconfig + error fixes

**Files:**
- Rewrite: `tsconfig.json`
- Create: `reset.d.ts` (ts-reset)
- Modify: `package.json` (tsc script), any source files with strict errors

**Interfaces:**
- Consumes: `typescript@^7` from Task 3.
- Produces: green `bun run tsc` under full strict — the gate every later task and future feature relies on.

- [ ] **Step 1: Add ts-reset (matches listify)**

```bash
bun add -d @total-typescript/ts-reset
```

Create `reset.d.ts` at repo root:

```typescript
import "@total-typescript/ts-reset";
```

- [ ] **Step 2: Rewrite `tsconfig.json`** (listify base + app-level flags, flext paths kept):

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "lib": ["DOM", "ESNext", "DOM.Iterable"],

    "noEmit": true,
    "isolatedModules": true,
    "incremental": true,
    "skipLibCheck": true,
    "skipDefaultLibCheck": true,

    "strict": true,
    "verbatimModuleSyntax": true,
    "forceConsistentCasingInFileNames": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "resolveJsonModule": true,

    "baseUrl": ".",
    "paths": {
      "~/*": ["src/*"],
      "@server/*": ["server/*"],
      "types/*": ["./@types/*"],
      "content/*": ["content/*"],
      "utils/*": ["utils/*"]
    },
    "types": ["node", "vite-plugin-svgr/client"]
  },
  "include": ["**/*.ts", "**/*.tsx", "**/*.mjs", "**/*.js"],
  "exclude": ["node_modules", ".output", ".nitro", ".tanstack", "content/code-blocks"]
}
```

(Changes vs current: `strict: false`→`true` — drops the now-redundant `strictNullChecks` line, adds `verbatimModuleSyntax`, `skipDefaultLibCheck`, target ES2022→ESNext, excludes `.nitro`/`.tanstack`.)

- [ ] **Step 3: Switch tsc script to listify's form**

In `package.json`: `"tsc": "tsc --extendedDiagnostics"` (replaces `"tsc --noEmit"`; `noEmit` now lives in tsconfig).

- [ ] **Step 4: Fix all strict errors until green**

```bash
bun run tsc 2>&1 | head -100
```

Fix by category, re-running after each batch:
1. `verbatimModuleSyntax` violations → convert to `import type { X }` / `export type`.
2. Implicit `any` params/returns → add real types (props via `FC<{...}>`, handlers via React event types, drizzle rows via `typeof table.$inferSelect`).
3. Possibly-undefined index/null access newly caught → narrow with guards, never `!` unless invariant is provable (biome has `noNonNullAssertion` off, so `!` is allowed where genuinely safe).
4. Also fix the ~6 pre-existing `: any`/`as any` occurrences in `src`/`server`/`utils` while in there — the no-`any` rule is now enforced by `strict`.

Constraint: behavior-preserving type fixes only. If a fix would require a logic change, note it in the plan's Completed marker `Open:` line instead of changing behavior silently.

- [ ] **Step 5: Verify + commit**

```bash
bun run tsc
bun run build
git status --short
```

Stage `tsconfig.json`, `reset.d.ts`, `package.json`, `bun.lock`, and each fixed source file **by name**:

```bash
git add tsconfig.json reset.d.ts package.json bun.lock <fixed files...>
git diff --cached --name-status
git commit -m "feat: TS7 full strict + verbatimModuleSyntax, ts-reset, fix all strict errors" -- tsconfig.json reset.d.ts package.json bun.lock <fixed files...>
```

---

### Task 5: Biome config port

**Files:**
- Rewrite: `biome.json`

**Interfaces:**
- Consumes: `@biomejs/biome@2.5.x` from Task 3.
- Produces: the `bunx biome check` gate referenced by CLAUDE.md (Task 7).

- [ ] **Step 1: Rewrite `biome.json`** — listify's config verbatim, with flext-specific `files.includes`/`linter.includes`:

```json
{
  "$schema": "./node_modules/@biomejs/biome/configuration_schema.json",
  "css": {
    "parser": {
      "tailwindDirectives": true
    }
  },
  "vcs": {
    "enabled": true,
    "clientKind": "git",
    "useIgnoreFile": true
  },
  "files": {
    "ignoreUnknown": false,
    "includes": [
      "**",
      "!**/*.graphql",
      "!**/@types/**/*.*",
      "!src/routeTree.gen.ts",
      "!content/code-blocks/**/*.*",
      "!server/db/migrations/**/*.*",
      "!.output/**/*.*",
      "!public/**/*.*"
    ],
    "maxSize": 2621440
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "lineWidth": 140,
    "formatWithErrors": true
  },
  "assist": { "actions": { "source": { "organizeImports": "on" } } },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "nursery": {
        "useSortedClasses": {
          "level": "warn",
          "fix": "safe"
        }
      },
      "style": {
        "noParameterAssign": "off",
        "noNonNullAssertion": "off",
        "noUnusedTemplateLiteral": { "level": "error", "fix": "safe" },
        "useSelfClosingElements": { "level": "error", "fix": "safe" },
        "useTemplate": { "level": "warn", "fix": "safe" },
        "useNodejsImportProtocol": { "level": "warn", "fix": "safe" },
        "useAsConstAssertion": "error",
        "useDefaultParameterLast": "error",
        "useEnumInitializers": "error",
        "useSingleVarDeclarator": "error",
        "useNumberNamespace": "error",
        "noInferrableTypes": "error",
        "noUselessElse": "error"
      },
      "complexity": {
        "noForEach": "off",
        "noUselessCatch": { "level": "error", "fix": "safe" },
        "noUselessTernary": { "level": "warn", "fix": "safe" },
        "useOptionalChain": { "level": "error", "fix": "safe" }
      },
      "a11y": {
        "useKeyWithClickEvents": "off",
        "noSvgWithoutTitle": "info"
      },
      "security": {
        "noDangerouslySetInnerHtml": "off"
      },
      "suspicious": {
        "noExplicitAny": "warn",
        "noArrayIndexKey": "info",
        "noAssignInExpressions": "info",
        "noGlobalIsNan": { "level": "warn", "fix": "safe" }
      },
      "correctness": {
        "useExhaustiveDependencies": { "level": "warn" },
        "noUnusedVariables": "off",
        "noUnusedFunctionParameters": "off",
        "noUnusedImports": "off",
        "noUnusedLabels": "off",
        "noUnusedPrivateClassMembers": "off",
        "useUniqueElementIds": "off"
      }
    }
  },
  "javascript": {
    "formatter": {
      "quoteStyle": "double"
    }
  }
}
```

(Diffs vs listify: monorepo `!packages/...` ignores replaced with flext's generated/vendored paths; dropped `"globals": ["_"]` — flext has no lodash global; dropped the `linter.includes` zod-gen carve-out — no equivalent.)

- [ ] **Step 2: Run full check, apply safe fixes, review the diff**

```bash
bun run check
git diff --stat
```

Review the diff file-by-file (`git diff` per file for anything surprising). Expect churn from `useSortedClasses`, `organizeImports`, self-closing elements. Remaining warnings (`noExplicitAny`, `useExhaustiveDependencies`) are acceptable; remaining **errors** must be fixed by hand.

- [ ] **Step 3: Re-verify tsc still green (organizeImports can drop type-only imports wrongly)**

```bash
bun run tsc && bun run build
```

- [ ] **Step 4: Commit**

```bash
git add biome.json <changed files...>
git diff --cached --name-status
git commit -m "chore: port listify biome config (rules + organize-imports), apply safe fixes" -- biome.json <changed files...>
```

---

### Task 6: .claude settings (permissions + mode)

**Files:**
- Create: `.claude/settings.json`
- Modify: `.claude/settings.local.json` (merge — read existing first, keep its entries)

- [ ] **Step 1: Create minimal shared `.claude/settings.json`**

```json
{
  "$schema": "https://json.schemastore.org/claude-code-settings.json"
}
```

- [ ] **Step 2: Merge `.claude/settings.local.json`**

Read the existing file (has a small allowlist: `cd`, `npm list`, localhost curl). Produce a merged file: existing `allow` entries kept, plus base allow set, deny list, and default mode:

```json
{
  "permissions": {
    "allow": [
      "<existing entries kept verbatim>",
      "Read", "Glob", "Grep",
      "Bash(bun run *)", "Bash(bunx *)", "Bash(npx *)", "Bash(node *)",
      "Bash(git status*)", "Bash(git diff*)", "Bash(git log*)", "Bash(git branch*)",
      "Bash(git add *)", "Bash(git commit *)", "Bash(git checkout *)", "Bash(git mv *)",
      "Bash(git pull*)", "Bash(gh *)",
      "WebSearch",
      "WebFetch(domain:tanstack.com)", "WebFetch(domain:github.com)",
      "WebFetch(domain:biomejs.dev)", "WebFetch(domain:orpc.unnoq.com)"
    ],
    "deny": [
      "Bash(rm -rf *)",
      "Bash(git reset --hard *)",
      "Bash(git push --force *)",
      "Bash(git push -f *)",
      "Bash(sudo *)",
      "Bash(git push origin main)",
      "Bash(git push origin master)",
      "Bash(git push main)",
      "Bash(git push master)",
      "Bash(git push -u origin main)",
      "Bash(git push -u origin master)",
      "Bash(git push --set-upstream origin main)",
      "Bash(git push --set-upstream origin master)"
    ]
  },
  "defaultMode": "acceptEdits"
}
```

- [ ] **Step 3: Commit**

```bash
git add .claude/settings.json .claude/settings.local.json
git diff --cached --name-status
git commit -m "chore: add Claude settings — safety deny-list, base allowlist, acceptEdits" -- .claude/settings.json .claude/settings.local.json
```

---

### Task 7: CLAUDE.md

**Files:**
- Create: `CLAUDE.md`

**Interfaces:**
- Consumes: scripts from Task 3/4, biome gate from Task 5, docs lifecycle from Task 1.

- [ ] **Step 1: Write `CLAUDE.md`** (full content — adapt only if earlier tasks changed a referenced script name):

````markdown
# CLAUDE.md

Personal site + blog of Felix Tellmann — live at https://flext.dev. TanStack Start + Vite + Bun, single-package repo (no workspaces). MySQL (PlanetScale) via Drizzle, API via ORPC, auth is custom JWT (jose) under `server/auth/`.

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

`DATABASE_URL` points at the **live flext.dev database**. Never run `bun run db:push`, `db:migrate`, or raw DML. Schema changes: edit `server/db/schema.ts`, run `bun run db:generate`, keep implementing against the new types, and surface the generated SQL (in `server/db/migrations/`) for the user to apply.

## Critical: Git

- Never `git add -A` / `git add .` — add specific files by name; check `git diff --cached --name-status` before committing.
- Never push to `main`/`master`.

## Generated code — exempt from style/convention checks

Never hand-edit, never flag in audits or simplify/review passes:
- `src/routeTree.gen.ts` (TanStack Router, gitignored)
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
- **Exports**: Named exports only, never `export default`. (Exception: config files and route files where the framework requires it.)
- **Tailwind — check the config FIRST**: Before writing any sized/colored class, grep `tailwind.config.mjs` for an existing token. Drop to bracketed arbitrary (`text-[13px]`) ONLY after confirming no config token matches. Bare `Npx` suffixes (`gap-8px`) are invalid Tailwind — config token or bracketed arbitrary, never the bare form.
- **classNames**: `cn()` (tailwind-merge/clsx) directly in the JSX prop for dynamic classes — never template literals or extracted variables.
- **State**: shared state goes through the store factory in `src/stores/` (`_make-store.tsx`, seeded via `_load-initial-data.tsx`) — follow that pattern, don't add bare `zustand` `create()` stores. Filter/sort/search/pagination state lives in URL params, not stores.
- **Route files**: `_prefix` = pathless layout group, `$param` = dynamic segment, `-prefix` = private (non-route) file, `api/` = server-only handlers.
- **Content**: page copy/data lives in `content/*.tsx` as typed modules — edit there, not inline in routes.

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
````

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git diff --cached --name-status
git commit -m "docs: add CLAUDE.md — conventions, critical rules, superpowers workflow" -- CLAUDE.md
```

---

### Task 8: Final verification + ship

- [ ] **Step 1: Full gate**

```bash
bun run tsc
bun run check
bun run build
git status --short
```

All three green; status shows no unexpected untracked/modified files.

- [ ] **Step 2: Ship ritual (per the just-adopted convention)**

```bash
git mv docs/plans/active/2026-07-24-tooling-ai-baseline.md docs/plans/completed/
```

Append closing marker to the moved file:

```markdown
**Completed: 2026-07-24**
- Verified: bun run tsc (TS7 strict), bun run check (biome), bun run build, staged-file review per commit
- Open: manual browser QA of the site after dep upgrades; nitro version decision if pinned back
```

```bash
git add docs/plans/completed/2026-07-24-tooling-ai-baseline.md
git diff --cached --name-status
git commit -m "docs: complete tooling + AI baseline plan" -- docs/plans
```

---

## Self-Review Notes

- All four user decisions are encoded in Global Constraints and the relevant tasks (holds incl. zod → Task 3; strict+VMS → Task 4; full workflow → Tasks 1/6/7; cleanup-keep-PNGs → Task 2).
- Task ordering puts the dependency upgrade (3) before the strict flip (4) so strict fixes happen once, against final versions, with a green bisect point between them.
- `strictNullChecks` removed as redundant under `strict: true`; `noEmit` moved fully into tsconfig so the script drops `--noEmit`.
- Biome ignore globs verified against real flext paths (`content/code-blocks` is also tsconfig-excluded; `server/db/migrations` is drizzle output).

**Completed: 2026-07-24**
- Verified: bun run tsc (TS7 native, full strict + verbatimModuleSyntax, exit 0), bunx biome check (0 errors; 15 warnings/53 infos accepted signal), bun run build (Vite 8 + nitro, green; CSS output byte-identical through the biome pass), git diff --cached --name-status review per commit.
- Open: manual browser QA of the live site after the dependency upgrades (React 19.2.8, Vite 8, TanStack latest, nitro 3.0.260610-beta); react-tooltip held at v4 + tailwind v3 + zod v3 migrations tracked in ideas.md; database replacement decision (specs/active/2026-07-24-database-replacement-design.md).
