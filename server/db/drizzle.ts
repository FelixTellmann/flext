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
