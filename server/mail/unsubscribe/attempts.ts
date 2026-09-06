import { db } from "@server/db/drizzle";
import { unsubscribeAttempt } from "@server/db/schema";
import { desc, inArray } from "drizzle-orm";

export type UnsubscribeMethod = "http" | "mailto";
export type UnsubscribeAttemptStatus = "sent" | "failed" | "skipped";

export type UnsubscribeAttemptRecord = {
  method: UnsubscribeMethod;
  status: UnsubscribeAttemptStatus;
  response_code: number | null;
  error: string | null;
  attempted_at: Date;
};

export async function recordUnsubscribeAttempt(
  input: UnsubscribeAttemptRecord & { sender_address: string; mailbox_id: string | null },
): Promise<UnsubscribeAttemptRecord> {
  await db.insert(unsubscribeAttempt).values({
    sender_address: input.sender_address,
    mailbox_id: input.mailbox_id,
    method: input.method,
    status: input.status,
    response_code: input.response_code,
    error: input.error,
    attempted_at: input.attempted_at,
    updatedAt: input.attempted_at,
  });
  return {
    method: input.method,
    status: input.status,
    response_code: input.response_code,
    error: input.error,
    attempted_at: input.attempted_at,
  };
}

// The newest attempt per address, keyed by the lower-cased address. Attempts are per sender, not per
// (sender, mailbox): one POST answers for every mailbox the newsletter reaches.
export async function loadLatestUnsubscribeAttempts(addresses: string[]): Promise<Map<string, UnsubscribeAttemptRecord>> {
  const latest = new Map<string, UnsubscribeAttemptRecord>();
  if (addresses.length === 0) {
    return latest;
  }

  const rows = await db
    .select({
      sender_address: unsubscribeAttempt.sender_address,
      method: unsubscribeAttempt.method,
      status: unsubscribeAttempt.status,
      response_code: unsubscribeAttempt.response_code,
      error: unsubscribeAttempt.error,
      attempted_at: unsubscribeAttempt.attempted_at,
    })
    .from(unsubscribeAttempt)
    .where(inArray(unsubscribeAttempt.sender_address, addresses))
    .orderBy(desc(unsubscribeAttempt.attempted_at));

  for (const row of rows) {
    const key = row.sender_address.toLowerCase();
    if (latest.has(key)) {
      continue;
    }
    latest.set(key, {
      method: row.method,
      status: row.status,
      response_code: row.response_code,
      error: row.error,
      attempted_at: row.attempted_at,
    });
  }

  return latest;
}
