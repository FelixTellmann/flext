import {
  mysqlTable,
  varchar,
  datetime,
  int,
  float,
  boolean,
  text,
  uniqueIndex,
  primaryKey,
} from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";

// ─── Post ────────────────────────────────────────────────────────────────────
// Prisma uses @@unique([id]) instead of @id, so no auto-generated primary key
export const post = mysqlTable(
  "Post",
  {
    id: varchar("id", { length: 191 }).notNull(),
    createdAt: datetime("createdAt", { fsp: 3 })
      .default(sql`CURRENT_TIMESTAMP(3)`)
      .notNull(),
    updatedAt: datetime("updatedAt", { fsp: 3 }).notNull(),
    views: int("views").default(0).notNull(),
    likes: int("likes").default(0).notNull(),
  },
  (table) => ({
    idUnique: uniqueIndex("Post_id_key").on(table.id),
  }),
);

// ─── Comment ─────────────────────────────────────────────────────────────────
export const comment = mysqlTable("Comment", {
  id: varchar("id", { length: 191 }).primaryKey().default(sql`(UUID())`),
  postId: varchar("postId", { length: 191 }).notNull(),
  userId: varchar("userId", { length: 191 }).notNull(),
  comment: varchar("comment", { length: 191 }).default("").notNull(),
});

// ─── Telemetry ───────────────────────────────────────────────────────────────
export const telemetry = mysqlTable("Telemetry", {
  id: int("id").primaryKey().autoincrement(),
  createdAt: datetime("createdAt", { fsp: 3 })
    .default(sql`CURRENT_TIMESTAMP(3)`)
    .notNull(),
  updatedAt: datetime("updatedAt", { fsp: 3 }).notNull(),
  name: varchar("name", { length: 50 }).notNull(),
});

// ─── HabitTracking ───────────────────────────────────────────────────────────
export const habitTracking = mysqlTable("HabitTracking", {
  id: int("id").primaryKey().autoincrement(),
  createdAt: datetime("createdAt", { fsp: 3 })
    .default(sql`CURRENT_TIMESTAMP(3)`)
    .notNull(),
  updatedAt: datetime("updatedAt", { fsp: 3 }).notNull(),
  date: datetime("date", { fsp: 3 })
    .default(sql`CURRENT_TIMESTAMP(3)`)
    .notNull(),
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

// ─── Food ────────────────────────────────────────────────────────────────────
export const food = mysqlTable("Food", {
  id: int("id").primaryKey().autoincrement(),
  createdAt: datetime("createdAt", { fsp: 3 })
    .default(sql`CURRENT_TIMESTAMP(3)`)
    .notNull(),
  updatedAt: datetime("updatedAt", { fsp: 3 }).notNull(),
  name: varchar("name", { length: 191 }).notNull(),
  defaultUnitId: int("defaultUnitId").notNull(),
  defaultQuantity: float("defaultQuantity").notNull(),
  defaultPrice: float("defaultPrice").notNull(),
});

// ─── FoodUnit ────────────────────────────────────────────────────────────────
export const foodUnit = mysqlTable("FoodUnit", {
  id: int("id").primaryKey().autoincrement(),
  createdAt: datetime("createdAt", { fsp: 3 })
    .default(sql`CURRENT_TIMESTAMP(3)`)
    .notNull(),
  updatedAt: datetime("updatedAt", { fsp: 3 }).notNull(),
  name: varchar("name", { length: 191 }).notNull(),
  abbreviation: varchar("abbreviation", { length: 191 }).notNull(),
});

// ─── FoodUnitConversion ──────────────────────────────────────────────────────
export const foodUnitConversion = mysqlTable("FoodUnitConversion", {
  id: int("id").primaryKey().autoincrement(),
  createdAt: datetime("createdAt", { fsp: 3 })
    .default(sql`CURRENT_TIMESTAMP(3)`)
    .notNull(),
  updatedAt: datetime("updatedAt", { fsp: 3 }).notNull(),
  fromUnitId: int("fromUnitId").notNull(),
  toUnitId: int("toUnitId").notNull(),
  multiply: float("multiply").notNull(),
});

// ─── FoodMethod ──────────────────────────────────────────────────────────────
export const foodMethod = mysqlTable("FoodMethod", {
  id: int("id").primaryKey().autoincrement(),
  createdAt: datetime("createdAt", { fsp: 3 })
    .default(sql`CURRENT_TIMESTAMP(3)`)
    .notNull(),
  updatedAt: datetime("updatedAt", { fsp: 3 }).notNull(),
  method: varchar("method", { length: 191 }).notNull(),
});

// ─── FoodRated ───────────────────────────────────────────────────────────────
export const foodRated = mysqlTable("FoodRated", {
  id: int("id").primaryKey().autoincrement(),
  createdAt: datetime("createdAt", { fsp: 3 })
    .default(sql`CURRENT_TIMESTAMP(3)`)
    .notNull(),
  updatedAt: datetime("updatedAt", { fsp: 3 }).notNull(),
  foodId: int("foodId").notNull(),
  unitId: int("unitId").notNull(),
  foodMethodId: int("foodMethodId").notNull(),
  quantity: float("quantity").notNull(),
  rating: float("rating").notNull(),
  habitTrackingId: int("habitTrackingId"),
});

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
    providerProviderAccountIdUnique: uniqueIndex(
      "Account_provider_providerAccountId_key",
    ).on(table.provider, table.providerAccountId),
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
    sessionTokenUnique: uniqueIndex("Session_sessionToken_key").on(
      table.sessionToken,
    ),
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
    registeredAt: datetime("registeredAt", { fsp: 3 }).default(
      sql`CURRENT_TIMESTAMP(3)`,
    ),
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
    identifierTokenUnique: uniqueIndex(
      "VerificationToken_identifier_token_key",
    ).on(table.identifier, table.token),
  }),
);

// ─── Habits ──────────────────────────────────────────────────────────────────
export const habits = mysqlTable("Habits", {
  id: varchar("id", { length: 191 }).primaryKey(),
  createdAt: datetime("createdAt", { fsp: 3 })
    .default(sql`CURRENT_TIMESTAMP(3)`)
    .notNull(),
  updatedAt: datetime("updatedAt", { fsp: 3 }).notNull(),
  data: text("data").notNull(),
  level: int("level").default(0).notNull(),
  userId: varchar("userId", { length: 191 }).notNull(),
});

// ─── Books ───────────────────────────────────────────────────────────────────
export const books = mysqlTable("Books", {
  id: varchar("id", { length: 191 }).primaryKey().default(sql`(UUID())`),
  createdAt: datetime("createdAt", { fsp: 3 })
    .default(sql`CURRENT_TIMESTAMP(3)`)
    .notNull(),
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
