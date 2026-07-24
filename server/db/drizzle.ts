import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import * as relations from "./relations";
import * as schema from "./schema";

// PlanetScale URLs include ?sslaccept=strict which mysql2 doesn't recognize.
// Strip it and pass ssl config separately.
const database_url = (process.env.DATABASE_URL ?? "").replace(/[?&]sslaccept=strict/gi, "");

const pool = mysql.createPool({
  uri: database_url,
  ssl: {},
});

export const db = drizzle(pool, {
  schema: { ...schema, ...relations },
  mode: "planetscale",
});
