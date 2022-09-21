import { t } from "server/trpc/trpc";
import { z } from "zod";

export const fetchRouter = t.router({
  wordtune: t.procedure.input(z.string().min(1).max(500)).mutation(async ({ input }) => {
    return "";
  }),
});
