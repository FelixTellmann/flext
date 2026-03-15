import { os } from "@orpc/server";
import { booksProcedures } from "./books";
import { fetchProcedures } from "./fetch";

export const orpcRouter = os.router({
  books: booksProcedures,
  fetch: fetchProcedures,
});

export type ORPCRouter = typeof orpcRouter;
