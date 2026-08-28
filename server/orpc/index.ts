import { pub } from "./base";
import { booksProcedures } from "./books";
import { fetchProcedures } from "./fetch";
import { mailProcedures } from "./mail";
import { personalLedgerProcedures } from "./personal-ledger";
import { personalTaskProcedures } from "./personal-tasks";

export const orpcRouter = pub.router({
  books: booksProcedures,
  fetch: fetchProcedures,
  mail: mailProcedures,
  personalLedger: personalLedgerProcedures,
  personalTasks: personalTaskProcedures,
});

export type ORPCRouter = typeof orpcRouter;
