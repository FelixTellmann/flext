import { bookRouter } from "server/api-routes/books";
import { fetchRouter } from "server/api-routes/fetch";
import { t } from "server/trpc/trpc";

export const trpcRouter = t.router({
  fetch: fetchRouter,
  books: bookRouter,
});
export type TrpcRouter = typeof trpcRouter;
