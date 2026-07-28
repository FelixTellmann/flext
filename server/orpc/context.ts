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
