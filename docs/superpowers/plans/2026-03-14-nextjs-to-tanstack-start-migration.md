# Next.js to TanStack Start Migration — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate flext from Next.js 12 to TanStack Start while preserving all features, components, and visual output identically.

**Architecture:** Flat project (no monorepo) with TanStack Start + Vinxi/Nitro on Bun. Source under `src/`, server code under `server/`. Drizzle ORM for MySQL/PlanetScale, ORPC for type-safe API, custom JWT auth, Biome for linting/formatting.

**Tech Stack:** TanStack Start, TanStack Router, React 19, Vite, Nitro (bun preset), Drizzle ORM (mysql2), ORPC, jose (JWT), Biome, Bun, Tailwind CSS 3

**Spec:** `docs/superpowers/specs/2026-03-14-nextjs-to-tanstack-start-migration-design.md`

**Reference project:** `C:/development/listify` — use for config patterns and API usage examples.

---

## Chunk 1: Project Scaffold & Tooling

### Task 1: Initialize Bun project and install core dependencies

**Files:**
- Create: `package.json` (overwrite existing)
- Create: `bunfig.toml`
- Create: `biome.json`
- Delete: `pnpm-lock.yaml`, `.eslintrc.js`, `.prettierrc.js`

- [ ] **Step 1: Create a new git branch for the migration**

```bash
git checkout -b migration/tanstack-start
```

- [ ] **Step 2: Remove old tooling config files**

Delete these files:
- `.eslintrc.js`
- `.prettierrc.js`
- `pnpm-lock.yaml`
- `next.config.js`
- `next-env.d.ts`
- `next-sitemap.config.js`
- `vercel.json`
- `tsconfig.examples.json`

Keep `package.json` — we'll overwrite it next.

- [ ] **Step 3: Write new `package.json`**

```json
{
  "name": "flext",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite dev",
    "build": "vite build",
    "start": "bun run .output/server/index.mjs",
    "format": "biome format --write .",
    "lint": "biome lint .",
    "check": "biome check --write .",
    "tsc": "tsc --noEmit",
    "db:generate": "drizzle-kit generate",
    "db:push": "drizzle-kit push",
    "db:pull": "drizzle-kit introspect",
    "db:studio": "drizzle-kit studio --port 3010",
    "db:migrate": "drizzle-kit migrate"
  },
  "dependencies": {
    "@heroicons/react": "^2.2.0",
    "@orpc/client": "^1.13.6",
    "@orpc/server": "^1.13.6",
    "@orpc/tanstack-query": "^1.13.6",
    "@radix-ui/react-slot": "^1.1.2",
    "@react-icons/all-files": "^4.1.0",
    "@tailwindcss/aspect-ratio": "^0.4.2",
    "@tailwindcss/forms": "^0.5.9",
    "@tailwindcss/line-clamp": "^0.4.4",
    "@tailwindcss/typography": "^0.5.15",
    "@tanstack/react-query": "^5.90.21",
    "@tanstack/react-router": "^1.166.7",
    "@tanstack/react-router-devtools": "^1.166.7",
    "@tanstack/react-router-ssr-query": "^1.166.7",
    "@tanstack/react-start": "^1.166.7",
    "autoprefixer": "^10.4.20",
    "bcrypt": "^6.0.0",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "drizzle-orm": "^0.45.1",
    "framer-motion": "^11.18.0",
    "jose": "^6.2.1",
    "mini-svg-data-uri": "^1.4.4",
    "mysql2": "^3.14.1",
    "nitro": "^3.0.1-alpha.2",
    "nodemailer": "^6.10.0",
    "party-js": "^2.2.0",
    "postcss": "^8.4.49",
    "postcss-import": "^16.1.0",
    "react": "^19.2.4",
    "react-dom": "^19.2.4",
    "react-tooltip": "^4.5.1",
    "sass": "^1.83.0",
    "short-uuid": "^5.2.0",
    "superjson": "^2.2.6",
    "tailwind-children": "^2.2.0",
    "tailwind-gradient-mask-image": "^1.2.0",
    "tailwind-merge": "^3.5.0",
    "tailwindcss": "^3.4.17",
    "twitter-api-sdk": "^1.2.1",
    "type-fest": "^4.34.0",
    "validator": "^13.12.0",
    "zod": "^3.24.0",
    "zustand": "^5.0.11"
  },
  "devDependencies": {
    "@biomejs/biome": "^2.4.6",
    "@types/bcrypt": "^5.0.2",
    "@types/node": "^22.0.0",
    "@types/nodemailer": "^6.4.17",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@types/validator": "^13.12.2",
    "@vitejs/plugin-react": "^4.3.4",
    "drizzle-kit": "^0.31.9",
    "tsx": "^4.21.0",
    "typescript": "^5.9.3",
    "vite": "^7.3.1",
    "vite-plugin-svgr": "^4.3.0",
    "vite-tsconfig-paths": "^5.1.4"
  }
}
```

- [ ] **Step 4: Write `bunfig.toml`**

```toml
[install]
linker = "isolated"
```

- [ ] **Step 5: Write `biome.json`**

Reference: `C:/development/listify/biome.json`

```json
{
  "$schema": "./node_modules/@biomejs/biome/configuration_schema.json",
  "vcs": {
    "enabled": true,
    "clientKind": "git",
    "useIgnoreFile": true
  },
  "files": {
    "ignoreUnknown": false,
    "maxSize": 2621440,
    "includes": ["**/*"],
    "excludes": [
      "**/@types/**/*.*",
      ".output/**/*.*"
    ]
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "lineWidth": 140,
    "formatWithErrors": true
  },
  "javascript": {
    "formatter": {
      "quoteStyle": "double"
    }
  },
  "css": {
    "parser": {
      "tailwindDirectives": true
    }
  },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "nursery": {
        "useSortedClasses": { "level": "warn", "fix": "safe" }
      },
      "style": {
        "noParameterAssign": "off",
        "noNonNullAssertion": "off",
        "useAsConstAssertion": "error",
        "useDefaultParameterLast": "error",
        "useSingleVarDeclarator": "error",
        "useNumberNamespace": "error",
        "noInferrableTypes": "error",
        "noUselessElse": "error"
      },
      "complexity": {
        "noForEach": "off",
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
        "noArrayIndexKey": "info"
      },
      "correctness": {
        "useExhaustiveDependencies": { "level": "warn" },
        "noUnusedVariables": "off",
        "noUnusedFunctionParameters": "off",
        "noUnusedImports": "off"
      }
    }
  },
  "assist": {
    "actions": {
      "source": {
        "organizeImports": "on"
      }
    }
  }
}
```

- [ ] **Step 6: Run `bun install`**

```bash
bun install
```

- [ ] **Step 7: Commit scaffold**

```bash
git add package.json bunfig.toml biome.json bun.lock
git add -u  # stages deletions of removed files
git commit -m "chore: scaffold Bun + Biome, remove Next.js/ESLint/Prettier config"
```

---

### Task 2: Set up TypeScript, Vite, and TanStack Start config

**Files:**
- Create: `tsconfig.json` (overwrite)
- Create: `vite.config.ts`
- Create: `tsr.config.json`
- Modify: `tailwind.config.js` → `tailwind.config.mjs`
- Modify: `postcss.config.js` → `postcss.config.mjs`

- [ ] **Step 1: Write `tsconfig.json`**

Reference: `C:/development/listify/apps/app/tsconfig.json` + `C:/development/listify/tsconfig.base.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "lib": ["DOM", "ESNext", "DOM.Iterable"],
    "strict": false,
    "strictNullChecks": true,
    "noEmit": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "incremental": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "baseUrl": ".",
    "paths": {
      "~/*": ["src/*"],
      "@server/*": ["server/*"],
      "types/*": ["./@types/*"],
      "content/*": ["content/*"],
      "utils/*": ["utils/*"]
    },
    "types": ["node", "react"]
  },
  "include": [
    "**/*.ts",
    "**/*.tsx",
    "**/*.mjs",
    "**/*.js"
  ],
  "exclude": [
    "node_modules",
    ".output",
    "content/code-blocks"
  ]
}
```

- [ ] **Step 2: Write `vite.config.ts`**

Reference: `C:/development/listify/apps/app/vite.config.ts`

```typescript
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";
import svgr from "vite-plugin-svgr";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [
    tsconfigPaths(),
    svgr(),
    tanstackStart({
      router: {
        disableLogging: true,
      },
    }),
    nitro({ preset: "bun" }),
    viteReact(),
  ],
  server: {
    port: 3000,
  },
  css: {
    preprocessorOptions: {
      scss: {
        api: "modern-compiler",
      },
    },
  },
});
```

- [ ] **Step 3: Write `tsr.config.json`**

```json
{
  "rootDirectory": ".",
  "routeFileIgnorePrefix": "-",
  "routesDirectory": "./src/routes",
  "generatedRouteTree": "./src/routeTree.gen.ts"
}
```

- [ ] **Step 4: Rename and migrate `tailwind.config.js` → `tailwind.config.mjs`**

Rename the file from `.js` to `.mjs`. Update the `content` paths:

Change:
```javascript
content: [
  "./pages/**/*.{js,ts,jsx,tsx}",
  "./components/**/*.{js,ts,jsx,tsx}",
  "./content/**/*.{js,ts,jsx,tsx}",
  "./client/**/*.{js,ts,jsx,tsx}",
  "./_client/**/*.{js,ts,jsx,tsx}",
  "./update/**/*.{js,ts,jsx,tsx}",
],
```

To:
```javascript
content: [
  "./src/**/*.{js,ts,jsx,tsx}",
  "./content/**/*.{js,ts,jsx,tsx}",
],
```

Change `module.exports =` to `export default` at the top and bottom. Change all `require()` calls to `import` at the top of the file. Key ones:
- `const svgToDataUri = require("mini-svg-data-uri")` → `import svgToDataUri from "mini-svg-data-uri"`
- `const plugin = require("tailwindcss/plugin")` → `import plugin from "tailwindcss/plugin"`
- Any other `require()` calls → convert to ESM `import`

- [ ] **Step 5: Rename and migrate `postcss.config.js` → `postcss.config.mjs`**

```javascript
export default {
  plugins: {
    "postcss-import": {},
    "tailwindcss/nesting": {},
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

- [ ] **Step 6: Commit config**

```bash
git add tsconfig.json vite.config.ts tsr.config.json tailwind.config.mjs postcss.config.mjs
git rm tailwind.config.js postcss.config.js
git commit -m "chore: add Vite, TanStack Start, TypeScript, Tailwind, PostCSS configs"
```

---

### Task 3: Set up environment validation

**Files:**
- Create: `env.ts`

- [ ] **Step 1: Write `env.ts`**

Reference: `C:/development/listify/env.ts` for pattern, `C:/development/flext/server/trpc/env.js` for actual variables.

```typescript
import { z } from "zod";

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

  // Auth
  JWT_SECRET: z.string(),
  SCRIPT_SECRET: z.string(),

  // OAuth - GitHub
  GITHUB_APP_ID: z.string(),
  GITHUB_ID: z.string(),
  GITHUB_SECRET: z.string(),

  // OAuth - Google
  GOOGLE_CLIENT_ID: z.string(),
  GOOGLE_CLIENT_SECRET: z.string(),

  // OAuth - Twitter
  TWITTER_CLIENT_ID: z.string(),
  TWITTER_CLIENT_SECRET: z.string(),
  TWITTER_CLIENT_BEARER_TOKEN: z.string(),
  TWITTER_CLIENT_ID_2022_08: z.string(),
  TWITTER_CLIENT_SECRET_2022_08: z.string(),

  // OAuth - Facebook
  FACEBOOK_CLIENT_ID: z.string(),
  FACEBOOK_CLIENT_SECRET: z.string(),
  FACEBOOK_CLIENT_PROD_ID: z.string(),
  FACEBOOK_CLIENT_PROD_SECRET: z.string(),

  // Email (magic link)
  EMAIL_SERVER_USER: z.string(),
  EMAIL_SERVER_PASSWORD: z.string(),
  EMAIL_SERVER_HOST: z.string(),
  EMAIL_SERVER_PORT: z.string(),
  EMAIL_FROM: z.string(),

  // Public
  VITE_PUBLIC_APP_VERSION: z.string(),
  VITE_PUBLIC_HOSTNAME: z.string(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables:", JSON.stringify(parsed.error.format(), null, 4));
  process.exit(1);
}

export const env = parsed.data;
```

- [ ] **Step 2: Update `.env.local`**

Rename `NEXTAUTH_SECRET` → add `JWT_SECRET` (same value). Add `VITE_PUBLIC_APP_VERSION` and `VITE_PUBLIC_HOSTNAME` (same values as the old `NEXT_PUBLIC_*` versions). Keep all existing vars as-is.

- [ ] **Step 3: Commit**

```bash
git add env.ts .env.local
git commit -m "chore: add Zod environment validation"
```

---

## Chunk 2: Database — Prisma to Drizzle

### Task 4: Create Drizzle schema from Prisma models

**Files:**
- Create: `server/db/schema.ts`
- Create: `server/db/relations.ts`
- Create: `server/db/drizzle.ts`
- Create: `drizzle.config.ts`

- [ ] **Step 1: Create directory structure**

```bash
mkdir -p server/db
```

- [ ] **Step 2: Write `drizzle.config.ts`**

```typescript
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./server/db/schema.ts",
  out: "./server/db/migrations",
  dialect: "mysql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
```

- [ ] **Step 3: Write `server/db/schema.ts`**

Translate all 15 Prisma models. Reference the Prisma schema at `prisma/schema.prisma`. **Important:** No `.references()` calls — PlanetScale/Vitess does not support FK constraints.

```typescript
import { mysqlTable, varchar, text, int, float, boolean, datetime, uniqueIndex, primaryKey } from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";

// ============ Auth Tables ============

export const user = mysqlTable("User", {
  id: varchar("id", { length: 191 }).primaryKey(),
  name: varchar("name", { length: 191 }),
  email: varchar("email", { length: 191 }).unique(),
  emailVerified: datetime("emailVerified", { fsp: 3 }),
  password: varchar("password", { length: 191 }),
  image: varchar("image", { length: 191 }),
  registeredAt: datetime("registeredAt", { fsp: 3 }).default(sql`CURRENT_TIMESTAMP(3)`),
  acceptMarketing: boolean("acceptMarketing").default(true),
});

export const account = mysqlTable(
  "Account",
  {
    id: varchar("id", { length: 191 }).primaryKey(),
    userId: varchar("userId", { length: 191 }).notNull(),
    type: varchar("type", { length: 191 }).notNull(),
    provider: varchar("provider", { length: 191 }).notNull(),
    providerAccountId: varchar("providerAccountId", { length: 191 }).notNull(),
    refreshToken: text("refreshToken"),
    refreshTokenExpiresIn: int("refreshTokenExpiresIn"),
    accessToken: text("accessToken"),
    expiresAt: int("expiresAt"),
    tokenType: varchar("tokenType", { length: 191 }),
    scope: varchar("scope", { length: 191 }),
    idToken: text("idToken"),
    sessionState: varchar("sessionState", { length: 191 }),
    oauthTokenSecret: varchar("oauthTokenSecret", { length: 191 }),
    oauthToken: varchar("oauthToken", { length: 191 }),
  },
  (table) => [
    uniqueIndex("Account_provider_providerAccountId_key").on(table.provider, table.providerAccountId),
  ],
);

export const session = mysqlTable("Session", {
  id: varchar("id", { length: 191 }).primaryKey(),
  sessionToken: varchar("sessionToken", { length: 191 }).notNull().unique(),
  userId: varchar("userId", { length: 191 }).notNull(),
  expires: datetime("expires", { fsp: 3 }).notNull(),
});

export const verificationToken = mysqlTable(
  "VerificationToken",
  {
    identifier: varchar("identifier", { length: 191 }).notNull(),
    token: varchar("token", { length: 191 }).notNull().unique(),
    expires: datetime("expires", { fsp: 3 }).notNull(),
  },
  (table) => [
    uniqueIndex("VerificationToken_identifier_token_key").on(table.identifier, table.token),
  ],
);

// ============ Content Tables ============

export const post = mysqlTable(
  "Post",
  {
    id: varchar("id", { length: 191 }).notNull(),
    createdAt: datetime("createdAt", { fsp: 3 }).default(sql`CURRENT_TIMESTAMP(3)`).notNull(),
    updatedAt: datetime("updatedAt", { fsp: 3 }).notNull(),
    views: int("views").default(0).notNull(),
    likes: int("likes").default(0).notNull(),
  },
  (table) => [
    uniqueIndex("Post_id_key").on(table.id),
  ],
);

export const comment = mysqlTable("Comment", {
  id: varchar("id", { length: 191 }).primaryKey(),
  postId: varchar("postId", { length: 191 }).notNull(),
  userId: varchar("userId", { length: 191 }).notNull(),
  comment: varchar("comment", { length: 191 }).default("").notNull(),
});

// ============ Tracking Tables ============

export const telemetry = mysqlTable("Telemetry", {
  id: int("id").primaryKey().autoincrement(),
  createdAt: datetime("createdAt", { fsp: 3 }).default(sql`CURRENT_TIMESTAMP(3)`).notNull(),
  updatedAt: datetime("updatedAt", { fsp: 3 }).notNull(),
  name: varchar("name", { length: 50 }).notNull(),
});

export const habitTracking = mysqlTable("HabitTracking", {
  id: int("id").primaryKey().autoincrement(),
  createdAt: datetime("createdAt", { fsp: 3 }).default(sql`CURRENT_TIMESTAMP(3)`).notNull(),
  updatedAt: datetime("updatedAt", { fsp: 3 }).notNull(),
  date: datetime("date", { fsp: 3 }).default(sql`CURRENT_TIMESTAMP(3)`).notNull(),
  sleepDuration: float("sleepDuration").default(0),
  dailyRoutineDuration: float("dailyRoutineDuration").default(0),
  readingDuration: float("readingDuration").default(0),
  gamesDuration: float("gamesDuration").default(0),
  tvDuration: float("tvDuration").default(0),
  clientWorkDuration: float("clientWorkDuration").default(0),
  appWorkDuration: float("appWorkDuration").default(0),
  sideProjectsDuration: float("sideProjectsDuration").default(0),
  cookingDuration: float("cookingDuration").default(0),
  eatingDuration: float("eatingDuration").default(0),
  drivingDuration: float("drivingDuration").default(0),
  socialsDuration: float("socialsDuration").default(0),
  exerciseDuration: float("exerciseDuration").default(0),
  familyDuration: float("familyDuration").default(0),
  choresDuration: float("choresDuration").default(0),
  travelDuration: float("travelDuration").default(0),
  learningDuration: float("learningDuration").default(0),
  otherDuration: float("otherDuration").default(0),
  durationNotes: varchar("durationNotes", { length: 191 }).default(""),
  wakeTime: datetime("wakeTime", { fsp: 3 }),
  maui: boolean("maui"),
  morningTeeth: boolean("morningTeeth"),
  eveningTeeth: boolean("eveningTeeth"),
  weight: float("weight"),
  workTime: datetime("workTime", { fsp: 3 }),
  exercise: varchar("exercise", { length: 191 }),
});

export const habits = mysqlTable("Habits", {
  id: varchar("id", { length: 191 }).primaryKey(),
  createdAt: datetime("createdAt", { fsp: 3 }).default(sql`CURRENT_TIMESTAMP(3)`).notNull(),
  updatedAt: datetime("updatedAt", { fsp: 3 }).notNull(),
  data: text("data").notNull(),
  level: int("level").default(0).notNull(),
  userId: varchar("userId", { length: 191 }).notNull(),
});

// ============ Food Tables ============

export const food = mysqlTable("Food", {
  id: int("id").primaryKey().autoincrement(),
  createdAt: datetime("createdAt", { fsp: 3 }).default(sql`CURRENT_TIMESTAMP(3)`).notNull(),
  updatedAt: datetime("updatedAt", { fsp: 3 }).notNull(),
  name: varchar("name", { length: 191 }).notNull(),
  defaultUnitId: int("defaultUnitId").notNull(),
  defaultQuantity: float("defaultQuantity").notNull(),
  defaultPrice: float("defaultPrice").notNull(),
});

export const foodUnit = mysqlTable("FoodUnit", {
  id: int("id").primaryKey().autoincrement(),
  createdAt: datetime("createdAt", { fsp: 3 }).default(sql`CURRENT_TIMESTAMP(3)`).notNull(),
  updatedAt: datetime("updatedAt", { fsp: 3 }).notNull(),
  name: varchar("name", { length: 191 }).notNull(),
  abbreviation: varchar("abbreviation", { length: 191 }).notNull(),
});

export const foodUnitConversion = mysqlTable("FoodUnitConversion", {
  id: int("id").primaryKey().autoincrement(),
  createdAt: datetime("createdAt", { fsp: 3 }).default(sql`CURRENT_TIMESTAMP(3)`).notNull(),
  updatedAt: datetime("updatedAt", { fsp: 3 }).notNull(),
  fromUnitId: int("fromUnitId").notNull(),
  toUnitId: int("toUnitId").notNull(),
  multiply: float("multiply").notNull(),
});

export const foodMethod = mysqlTable("FoodMethod", {
  id: int("id").primaryKey().autoincrement(),
  createdAt: datetime("createdAt", { fsp: 3 }).default(sql`CURRENT_TIMESTAMP(3)`).notNull(),
  updatedAt: datetime("updatedAt", { fsp: 3 }).notNull(),
  method: varchar("method", { length: 191 }).notNull(),
});

export const foodRated = mysqlTable("FoodRated", {
  id: int("id").primaryKey().autoincrement(),
  createdAt: datetime("createdAt", { fsp: 3 }).default(sql`CURRENT_TIMESTAMP(3)`).notNull(),
  updatedAt: datetime("updatedAt", { fsp: 3 }).notNull(),
  foodId: int("foodId").notNull(),
  unitId: int("unitId").notNull(),
  foodMethodId: int("foodMethodId").notNull(),
  quantity: float("quantity").notNull(),
  rating: float("rating").notNull(),
  habitTrackingId: int("habitTrackingId"),
});

// ============ Books ============

export const books = mysqlTable("Books", {
  id: varchar("id", { length: 191 }).primaryKey(),
  createdAt: datetime("createdAt", { fsp: 3 }).default(sql`CURRENT_TIMESTAMP(3)`).notNull(),
  updatedAt: datetime("updatedAt", { fsp: 3 }).notNull(),
  read: boolean("read").default(false).notNull(),
  published: boolean("published").default(false).notNull(),
  name: varchar("name", { length: 191 }).notNull(),
  asin: varchar("asin", { length: 191 }),
  isbn10: varchar("isbn10", { length: 191 }),
  author: varchar("author", { length: 191 }),
  author_url: varchar("author_url", { length: 191 }),
  image: varchar("image", { length: 191 }),
  url: varchar("url", { length: 191 }),
  rating: float("rating").default(0).notNull(),
  votes: int("votes").default(0).notNull(),
});
```

- [ ] **Step 4: Write `server/db/relations.ts`**

```typescript
import { relations } from "drizzle-orm";
import {
  user, account, session, comment, habits,
  post, habitTracking, food, foodUnit, foodUnitConversion, foodMethod, foodRated,
} from "./schema";

export const userRelations = relations(user, ({ many }) => ({
  accounts: many(account),
  sessions: many(session),
  comments: many(comment),
  habits: many(habits),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, { fields: [account.userId], references: [user.id] }),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, { fields: [session.userId], references: [user.id] }),
}));

export const postRelations = relations(post, ({ many }) => ({
  comments: many(comment),
}));

export const commentRelations = relations(comment, ({ one }) => ({
  user: one(user, { fields: [comment.userId], references: [user.id] }),
  post: one(post, { fields: [comment.postId], references: [post.id] }),
}));

export const habitsRelations = relations(habits, ({ one }) => ({
  user: one(user, { fields: [habits.userId], references: [user.id] }),
}));

export const habitTrackingRelations = relations(habitTracking, ({ many }) => ({
  food: many(foodRated),
}));

export const foodRelations = relations(food, ({ one, many }) => ({
  defaultUnit: one(foodUnit, { fields: [food.defaultUnitId], references: [foodUnit.id] }),
  ratings: many(foodRated),
}));

export const foodUnitRelations = relations(foodUnit, ({ many }) => ({
  foods: many(food),
  fromConversions: many(foodUnitConversion, { relationName: "fromUnit" }),
  toConversions: many(foodUnitConversion, { relationName: "toUnit" }),
  ratings: many(foodRated),
}));

export const foodUnitConversionRelations = relations(foodUnitConversion, ({ one }) => ({
  fromUnit: one(foodUnit, { fields: [foodUnitConversion.fromUnitId], references: [foodUnit.id], relationName: "fromUnit" }),
  toUnit: one(foodUnit, { fields: [foodUnitConversion.toUnitId], references: [foodUnit.id], relationName: "toUnit" }),
}));

export const foodMethodRelations = relations(foodMethod, ({ many }) => ({
  ratings: many(foodRated),
}));

export const foodRatedRelations = relations(foodRated, ({ one }) => ({
  food: one(food, { fields: [foodRated.foodId], references: [food.id] }),
  unit: one(foodUnit, { fields: [foodRated.unitId], references: [foodUnit.id] }),
  method: one(foodMethod, { fields: [foodRated.foodMethodId], references: [foodMethod.id] }),
  habitTracking: one(habitTracking, { fields: [foodRated.habitTrackingId], references: [habitTracking.id] }),
}));
```

- [ ] **Step 5: Write `server/db/drizzle.ts`**

Reference: `C:/development/listify/packages/database/drizzle.ts`

```typescript
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import * as schema from "./schema";
import * as relations from "./relations";

const pool = mysql.createPool({
  uri: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: true,
  },
});

export const db = drizzle(pool, {
  schema: { ...schema, ...relations },
  mode: "planetscale",
});
```

- [ ] **Step 6: Verify schema matches live database**

```bash
bunx drizzle-kit introspect
```

Compare output against `server/db/schema.ts`. Fix any column type or name mismatches.

- [ ] **Step 7: Commit**

```bash
git add drizzle.config.ts server/db/
git commit -m "feat: add Drizzle ORM schema, relations, and connection for PlanetScale"
```

---

## Chunk 3: TanStack Start App Shell

### Task 5: Create TanStack Start entry points and root route

**Files:**
- Create: `src/client.tsx`
- Create: `src/router.tsx`
- Create: `src/routes/__root.tsx`
- Create: `src/integrations/tanstack-query.tsx`
- Create: `src/components/default-catch-boundary.tsx`
- Create: `src/components/not-found.tsx`

- [ ] **Step 1: Create directory structure**

```bash
mkdir -p src/routes src/integrations src/components src/styles src/hooks src/stores src/utils
```

- [ ] **Step 2: Write `src/client.tsx`**

Reference: `C:/development/listify/apps/app/src/client.tsx`

```typescript
import { StartClient } from "@tanstack/react-start/client";
import { hydrateRoot } from "react-dom/client";
import "~/styles/tailwind.css";

hydrateRoot(document, <StartClient />);
```

- [ ] **Step 3: Write `src/integrations/tanstack-query.tsx`**

Reference: `C:/development/listify/apps/app/src/integrations/tanstack-query.tsx`

```typescript
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type FC, type PropsWithChildren } from "react";

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60 * 1000,
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined;

export function getContext() {
  if (typeof window === "undefined") {
    return { queryClient: makeQueryClient() };
  }
  if (!browserQueryClient) {
    browserQueryClient = makeQueryClient();
  }
  return { queryClient: browserQueryClient };
}

export const TanstackQueryProvider: FC<PropsWithChildren<{ queryClient: QueryClient }>> = ({
  children,
  queryClient,
}) => {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
};
```

- [ ] **Step 4: Write `src/components/default-catch-boundary.tsx`**

```typescript
import { ErrorComponent, type ErrorComponentProps } from "@tanstack/react-router";
import { type FC } from "react";

export const DefaultCatchBoundary: FC<ErrorComponentProps> = (props) => {
  return <ErrorComponent {...props} />;
};
```

- [ ] **Step 5: Write `src/components/not-found.tsx`**

```typescript
import { type FC } from "react";

export const NotFound: FC = () => {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center">
      <h1 className="text-4xl font-bold">404</h1>
      <p className="mt-2 text-gray-500">Page not found</p>
    </div>
  );
};
```

- [ ] **Step 6: Write `src/router.tsx`**

Reference: `C:/development/listify/apps/app/src/router.tsx`

```typescript
import { createRouter } from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";
import { DefaultCatchBoundary } from "~/components/default-catch-boundary";
import { NotFound } from "~/components/not-found";
import { getContext, TanstackQueryProvider } from "~/integrations/tanstack-query";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const rqContext = getContext();

  const router = createRouter({
    routeTree,
    defaultErrorComponent: DefaultCatchBoundary,
    defaultNotFoundComponent: () => <NotFound />,
    scrollRestoration: typeof sessionStorage !== "undefined",
    context: {
      ...rqContext,
    },
    defaultPreload: "intent",
    Wrap: ({ children }: { children: React.ReactNode }) => (
      <TanstackQueryProvider {...rqContext}>{children}</TanstackQueryProvider>
    ),
  });

  setupRouterSsrQueryIntegration({ router, queryClient: rqContext.queryClient });

  return router;
};

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
```

- [ ] **Step 7: Copy styles into `src/styles/`**

```bash
cp styles/tailwind.css src/styles/tailwind.css
cp styles/theme.scss src/styles/theme.scss
cp styles/prism.scss src/styles/prism.scss
cp styles/typography.scss src/styles/typography.scss
```

Update the import paths inside `src/styles/tailwind.css`:
- Change `@import "typography.scss"` → `@import "./typography.scss"`
- Change `@import "prism.scss"` → `@import "./prism.scss"`

- [ ] **Step 8: Write `src/routes/__root.tsx`**

This replaces both `_document.tsx` and `_app.tsx`. Reference: `C:/development/listify/apps/app/src/routes/__root.tsx`

```typescript
import { HeadContent, Outlet, Scripts, createRootRoute } from "@tanstack/react-router";
import { type FC, type PropsWithChildren } from "react";

const RootDocument: FC<PropsWithChildren> = ({ children }) => {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <HeadContent />
        {/* Fonts - Inter */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@100..900&display=swap"
          rel="stylesheet"
        />
        {/* Favicons — copy from components/_document/favicon.tsx */}
        {/* Umami analytics — production only */}
      </head>
      <body className="color-gray--slate bg-white [--line-color:theme(colors.gray.200/0.8)] d:bg-gray-900 d:bg-gradient-to-b d:from-black/40 d:to-black/40">
        {children}
        <Scripts />
      </body>
    </html>
  );
};

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { title: "Felix Tellmann - Fullstack Developer - TS, Next, Tailwind, Shopify" },
      {
        name: "description",
        content:
          "I'm a self-taught Full-stack developer and entrepreneur living in Cape Town. I enjoy creating things that live on the internet, whether that be websites, applications, or anything in between.",
      },
      { property: "og:title", content: "Felix Tellmann" },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://flext.dev" },
      { property: "og:site_name", content: "Flext.dev" },
      {
        property: "og:description",
        content:
          "Lets make things better with quality code - Learn Web Development / API's / Automations / Serverless / Architecture / and more.",
      },
      {
        property: "og:image",
        content: "https://flext.dev/images/sharing-image.jpg",
      },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:site", content: "@FelixTellmann" },
      { name: "twitter:creator", content: "@Tellmann" },
    ],
  }),
  component: RootComponent,
});

function RootComponent() {
  return (
    <RootDocument>
      <Outlet />
    </RootDocument>
  );
}
```

- [ ] **Step 8b: Migrate Favicon, Font, and Umami components into `__root.tsx`**

Copy the contents of `components/_document/favicon.tsx` and `components/_document/font.tsx` into the `<head>` section of `__root.tsx` (inline the JSX). Also copy the Umami analytics `<script>` from `pages/_document.tsx` (production-only, wrapped in `{process.env.NODE_ENV === "production" && ...}`).

Import SEO data from `content/seo.ts` instead of hardcoding meta values:

```typescript
import { SEO } from "content/seo";
// Use SEO.title, SEO.description, SEO.openGraph, SEO.twitter in the head() meta array
```

- [ ] **Step 9: Verify dev server starts**

```bash
bun run dev
```

Expected: Server starts on port 3000, shows root route (even if mostly empty). Fix any import or config errors.

- [ ] **Step 10: Commit**

```bash
git add src/
git commit -m "feat: add TanStack Start app shell — client, router, root route, query provider"
```

---

## Chunk 4: Component Migration

### Task 6: Migrate wrapper components (Image, Link, ThemeProvider)

**Files:**
- Create: `src/components/image.tsx`
- Create: `src/components/link.tsx`
- Create: `src/components/theme-provider.tsx`
- Copy: all other existing components into `src/components/`

- [ ] **Step 1: Write `src/components/theme-provider.tsx`**

Replaces `next-themes`. Must persist to localStorage, apply `dark` class to `<html>`, detect system preference, avoid SSR flash.

```typescript
import { createContext, useCallback, useContext, useEffect, useState, type FC, type PropsWithChildren } from "react";

type Theme = "light" | "dark" | "system";

type ThemeContextType = {
  theme: string;
  setTheme: (theme: Theme) => void;
  resolvedTheme: string;
};

const ThemeContext = createContext<ThemeContextType>({
  theme: "system",
  setTheme: () => {},
  resolvedTheme: "light",
});

export const useTheme = () => useContext(ThemeContext);

function getSystemTheme(): string {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export const ThemeProvider: FC<PropsWithChildren<{ attribute?: string }>> = ({ children }) => {
  const [theme, setThemeState] = useState<Theme>("system");
  const [resolvedTheme, setResolvedTheme] = useState("light");

  useEffect(() => {
    const stored = localStorage.getItem("theme") as Theme | null;
    if (stored) {
      setThemeState(stored);
    }
  }, []);

  useEffect(() => {
    const resolved = theme === "system" ? getSystemTheme() : theme;
    setResolvedTheme(resolved);
    document.documentElement.classList.toggle("dark", resolved === "dark");
  }, [theme]);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      if (theme === "system") {
        const resolved = getSystemTheme();
        setResolvedTheme(resolved);
        document.documentElement.classList.toggle("dark", resolved === "dark");
      }
    };
    mediaQuery.addEventListener("change", handler);
    return () => mediaQuery.removeEventListener("change", handler);
  }, [theme]);

  const setTheme = useCallback((newTheme: Theme) => {
    setThemeState(newTheme);
    localStorage.setItem("theme", newTheme);
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, resolvedTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};
```

Add anti-flash inline script to `__root.tsx` `<head>`:

```html
<script dangerouslySetInnerHTML={{ __html: `(function(){try{var t=localStorage.getItem("theme");var d=t==="dark"||(t!=="light"&&window.matchMedia("(prefers-color-scheme:dark)").matches);document.documentElement.classList.toggle("dark",d)}catch(e){}})()` }} />
```

- [ ] **Step 2: Write `src/components/image.tsx`**

Simplified version without `next/image` blur-up. Keeps aspect ratio and preload logic.

```typescript
import { type FC, type ImgHTMLAttributes } from "react";

type ImageProps = ImgHTMLAttributes<HTMLImageElement> & {
  aspectRatio?: number;
  maxHeight?: number;
  maxWidth?: number;
  pixelDensity?: number;
  preload?: boolean;
};

export const Image: FC<ImageProps> = ({
  pixelDensity = 1,
  preload,
  src,
  width,
  height,
  maxWidth,
  maxHeight,
  aspectRatio,
  ...rest
}) => {
  if (!src || src === "undefined") return null;

  const w = +(width ?? 0);
  const h = +(height ?? 0);
  const aspect = aspectRatio ?? (h ? w / h : undefined);

  const finalWidth = Math.round(
    +(maxWidth ? maxWidth : maxHeight && aspect ? maxHeight * aspect : w) * pixelDensity,
  );
  const finalHeight = Math.round(
    +(maxHeight ? maxHeight : maxWidth && aspect ? maxWidth / aspect : h) * pixelDensity,
  );

  const normalizedSrc = typeof src === "string" ? src.replace(/^(http:)?\/\//, "https://") : src;

  return (
    <img
      {...rest}
      src={normalizedSrc}
      width={finalWidth}
      height={finalHeight}
      loading={preload ? "eager" : "lazy"}
    />
  );
};
```

- [ ] **Step 3: Write `src/components/link.tsx`**

Replace `next/link` with TanStack Router's `Link` for internal routes, keep external URL logic.

```typescript
import { Link as RouterLink } from "@tanstack/react-router";
import { type AnchorHTMLAttributes, type FC, type PropsWithChildren, useCallback } from "react";
import { isExternalUrl } from "utils/is-external-url";

type LinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  href?: string;
  prefetch?: boolean;
};

export const Link: FC<PropsWithChildren<LinkProps>> = ({
  children,
  href,
  onClick,
  prefetch,
  ...anchorProps
}) => {
  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLAnchorElement>) => {
      if (window.self !== window.top && href) {
        e.preventDefault();
        e.stopPropagation();
        window?.parent?.postMessage(
          { source: "theme-content", topic: "redirect", href },
          "*",
        );
      }
      onClick?.(e);
    },
    [href, onClick],
  );

  if (!href) {
    return (
      <span onClick={onClick} {...anchorProps}>
        {children}
      </span>
    );
  }

  const cleanHref = typeof href === "string" ? href.replace(/^\/products\//gi, "/") : href;

  if (isExternalUrl(href)) {
    return (
      <a
        href={cleanHref}
        rel={anchorProps?.target === "_blank" ? "noopener noreferrer" : undefined}
        onClick={onClick}
        {...anchorProps}
      >
        {children}
      </a>
    );
  }

  return (
    <RouterLink to={cleanHref} onClick={handleClick} {...(anchorProps as any)}>
      {children}
    </RouterLink>
  );
};
```

- [ ] **Step 4: Copy all other components into `src/components/`**

```bash
# Copy all existing components, preserving directory structure
cp -r components/layout src/components/layout
cp -r components/sections src/components/sections
cp -r components/resume src/components/resume
cp -r components/typography src/components/typography
cp -r components/_hooks src/hooks/        # flatten into src/hooks
cp -r components/_stores src/stores/      # flatten into src/stores
# Copy individual component files
cp components/alert.tsx src/components/
cp components/badge.tsx src/components/
cp components/button-loading.tsx src/components/
cp components/code-editor.tsx src/components/
cp components/copy-button.tsx src/components/
cp components/darkmode-icon.tsx src/components/
cp components/divider.tsx src/components/
cp components/scroll-gallery.tsx src/components/
cp components/toast.tsx src/components/
cp components/toggle-switch.tsx src/components/
cp components/twitter-profile.tsx src/components/
cp components/typewriter.tsx src/components/
```

- [ ] **Step 5: Fix imports across all copied components**

In every copied file, update:
- `"components/..."` → `"~/components/..."`
- `"components/_hooks/..."` → `"~/hooks/..."`
- `"components/_stores/..."` → `"~/stores/..."`
- `"components/_app/trpc"` → will be replaced in ORPC task
- `import { useTheme } from "next-themes"` → `import { useTheme } from "~/components/theme-provider"`
- `import NextLink from "next/link"` → remove (replaced by new Link)
- `import NextImage from "next/future/image"` → remove (replaced by new Image)
- `import { useRouter } from "next/router"` → `import { useRouter, useLocation } from "@tanstack/react-router"` (note: `router.asPath` becomes `location.pathname`, `router.push()` becomes `navigate()`)
- `import dynamic from "next/dynamic"` → use `React.lazy` + `Suspense`

- [ ] **Step 6: Fix `_load-initial-data.tsx`**

In `src/stores/_load-initial-data.tsx`, replace:
```typescript
import dynamic from "next/dynamic";
const ReactTooltip = dynamic(() => import("react-tooltip").then((mod) => mod), { ssr: false });
```

With:
```typescript
import { lazy, Suspense } from "react";
const ReactTooltip = lazy(() => import("react-tooltip"));
```

And wrap the usage in `<Suspense>`.

- [ ] **Step 7: Fix `_context-providers.tsx`**

In `src/stores/_context-providers.tsx`, replace:
```typescript
import { ThemeProvider } from "next-themes";
```
With:
```typescript
import { ThemeProvider } from "~/components/theme-provider";
```

- [ ] **Step 8: Keep utility functions at root**

The `utils/` directory stays at the project root. Both `content/` and `src/` files import from `utils/` via the tsconfig path alias `"utils/*": ["utils/*"]`. Do NOT copy to `src/utils/`.

- [ ] **Step 9: Commit**

```bash
git add src/components/ src/hooks/ src/stores/ src/utils/
git commit -m "feat: migrate components, hooks, stores, utils — replace next/image, next/link, next-themes"
```

---

## Chunk 5: ORPC Setup

### Task 7: Create ORPC server, procedures, and client

**Files:**
- Create: `server/orpc/index.ts`
- Create: `server/orpc/context.ts`
- Create: `server/orpc/books.ts`
- Create: `server/orpc/fetch.ts`
- Create: `src/integrations/orpc.tsx`
- Create: `src/routes/api/orpc.ts`

- [ ] **Step 1: Write `server/orpc/context.ts`**

```typescript
import { db } from "@server/db/drizzle";

export type ORPCContext = {
  db: typeof db;
  session: {
    user_id: string;
    email: string;
    name: string;
  } | null;
};

export function createContext(): ORPCContext {
  return {
    db,
    session: null,
  };
}
```

- [ ] **Step 2: Write `server/orpc/books.ts`**

Migrate from `server/api-routes/books.ts`. Reference: `C:/development/listify/packages/orpc/` for ORPC patterns.

```typescript
import { os } from "@orpc/server";
import { z } from "zod";
import { books } from "@server/db/schema";
import { db } from "@server/db/drizzle";
import { eq, sql } from "drizzle-orm";

export const booksProcedures = {
  get: os.handler(async () => {
    return db.select().from(books).limit(1000);
  }),

  add: os.input(
    z.object({
      read: z.boolean().optional(),
      published: z.boolean().optional(),
      name: z.string(),
      asin: z.string().optional(),
      isbn10: z.string().optional(),
      author: z.string().optional(),
      author_url: z.string().optional(),
      image: z.string().optional(),
      url: z.string().optional(),
      rating: z.number().optional(),
      votes: z.number().optional(),
    }),
  ).handler(async ({ input }) => {
    const result = await db.insert(books).values(input);
    return result;
  }),

  addMany: os.input(
    z.array(
      z.object({
        read: z.boolean(),
        published: z.boolean(),
        name: z.string(),
        asin: z.string().optional(),
        isbn10: z.string().optional(),
        author: z.string().optional(),
        author_url: z.string().optional(),
        image: z.string().optional(),
        url: z.string().optional(),
        rating: z.number().optional(),
        votes: z.number().optional(),
      }),
    ),
  ).handler(async ({ input }) => {
    const result = await db.insert(books).values(input);
    return result;
  }),

  upvote: os.input(
    z.object({ id: z.string() }),
  ).handler(async ({ input }) => {
    return db
      .update(books)
      .set({ votes: sql`${books.votes} + 1` })
      .where(eq(books.id, input.id));
  }),
};
```

- [ ] **Step 3: Write `server/orpc/fetch.ts`**

```typescript
import { os } from "@orpc/server";
import { z } from "zod";

export const fetchProcedures = {
  wordtune: os.input(z.string().min(1).max(500)).handler(async () => {
    return "";
  }),
};
```

- [ ] **Step 4: Write `server/orpc/index.ts`**

```typescript
import { os } from "@orpc/server";
import { booksProcedures } from "./books";
import { fetchProcedures } from "./fetch";

export const orpcRouter = os.router({
  books: booksProcedures,
  fetch: fetchProcedures,
});

export type ORPCRouter = typeof orpcRouter;
```

- [ ] **Step 5: Write `src/integrations/orpc.tsx`**

Reference: `C:/development/listify/apps/app/src/integrations/orpc.tsx`

Uses `createIsomorphicFn` for proper server/client code splitting — critical for TanStack Start.

```typescript
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterClient } from "@orpc/server";
import { createRouterClient } from "@orpc/server";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { createIsomorphicFn } from "@tanstack/react-start";
import type { ORPCRouter } from "@server/orpc";
import { orpcRouter } from "@server/orpc";

const origin = () => globalThis?.location?.origin ?? `http://localhost:${process.env.PORT ?? 3000}`;

const getORPCClient = createIsomorphicFn()
  .server(() =>
    createRouterClient(orpcRouter, {
      context: async () => ({}),
    }),
  )
  .client((): RouterClient<typeof orpcRouter> => {
    const link = new RPCLink({
      url: `${origin()}/api/orpc`,
      headers: () => ({}),
    });
    return createORPCClient(link);
  });

export const orpc: RouterClient<typeof orpcRouter> = getORPCClient();
export const orpcQuery = createTanstackQueryUtils(orpc);
```

- [ ] **Step 6: Create ORPC API route at `src/routes/api/orpc/$.ts`**

The `$` splat route catches all sub-paths (one per procedure). Reference: `C:/development/listify/apps/app/src/routes/api/orpc/$.ts`

```bash
mkdir -p src/routes/api/orpc
```

```typescript
// src/routes/api/orpc/$.ts
import { RPCHandler } from "@orpc/server/fetch";
import { createFileRoute } from "@tanstack/react-router";
import { orpcRouter } from "@server/orpc";

const handler = new RPCHandler(orpcRouter);

async function handle({ request }: { request: Request }) {
  const { response } = await handler.handle(request, {
    prefix: "/api/orpc",
    context: {},
  });
  return response ?? new Response("Not Found", { status: 404 });
}

export const Route = createFileRoute("/api/orpc/$")({
  server: {
    handlers: {
      GET: handle,
      POST: handle,
      PUT: handle,
      DELETE: handle,
      OPTIONS: handle,
    },
  },
});
```

- [ ] **Step 7: Commit**

```bash
git add server/orpc/ src/integrations/orpc.tsx src/routes/api/orpc/
git commit -m "feat: add ORPC server, procedures, client — replaces TRPC"
```

---

## Chunk 6: Auth System

### Task 8: Create JWT auth utilities

**Files:**
- Create: `server/auth/jwt.ts`
- Create: `server/auth/credentials.ts`
- Create: `server/auth/email.ts`
- Create: `server/auth/oauth.ts`

- [ ] **Step 1: Write `server/auth/jwt.ts`**

Reference: `C:/development/listify/packages/utils/jose/` patterns.

```typescript
import { SignJWT, jwtVerify } from "jose";

const JWT_SECRET = () => new TextEncoder().encode(process.env.JWT_SECRET);

export type AuthJWT = {
  user_id: string;
  email: string;
  name: string;
  image?: string;
  provider: string;
  email_verified?: boolean;
  accept_marketing?: boolean;
};

export async function signJWT(payload: AuthJWT, maxAge = "120d"): Promise<string> {
  return new SignJWT(payload as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(maxAge)
    .sign(JWT_SECRET());
}

export async function verifyJWT(token: string): Promise<AuthJWT | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET());
    return payload as unknown as AuthJWT;
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Write `server/auth/credentials.ts`**

Port the sign-up and sign-in logic from `pages/api/auth/[...nextauth].ts` credentials providers.

```typescript
import bcrypt from "bcrypt";
import { eq } from "drizzle-orm";
import { db } from "@server/db/drizzle";
import { user, account } from "@server/db/schema";
import { isValidPassword } from "utils/validate-password";
import validate from "validator";

type CredentialsResult =
  | { success: true; user: { id: string; email: string; name: string; image: string | null; emailVerified: Date | null } }
  | { success: false; error: "validation-error" | "account-exists" | "account-not-found" | "incorrect-password" | "email-not-verified"; providers?: string[] };

export async function signUp(input: {
  name: string;
  email: string;
  password: string;
  marketing?: boolean;
}): Promise<CredentialsResult> {
  if (!isValidPassword(input.password) || !validate.isEmail(input.email) || validate.isEmpty(input.name)) {
    return { success: false, error: "validation-error" };
  }

  const existing = await db.select().from(user).where(eq(user.email, input.email)).limit(1);

  if (existing.length > 0) {
    const existingUser = existing[0]!;
    if (!existingUser.password) {
      const accounts = await db.select().from(account).where(eq(account.userId, existingUser.id));
      return { success: false, error: "account-exists", providers: accounts.map((a) => a.provider) };
    }
    // User exists with password — treat as incorrect (they should sign in instead)
    return { success: false, error: "account-exists" };
  }

  const hash = await bcrypt.hash(input.password, 10);
  const id = crypto.randomUUID();

  await db.insert(user).values({
    id,
    name: input.name,
    email: input.email,
    password: hash,
    acceptMarketing: !!input.marketing,
  });

  return {
    success: true,
    user: { id, email: input.email, name: input.name, image: null, emailVerified: null },
  };
}

export async function signIn(input: {
  email: string;
  password: string;
}): Promise<CredentialsResult> {
  if (!isValidPassword(input.password) || !validate.isEmail(input.email)) {
    return { success: false, error: "validation-error" };
  }

  const existing = await db.select().from(user).where(eq(user.email, input.email)).limit(1);

  if (existing.length === 0) {
    return { success: false, error: "account-not-found" };
  }

  const existingUser = existing[0]!;

  if (!existingUser.password) {
    const accounts = await db.select().from(account).where(eq(account.userId, existingUser.id));
    return { success: false, error: "account-exists", providers: accounts.map((a) => a.provider) };
  }

  const valid = await bcrypt.compare(input.password, existingUser.password);
  if (!valid) {
    return { success: false, error: "incorrect-password" };
  }

  return {
    success: true,
    user: {
      id: existingUser.id,
      email: existingUser.email!,
      name: existingUser.name!,
      image: existingUser.image,
      emailVerified: existingUser.emailVerified,
    },
  };
}
```

- [ ] **Step 3: Write `server/auth/email.ts`**

Magic link email sending via nodemailer. Tokens stored in `VerificationToken` table.

```typescript
import { createTransport } from "nodemailer";
import { db } from "@server/db/drizzle";
import { verificationToken } from "@server/db/schema";
import { and, eq } from "drizzle-orm";

function getTransport() {
  return createTransport({
    host: process.env.EMAIL_SERVER_HOST,
    port: Number(process.env.EMAIL_SERVER_PORT),
    auth: {
      user: process.env.EMAIL_SERVER_USER,
      pass: process.env.EMAIL_SERVER_PASSWORD,
    },
  });
}

export async function sendMagicLink(email: string, baseUrl: string): Promise<void> {
  const token = crypto.randomUUID();
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

  await db.insert(verificationToken).values({
    identifier: email,
    token,
    expires,
  });

  const url = `${baseUrl}/auth/callback/email?token=${token}&email=${encodeURIComponent(email)}`;

  await getTransport().sendMail({
    to: email,
    from: process.env.EMAIL_FROM,
    subject: "Sign in to flext.dev",
    text: `Sign in to flext.dev\n\n${url}\n\n`,
    html: `<p>Sign in to flext.dev</p><p><a href="${url}">Click here to sign in</a></p>`,
  });
}

export async function verifyMagicLinkToken(email: string, token: string): Promise<boolean> {
  const records = await db
    .select()
    .from(verificationToken)
    .where(and(eq(verificationToken.identifier, email), eq(verificationToken.token, token)))
    .limit(1);

  if (records.length === 0) return false;

  const record = records[0]!;
  if (new Date() > record.expires) return false;

  // Delete used token
  await db
    .delete(verificationToken)
    .where(and(eq(verificationToken.identifier, email), eq(verificationToken.token, token)));

  return true;
}
```

- [ ] **Step 4: Write `server/auth/oauth.ts`**

Stub for OAuth providers. Each provider needs: authorization URL builder, callback handler (code → token → profile → upsert user).

```typescript
// OAuth provider configuration
// Each provider: { authUrl, tokenUrl, profileUrl, clientId, clientSecret, scopes }
// Implementation: create authorization URLs, handle callbacks, exchange codes for tokens

export type OAuthProvider = "github" | "google" | "twitter" | "facebook";

type OAuthConfig = {
  authUrl: string;
  tokenUrl: string;
  profileUrl: string;
  clientId: string;
  clientSecret: string;
  scopes: string[];
};

export function getProviderConfig(provider: OAuthProvider): OAuthConfig {
  switch (provider) {
    case "github":
      return {
        authUrl: "https://github.com/login/oauth/authorize",
        tokenUrl: "https://github.com/login/oauth/access_token",
        profileUrl: "https://api.github.com/user",
        clientId: process.env.GITHUB_ID!,
        clientSecret: process.env.GITHUB_SECRET!,
        scopes: ["read:user", "user:email"],
      };
    case "google":
      return {
        authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
        tokenUrl: "https://oauth2.googleapis.com/token",
        profileUrl: "https://www.googleapis.com/oauth2/v2/userinfo",
        clientId: process.env.GOOGLE_CLIENT_ID!,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
        scopes: ["openid", "email", "profile"],
      };
    case "twitter":
      return {
        authUrl: "https://api.twitter.com/oauth/authenticate",
        tokenUrl: "https://api.twitter.com/oauth/access_token",
        profileUrl: "https://api.twitter.com/1.1/account/verify_credentials.json",
        clientId: process.env.TWITTER_CLIENT_ID!,
        clientSecret: process.env.TWITTER_CLIENT_SECRET!,
        scopes: [],
      };
    case "facebook":
      return {
        authUrl: "https://www.facebook.com/v18.0/dialog/oauth",
        tokenUrl: "https://graph.facebook.com/v18.0/oauth/access_token",
        profileUrl: "https://graph.facebook.com/me?fields=id,name,email,picture",
        clientId: process.env.FACEBOOK_CLIENT_ID!,
        clientSecret: process.env.FACEBOOK_CLIENT_SECRET!,
        scopes: ["email", "public_profile"],
      };
  }
}

export function buildAuthorizationUrl(provider: OAuthProvider, redirectUri: string, state: string): string {
  const config = getProviderConfig(provider);

  // Twitter OAuth 1.0a requires a different flow — handle separately
  if (provider === "twitter") {
    // Twitter OAuth 1.0a: request token → redirect → callback
    // This needs a separate implementation with oauth-1.0a signing
    throw new Error("Twitter OAuth 1.0a requires separate implementation");
  }

  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: config.scopes.join(" "),
    state,
  });

  return `${config.authUrl}?${params.toString()}`;
}

export async function exchangeCodeForToken(
  provider: OAuthProvider,
  code: string,
  redirectUri: string,
): Promise<{ access_token: string; [key: string]: unknown }> {
  const config = getProviderConfig(provider);

  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  return response.json();
}

export async function fetchUserProfile(
  provider: OAuthProvider,
  accessToken: string,
): Promise<{ id: string; email: string; name: string; image?: string }> {
  const config = getProviderConfig(provider);

  const response = await fetch(config.profileUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const data = await response.json();

  switch (provider) {
    case "github":
      return { id: String(data.id), email: data.email, name: data.name || data.login, image: data.avatar_url };
    case "google":
      return { id: data.id, email: data.email, name: data.name, image: data.picture };
    case "facebook":
      return { id: data.id, email: data.email, name: data.name, image: data.picture?.data?.url };
    default:
      return { id: data.id, email: data.email, name: data.name };
  }
}
```

- [ ] **Step 5: Commit**

```bash
git add server/auth/
git commit -m "feat: add JWT auth system — sign/verify, credentials, magic link email, OAuth providers"
```

### Task 8b: Create auth routes and global middleware

**Files:**
- Create: `src/routes/auth/sign-in.tsx`
- Create: `src/routes/auth/sign-up.tsx`
- Create: `src/routes/auth/sign-out.tsx`
- Create: `src/routes/auth/error.tsx`
- Create: `src/routes/auth/verify-request.tsx`
- Create: `src/routes/auth/callback.$provider.tsx`
- Create: `src/global-middleware.ts`

- [ ] **Step 1: Create auth routes directory**

```bash
mkdir -p src/routes/auth
```

- [ ] **Step 2: Write `src/routes/auth/sign-in.tsx`**

Port the existing sign-in page UI. This is a form that posts to a server function for credentials auth, plus OAuth provider buttons.

```typescript
import { createFileRoute, createServerFn } from "@tanstack/react-start";
import { signIn } from "@server/auth/credentials";
import { signJWT } from "@server/auth/jwt";
import { buildAuthorizationUrl, type OAuthProvider } from "@server/auth/oauth";

const credentialsSignIn = createServerFn({ method: "POST" }).handler(async ({ data }: { data: { email: string; password: string } }) => {
  const result = await signIn(data);
  if (!result.success) {
    return { error: result.error, providers: result.providers };
  }
  const token = await signJWT({
    user_id: result.user.id,
    email: result.user.email,
    name: result.user.name ?? "",
    image: result.user.image ?? undefined,
    provider: "credentials",
    email_verified: !!result.user.emailVerified,
  });
  return { token };
});

export const Route = createFileRoute("/auth/sign-in")({
  component: SignInPage,
});

function SignInPage() {
  // Port existing sign-in UI from the current auth pages
  // Include: email/password form, OAuth provider buttons (GitHub, Google, Twitter, Facebook)
  // Include: magic link email form
  return <div>Sign In Page — port from existing auth UI</div>;
}
```

- [ ] **Step 3: Write `src/routes/auth/sign-up.tsx`**

Similar to sign-in but with name field and marketing checkbox. Uses `signUp` from `@server/auth/credentials`.

```typescript
import { createFileRoute } from "@tanstack/react-start";

export const Route = createFileRoute("/auth/sign-up")({
  component: SignUpPage,
});

function SignUpPage() {
  // Port existing sign-up UI
  return <div>Sign Up Page — port from existing auth UI</div>;
}
```

- [ ] **Step 4: Write `src/routes/auth/sign-out.tsx`**

Clears JWT cookie and redirects to home.

```typescript
import { createFileRoute } from "@tanstack/react-start";

export const Route = createFileRoute("/auth/sign-out")({
  component: SignOutPage,
});

function SignOutPage() {
  return <div>Sign Out Page — clear cookie, redirect</div>;
}
```

- [ ] **Step 5: Write `src/routes/auth/error.tsx`**

Displays auth errors from query params: `?error=validation-error`, `?error=account-exists|||provider1,provider2`, etc.

```typescript
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/auth/error")({
  component: AuthErrorPage,
});

function AuthErrorPage() {
  const { error } = Route.useSearch<{ error?: string }>();
  // Parse error types: validation-error, account-exists, account-not-found, incorrect-password, email-not-verified
  // Display appropriate error message
  return <div>Auth Error: {error}</div>;
}
```

- [ ] **Step 6: Write `src/routes/auth/verify-request.tsx`**

"Check your email" page shown after magic link is sent.

```typescript
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/auth/verify-request")({
  component: VerifyRequestPage,
});

function VerifyRequestPage() {
  return <div>Check your email for a sign-in link.</div>;
}
```

- [ ] **Step 7: Write `src/routes/auth/callback.$provider.tsx`**

Handles OAuth callbacks. Receives `code` and `state` params, exchanges for token, upserts user, sets JWT cookie.

```typescript
import { createFileRoute, createServerFn } from "@tanstack/react-start";
import { exchangeCodeForToken, fetchUserProfile, type OAuthProvider } from "@server/auth/oauth";
import { signJWT } from "@server/auth/jwt";
import { db } from "@server/db/drizzle";
import { user, account } from "@server/db/schema";
import { eq } from "drizzle-orm";

const handleOAuthCallback = createServerFn({ method: "GET" }).handler(async ({ data }: { data: { provider: string; code: string } }) => {
  const provider = data.provider as OAuthProvider;
  const redirectUri = `${process.env.VITE_PUBLIC_HOSTNAME}/auth/callback/${provider}`;

  const tokenData = await exchangeCodeForToken(provider, data.code, redirectUri);
  const profile = await fetchUserProfile(provider, tokenData.access_token);

  // Check if account exists with same email under different provider
  const existingUsers = await db.select().from(user).where(eq(user.email, profile.email)).limit(1);

  if (existingUsers.length > 0) {
    const existingUser = existingUsers[0]!;
    const existingAccounts = await db.select().from(account).where(eq(account.userId, existingUser.id));

    // Check if this provider is already linked
    const alreadyLinked = existingAccounts.some((a) => a.provider === provider && a.providerAccountId === profile.id);

    if (!alreadyLinked && existingAccounts.length > 0) {
      // Account exists with different provider
      const providers = existingAccounts.map((a) => a.provider).join(",");
      return { error: `account-exists|||${providers}` };
    }

    // Provider already linked — sign in
    const token = await signJWT({
      user_id: existingUser.id,
      email: existingUser.email!,
      name: existingUser.name ?? "",
      image: existingUser.image ?? undefined,
      provider,
      email_verified: !!existingUser.emailVerified,
    });
    return { token };
  }

  // New user — create account
  const userId = crypto.randomUUID();
  await db.insert(user).values({
    id: userId,
    name: profile.name,
    email: profile.email,
    image: profile.image,
    emailVerified: new Date(),
  });

  await db.insert(account).values({
    id: crypto.randomUUID(),
    userId,
    type: "oauth",
    provider,
    providerAccountId: profile.id,
    accessToken: tokenData.access_token,
  });

  const token = await signJWT({
    user_id: userId,
    email: profile.email,
    name: profile.name,
    image: profile.image,
    provider,
    email_verified: true,
  });

  return { token };
});

export const Route = createFileRoute("/auth/callback/$provider")({
  loader: async ({ params }) => {
    // OAuth callback handling happens via server function
    return { provider: params.provider };
  },
  component: CallbackPage,
});

function CallbackPage() {
  return <div>Processing authentication...</div>;
}
```

- [ ] **Step 8: Write `src/global-middleware.ts`**

Decodes JWT from cookies on every request and populates router context.

Reference: `C:/development/listify/apps/app/src/global-middleware.ts`

```typescript
import { createMiddleware } from "@tanstack/react-start";
import { verifyJWT } from "@server/auth/jwt";

export default createMiddleware()
  .server(async ({ next }) => {
    // On the server, read JWT from cookie
    const { getCookie } = await import("@tanstack/react-start/server");
    const token = getCookie("auth_token");
    const session = token ? await verifyJWT(token) : null;

    return next({
      context: { session },
    });
  })
  .client(async ({ next }) => {
    // On the client, session comes from router context (hydrated from server)
    return next();
  });
```

- [ ] **Step 9: Commit**

```bash
git add src/routes/auth/ src/global-middleware.ts
git commit -m "feat: add auth route pages and global middleware for JWT session"
```

---

## Chunk 7: Route Migration

### Task 9: Migrate all pages to TanStack routes

**Files:**
- Create: `src/routes/index.tsx`
- Create: `src/routes/books.tsx`
- Create: `src/routes/gallery.tsx`
- Create: `src/routes/notes.tsx`
- Create: `src/routes/portfolio.tsx`
- Create: `src/routes/resume.tsx`
- Create: `src/routes/liz.tsx`
- Create: `src/routes/components.tsx`
- Create: `src/routes/test.tsx`
- Create: `src/routes/posts/redesign.tsx`
- Create: `src/routes/api/tweets.ts`
- Create: `src/routes/api/typeform-webhook.ts`

- [ ] **Step 1: Add layout wrapper to `__root.tsx`**

Update `__root.tsx` `RootComponent` to include Header, Footer, and all providers (matching `_app.tsx`):

```typescript
import { ContextProviders } from "~/stores/_context-providers";
import { LoadInitialData } from "~/stores/_load-initial-data";
import { Header } from "~/components/layout/header";
import { Footer } from "~/components/layout/footer";

function RootComponent() {
  return (
    <RootDocument>
      <ContextProviders>
        <LoadInitialData>
          <Header />
          <main className="min-h-screen print:!mx-auto print:!w-[1024px]">
            <Outlet />
          </main>
          <Footer />
        </LoadInitialData>
      </ContextProviders>
    </RootDocument>
  );
}
```

- [ ] **Step 2: Write `src/routes/index.tsx`**

The home page. Replace `getStaticProps` with a route `loader` using `createServerFn`.

```typescript
import { createFileRoute, createServerFn } from "@tanstack/react-start";
import { About } from "~/components/sections/about";
import { Hero } from "~/components/sections/hero";
import { PortfolioPreview } from "~/components/sections/portfolio-preview";
import { Timeline } from "~/components/sections/timeline";
import { Client } from "twitter-api-sdk";

const fetchTwitterData = createServerFn({ method: "GET" }).handler(async () => {
  const client = new Client(process.env.TWITTER_CLIENT_BEARER_TOKEN!);
  const twitterData = await client.users.findUserByUsername("FelixTellmann", {
    "user.fields": [
      "created_at", "description", "entities", "id", "location", "name",
      "pinned_tweet_id", "profile_image_url", "protected", "public_metrics",
      "url", "username", "verified", "withheld",
    ],
  });
  return twitterData.data;
});

export const Route = createFileRoute("/")({
  loader: async () => {
    const twitterData = await fetchTwitterData();
    return { twitterData };
  },
  component: IndexPage,
});

function IndexPage() {
  const { twitterData } = Route.useLoaderData();

  return (
    <>
      <Hero twitterData={twitterData} />
      <About />
      <Timeline />
      <PortfolioPreview />
    </>
  );
}
```

- [ ] **Step 3: Write `src/routes/books.tsx`**

Replace `getStaticProps` with SSG helpers pattern using `createServerFn` and ORPC.

```typescript
import { createFileRoute, createServerFn } from "@tanstack/react-start";
import { orpc } from "~/integrations/orpc";
// Copy the BookItem, StarRating components from pages/books.tsx
// Update imports: trpc → orpc, Image → ~/components/image, Link → ~/components/link

const fetchBooks = createServerFn({ method: "GET" }).handler(async () => {
  const books = await orpc.books.get();
  return books.map((book) => ({
    ...book,
    createdAt: book.createdAt ? new Date(book.createdAt).toUTCString() : "",
    updatedAt: book.updatedAt ? new Date(book.updatedAt).toUTCString() : "",
  }));
});

export const Route = createFileRoute("/books")({
  loader: async () => {
    const books = await fetchBooks();
    return { books };
  },
  component: BooksPage,
});

function BooksPage() {
  const { books } = Route.useLoaderData();
  // Port BookList component here, using orpcQuery for mutations
  // Replace trpc.books.upvote.useMutation() with orpcQuery equivalent
}
```

Copy the full `BookItem`, `StarRating` components from `pages/books.tsx` into this file. Update:
- `trpc.books.upvote.useMutation()` → `useMutation` from ORPC tanstack-query
- `InferGetStaticPropsType` → use the loader return type
- `Image` import → `~/components/image`
- `Link` import → `~/components/link`

- [ ] **Step 4: Write simple pages (gallery, notes, portfolio, components, test, posts/redesign)**

These pages are mostly static content with minimal logic. For each, create a route file:

```typescript
// Example: src/routes/gallery.tsx
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/gallery")({
  component: GalleryPage,
});

function GalleryPage() {
  return <>Gallery</>;
}
```

Repeat for: `gallery.tsx`, `notes.tsx`, `portfolio.tsx`, `components.tsx`, `test.tsx`.

For `posts/redesign.tsx`, create `src/routes/posts/` directory first:

```bash
mkdir -p src/routes/posts
```

Then create `src/routes/posts/redesign.tsx` — copy content from `pages/posts/redesign.tsx`, remove Next.js imports.

- [ ] **Step 5: Write `src/routes/resume.tsx` and `src/routes/liz.tsx`**

These are large files (~29K and ~32K). Copy content directly from `pages/resume.tsx` and `pages/liz.tsx`, wrapping in `createFileRoute`:

```typescript
import { createFileRoute } from "@tanstack/react-router";
// ... copy all imports, update paths

export const Route = createFileRoute("/resume")({
  component: ResumePage,
});

function ResumePage() {
  // ... paste existing component content
}
```

Update all imports in both files to use `~/` paths.

- [ ] **Step 6: Write `src/routes/api/tweets.ts`**

```typescript
import { createFileRoute } from "@tanstack/react-router";
import { Client } from "twitter-api-sdk";
import { TWEETS } from "content/tweets";

async function handle({ request }: { request: Request }) {
  const client = new Client(process.env.TWITTER_CLIENT_BEARER_TOKEN!);
  const twitterData = await client.tweets.findTweetsById({
    ids: TWEETS,
    expansions: ["author_id"],
    "user.fields": ["description", "name"],
    "tweet.fields": ["created_at", "in_reply_to_user_id", "text", "withheld"],
  });

  return new Response(JSON.stringify(twitterData, null, 4), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

export const Route = createFileRoute("/api/tweets")({
  server: { handlers: { GET: handle } },
});
```

- [ ] **Step 7: Write `src/routes/api/typeform-webhook.ts`**

```typescript
import { createFileRoute } from "@tanstack/react-router";

async function handle({ request }: { request: Request }) {
  console.log("Typeform webhook received");
  return Response.json({ name: "John Doe" });
}

export const Route = createFileRoute("/api/typeform-webhook")({
  server: { handlers: { POST: handle } },
});
```

- [ ] **Step 8: Commit**

```bash
git add src/routes/
git commit -m "feat: migrate all pages to TanStack Router routes"
```

---

## Chunk 8: Cleanup & Build Verification

### Task 10: Remove old Next.js files and verify build

**Files:**
- Delete: `pages/` directory
- Delete: `server/trpc/` directory
- Delete: `server/api-routes/` directory
- Delete: `prisma/` directory
- Delete: old `components/` directory (now in `src/components/`)
- Delete: old `styles/` directory (now in `src/styles/`)

- [ ] **Step 1: Delete old directories**

```bash
rm -rf pages/
rm -rf server/trpc/
rm -rf server/api-routes/
rm -rf prisma/
rm -rf components/
rm -rf styles/
```

Keep `content/`, `public/`, `utils/`, `@types/` at root — they're still referenced.

- [ ] **Step 2: Update `.gitignore`**

Add TanStack Start / Vite specific entries:

```
.output/
src/routeTree.gen.ts
```

Remove Next.js specific entries:
```
# Remove these:
.next/
out/
```

- [ ] **Step 3: Run TypeScript check**

```bash
bun run tsc
```

Fix all type errors. Common issues:
- Missing type imports from old packages
- Import path mismatches
- `next/` module references that weren't caught

- [ ] **Step 4: Run Biome format and lint**

```bash
bun run check
```

Fix all linting and formatting issues.

- [ ] **Step 5: Run dev server and verify**

```bash
bun run dev
```

Navigate to each route and verify:
- `/` — Hero, About, Timeline, Portfolio sections render
- `/books` — Book list loads from database
- `/resume` — Full resume renders
- `/liz` — Liz page renders
- `/components` — Components page renders
- `/gallery`, `/notes`, `/portfolio`, `/test` — Placeholder pages render
- `/posts/redesign` — Blog post renders
- Dark mode toggle works
- Upvote button on books page works (ORPC mutation)

- [ ] **Step 6: Run production build**

```bash
bun run build
```

Expected: Build succeeds, produces `.output/server/index.mjs`

- [ ] **Step 7: Test production start**

```bash
bun run start
```

Verify the production server runs and serves all routes correctly.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore: remove old Next.js files, verify build passes"
```

---

### Task 11: Final integration and polish

**Files:**
- Verify: all route pages render identically
- Verify: ORPC calls work end-to-end
- Verify: dark mode persists across navigation
- Verify: SEO meta tags are correct

- [ ] **Step 1: Verify and fix remaining import issues**

Grep for any remaining `next/` imports:

```bash
grep -r "from ['\"]next/" src/ server/ content/
```

Fix any found.

- [ ] **Step 2: Verify and fix remaining `components/` path imports**

```bash
grep -r "from ['\"]components/" src/ content/
```

All should be `~/components/` or relative paths.

- [ ] **Step 3: Add sitemap generation**

Create a simple server route for sitemap.xml:

```typescript
// src/routes/api/sitemap.ts
import { createStartAPIHandler } from "@tanstack/react-start/api";

const SITE_URL = "https://flext.dev";
const routes = ["/", "/books", "/gallery", "/notes", "/portfolio", "/resume", "/liz", "/components"];

export const APIRoute = createStartAPIHandler(async () => {
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${routes.map((route) => `  <url><loc>${SITE_URL}${route}</loc></url>`).join("\n")}
</urlset>`;

  return new Response(sitemap, {
    headers: { "Content-Type": "application/xml" },
  });
});
```

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat: complete Next.js to TanStack Start migration"
```

- [ ] **Step 5: Verify production build one final time**

```bash
bun run build && bun run start
```

Visit all routes, verify visual output matches the original Next.js site.

---

## Dependency Summary

| Task | Depends On |
|------|-----------|
| Task 1 (Bun/Biome scaffold) | None |
| Task 2 (Vite/TS/Tailwind config) | Task 1 |
| Task 3 (Env validation) | Task 1 |
| Task 4 (Drizzle schema) | Task 1 |
| Task 5 (App shell) | Task 2 |
| Task 6 (Component migration) | Task 5 |
| Task 7 (ORPC) | Task 4 |
| Task 8 (Auth utilities) | Task 4 |
| Task 8b (Auth routes + middleware) | Task 8 |
| Task 9 (Route migration) | Task 5, 6, 7, 8b |
| Task 10 (Cleanup) | Task 9 |
| Task 11 (Polish) | Task 10 |

**Parallelizable:** Tasks 3, 4 can run in parallel. Tasks 7, 8 can run in parallel (both depend only on Task 4).
