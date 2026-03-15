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
