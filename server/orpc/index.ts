import { pub } from "./base";
import { booksProcedures } from "./books";
import { fetchProcedures } from "./fetch";
import { mailProcedures } from "./mail";
import { personalGoalProcedures } from "./personal-goals";
import { personalLedgerProcedures } from "./personal-ledger";
import { personalReviewProcedures } from "./personal-review";
import { personalTaskProcedures } from "./personal-tasks";

export const orpcRouter = pub.router({
  books: booksProcedures,
  fetch: fetchProcedures,
  mail: mailProcedures,
  personalGoals: personalGoalProcedures,
  personalLedger: personalLedgerProcedures,
  personalReview: personalReviewProcedures,
  personalTasks: personalTaskProcedures,
});

export type ORPCRouter = typeof orpcRouter;
