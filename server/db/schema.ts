import { sql } from "drizzle-orm";
import { boolean, datetime, float, int, mysqlTable, primaryKey, text, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

// ─── Post ────────────────────────────────────────────────────────────────────
// Prisma uses @@unique([id]) instead of @id, so no auto-generated primary key
export const post = mysqlTable(
  "Post",
  {
    id: varchar("id", { length: 191 }).notNull(),
    createdAt: datetime("createdAt", { fsp: 3 }).default(sql`CURRENT_TIMESTAMP(3)`).notNull(),
    updatedAt: datetime("updatedAt", { fsp: 3 }).notNull(),
    views: int("views").default(0).notNull(),
    likes: int("likes").default(0).notNull(),
  },
  (table) => ({
    idUnique: uniqueIndex("Post_id_key").on(table.id),
  }),
);

// ─── Account ─────────────────────────────────────────────────────────────────
// Prisma @map directives rename DB columns: e.g. refresh_token → "refreshToken" in DB
export const account = mysqlTable(
  "Account",
  {
    id: varchar("id", { length: 191 }).primaryKey().default(sql`(UUID())`),
    userId: varchar("userId", { length: 191 }).notNull(),
    type: varchar("type", { length: 191 }).notNull(),
    provider: varchar("provider", { length: 191 }).notNull(),
    providerAccountId: varchar("providerAccountId", { length: 191 }).notNull(),
    refresh_token: text("refreshToken"),
    refresh_token_expires_in: int("refreshTokenExpiresIn"),
    access_token: text("accessToken"),
    expires_at: int("expiresAt"),
    token_type: varchar("tokenType", { length: 191 }),
    scope: varchar("scope", { length: 191 }),
    id_token: text("idToken"),
    session_state: varchar("sessionState", { length: 191 }),
    oauth_token_secret: varchar("oauthTokenSecret", { length: 191 }),
    oauth_token: varchar("oauthToken", { length: 191 }),
  },
  (table) => ({
    providerProviderAccountIdUnique: uniqueIndex("Account_provider_providerAccountId_key").on(table.provider, table.providerAccountId),
  }),
);

// ─── Session ─────────────────────────────────────────────────────────────────
export const session = mysqlTable(
  "Session",
  {
    id: varchar("id", { length: 191 }).primaryKey().default(sql`(UUID())`),
    sessionToken: varchar("sessionToken", { length: 191 }).notNull(),
    userId: varchar("userId", { length: 191 }).notNull(),
    expires: datetime("expires", { fsp: 3 }).notNull(),
  },
  (table) => ({
    sessionTokenUnique: uniqueIndex("Session_sessionToken_key").on(table.sessionToken),
  }),
);

// ─── User ────────────────────────────────────────────────────────────────────
export const user = mysqlTable(
  "User",
  {
    id: varchar("id", { length: 191 }).primaryKey().default(sql`(UUID())`),
    name: varchar("name", { length: 191 }),
    email: varchar("email", { length: 191 }),
    emailVerified: datetime("emailVerified", { fsp: 3 }),
    password: varchar("password", { length: 191 }),
    image: varchar("image", { length: 191 }),
    registeredAt: datetime("registeredAt", { fsp: 3 }).default(sql`CURRENT_TIMESTAMP(3)`),
    acceptMarketing: boolean("acceptMarketing").default(true),
  },
  (table) => ({
    emailUnique: uniqueIndex("User_email_key").on(table.email),
  }),
);

// ─── VerificationToken ───────────────────────────────────────────────────────
export const verificationToken = mysqlTable(
  "VerificationToken",
  {
    identifier: varchar("identifier", { length: 191 }).notNull(),
    token: varchar("token", { length: 191 }).notNull(),
    expires: datetime("expires", { fsp: 3 }).notNull(),
  },
  (table) => ({
    tokenUnique: uniqueIndex("VerificationToken_token_key").on(table.token),
    identifierTokenUnique: uniqueIndex("VerificationToken_identifier_token_key").on(table.identifier, table.token),
  }),
);

// ─── Books ───────────────────────────────────────────────────────────────────
export const books = mysqlTable("Books", {
  id: varchar("id", { length: 191 }).primaryKey().default(sql`(UUID())`),
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
