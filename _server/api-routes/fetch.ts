import { t } from "_server/trpc/trpc";
import { z } from "zod";
import { JSONParse } from "utils/json-parse";

export const fetchRouter = t.router({
  wordtune: t.procedure.input(z.string().min(1).max(500)).mutation(async ({ input }) => {
    return "";
  }),
});
