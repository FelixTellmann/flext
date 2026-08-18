import { db } from "@server/db/drizzle";
import { message, sender } from "@server/db/schema";
import { eq, isNull, sql } from "drizzle-orm";

export type RepairSenderLinksResult = { updated: number; remaining: number };

// One more zero after the expected ~14,558-row backlog: enough headroom for growth, low enough that a
// misconfigured batch_size still terminates instead of looping over the whole table forever.
const REPAIR_BATCH_CEILING_MULTIPLIER = 200;

export async function repairSenderLinks(input: { batch_size: number }): Promise<RepairSenderLinksResult> {
  const ceiling = input.batch_size * REPAIR_BATCH_CEILING_MULTIPLIER;
  let updated = 0;

  while (updated < ceiling) {
    const batch = await db
      .select({ id: message.id })
      .from(message)
      .innerJoin(sender, eq(sender.address, message.from_address))
      .where(isNull(message.sender_id))
      .limit(input.batch_size);

    if (batch.length === 0) {
      break;
    }

    const ids = batch.map((row) => row.id);
    // MySQL 8.4 rejects LIMIT directly on a multi-table UPDATE ... JOIN, so the batch is bounded by
    // pre-selecting the matching ids and restricting the UPDATE to that exact set instead.
    await db.execute(
      sql`UPDATE \`Message\` m JOIN \`Sender\` s ON s.address = m.fromAddress SET m.senderId = s.id WHERE m.id IN (${sql.join(
        ids.map((id) => sql`${id}`),
        sql`, `,
      )})`,
    );

    updated += ids.length;
    if (ids.length < input.batch_size) {
      break;
    }
  }

  const [row] = await db.select({ count: sql<number>`COUNT(*)` }).from(message).where(isNull(message.sender_id));

  return { updated, remaining: Number(row?.count ?? 0) };
}
