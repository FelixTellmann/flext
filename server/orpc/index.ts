import { pub } from "./base";
import { booksProcedures } from "./books";
import { fetchProcedures } from "./fetch";
import { mailProcedures } from "./mail";

export const orpcRouter = pub.router({
  books: booksProcedures,
  fetch: fetchProcedures,
  mail: mailProcedures,
});

export type ORPCRouter = typeof orpcRouter;
