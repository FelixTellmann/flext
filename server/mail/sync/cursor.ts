import { db } from "@server/db/drizzle";
import { mailboxCursor } from "@server/db/schema";
import { and, eq } from "drizzle-orm";

export type CursorKind = "messages" | "sent-scan" | "reclassify";
export type CursorRecord = typeof mailboxCursor.$inferSelect;

export async function loadCursor(input: { mailbox_id: string; folder: string; kind: CursorKind }): Promise<CursorRecord | null> {
  const rows = await db
    .select()
    .from(mailboxCursor)
    .where(and(eq(mailboxCursor.mailbox_id, input.mailbox_id), eq(mailboxCursor.folder, input.folder), eq(mailboxCursor.kind, input.kind)))
    .limit(1);
  return rows[0] ?? null;
}

export async function saveCursor(input: {
  mailbox_id: string;
  folder: string;
  kind: CursorKind;
  uid_validity: string;
  last_seen_uid: number;
  highest_modseq: string | null;
  last_sync_at?: Date;
  last_reconcile_at?: Date;
}): Promise<void> {
  const now = new Date();
  await db
    .insert(mailboxCursor)
    .values({
      mailbox_id: input.mailbox_id,
      folder: input.folder,
      kind: input.kind,
      uid_validity: input.uid_validity,
      last_seen_uid: input.last_seen_uid,
      highest_modseq: input.highest_modseq,
      last_sync_at: input.last_sync_at ?? null,
      last_reconcile_at: input.last_reconcile_at ?? null,
      updatedAt: now,
    })
    .onDuplicateKeyUpdate({
      set: {
        uid_validity: input.uid_validity,
        last_seen_uid: input.last_seen_uid,
        highest_modseq: input.highest_modseq,
        ...(input.last_sync_at ? { last_sync_at: input.last_sync_at } : {}),
        ...(input.last_reconcile_at ? { last_reconcile_at: input.last_reconcile_at } : {}),
        updatedAt: now,
      },
    });
}
