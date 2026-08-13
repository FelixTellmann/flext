import { db } from "@server/db/drizzle";
import { message } from "@server/db/schema";
import type { MailboxRow } from "@server/mail/mailbox";
import type { MailboxProvider } from "@server/mail/providers/types";
import { loadCursor, saveCursor } from "@server/mail/sync/cursor";
import { markVanished } from "@server/mail/sync/incremental";
import { and, eq, isNull } from "drizzle-orm";

export type ReconcileResult = {
  folder: string;
  vanished: number;
  strategy: "qresync" | "search";
};

export async function reconcileFolder(input: {
  provider: MailboxProvider;
  mailbox_row: MailboxRow;
  folder: string;
}): Promise<ReconcileResult> {
  const status = await input.provider.openFolder(input.folder);
  const cursor = await loadCursor({ mailbox_id: input.mailbox_row.id, folder: input.folder, kind: "messages" });
  if (cursor === null || cursor.uid_validity !== status.uid_validity) {
    return { folder: input.folder, vanished: 0, strategy: "search" };
  }

  const now = new Date();

  // CONDSTORE reports changes but never expunges. With QRESYNC the VANISHED (EARLIER) response carries the
  // UIDs deleted while we were away; without it the only honest answer is a full set difference (§4.3).
  if (input.provider.capabilities.qresync && cursor.highest_modseq !== null) {
    const result = await input.provider.fetchFlagChanges(input.folder, cursor.highest_modseq);
    const vanished = await markVanished({
      mailbox_id: input.mailbox_row.id,
      folder: input.folder,
      uid_validity: status.uid_validity,
      uids: result.vanished_uids,
    });
    await saveCursor({
      mailbox_id: input.mailbox_row.id,
      folder: input.folder,
      kind: "messages",
      uid_validity: cursor.uid_validity,
      last_seen_uid: cursor.last_seen_uid,
      highest_modseq: status.highest_modseq,
      last_reconcile_at: now,
    });
    return { folder: input.folder, vanished, strategy: "qresync" };
  }

  const server_uids = new Set(await input.provider.listUids(input.folder));
  const stored = await db
    .select({ uid: message.uid })
    .from(message)
    .where(
      and(
        eq(message.mailbox_id, input.mailbox_row.id),
        eq(message.folder, input.folder),
        eq(message.uid_validity, status.uid_validity),
        isNull(message.disappeared_at),
      ),
    );

  const missing = stored.map((row) => row.uid).filter((uid) => !server_uids.has(uid));
  const vanished = await markVanished({
    mailbox_id: input.mailbox_row.id,
    folder: input.folder,
    uid_validity: status.uid_validity,
    uids: missing,
  });

  await saveCursor({
    mailbox_id: input.mailbox_row.id,
    folder: input.folder,
    kind: "messages",
    uid_validity: cursor.uid_validity,
    last_seen_uid: cursor.last_seen_uid,
    highest_modseq: cursor.highest_modseq,
    last_reconcile_at: now,
  });

  return { folder: input.folder, vanished, strategy: "search" };
}
