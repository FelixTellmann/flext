import { pub } from "./base";
import { booksProcedures } from "./books";
import { fetchProcedures } from "./fetch";

export const orpcRouter = pub.router({
  books: booksProcedures,
  fetch: fetchProcedures,
});

export type ORPCRouter = typeof orpcRouter;
