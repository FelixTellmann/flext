import { os } from "@orpc/server";
import { z } from "zod";

export const fetchProcedures = {
  wordtune: os.input(z.string().min(1).max(500)).handler(async () => {
    return "";
  }),
};
