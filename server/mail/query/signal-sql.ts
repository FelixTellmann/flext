import { message } from "@server/db/schema";
import { BULK_PRECEDENCE_VALUES } from "@server/mail/classify/signals";
import type { SQL } from "drizzle-orm";
import { sql } from "drizzle-orm";

// The SQL half of §5.1's Precedence rule, kept honest against the pure half: normalizePrecedence() maps
// null to "" before lowercasing and trimming, so COALESCE ahead of LOWER(TRIM(...)) is the same input,
// and BULK_PRECEDENCE_VALUES is the same value list rather than a second copy of the literals. COALESCE
// also keeps NOT(...) usable — a bare comparison against NULL is NULL, which would drop every row that
// carries no Precedence header at all.
export function isBulkPrecedenceSql(): SQL<boolean> {
  return sql<boolean>`LOWER(TRIM(COALESCE(${message.precedence}, ''))) IN (${sql.join(
    BULK_PRECEDENCE_VALUES.map((value) => sql`${value}`),
    sql`, `,
  )})`;
}
