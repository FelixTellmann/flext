import { fetchRouter } from "_server/api-routes/fetch";
import { t } from "_server/trpc/trpc";

export const trpcRouter = t.router({
  fetch: fetchRouter,
});
export type TrpcRouter = typeof trpcRouter;
