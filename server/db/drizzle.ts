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
