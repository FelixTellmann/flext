import { db } from "@server/db/drizzle";
import { message } from "@server/db/schema";
import { createIdentityMatcher } from "@server/mail/classify/identity";
import type { MailboxRow } from "@server/mail/mailbox";
import { mailboxIdentityAddresses } from "@server/mail/mailbox";
import type { MailboxProvider } from "@server/mail/providers/types";
import { loadCursor, saveCursor } from "@server/mail/sync/cursor";
import { rekeyFolder } from "@server/mail/sync/rekey";
import { buildUidRange, dropStaleUids, highestUid } from "@server/mail/sync/uid-range";
import { writeMessages } from "@server/mail/sync/writer";
import { parseMailboxFlavor } from "@server/mail/types";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";

export type FolderSyncResult = {
  folder: string;
  new_messages: number;
  flag_updates: number;
  vanished: number;
  resynced: boolean;
};

export async function markVanished(input: { mailbox_id: string; folder: string; uid_validity: string; uids: number[] }): Promise<number> {
  if (input.uids.length === 0) {
    return 0;
  }
  const now = new Date();
  await db
    .update(message)
    .set({ disappeared_at: now, updatedAt: now })
    .where(
      and(
        eq(message.mailbox_id, input.mailbox_id),
        eq(message.folder, input.folder),
        eq(message.uid_validity, input.uid_validity),
        inArray(message.uid, input.uids),
        isNull(message.disappeared_at),
      ),
    );
  return input.uids.length;
}

async function applyFlagChanges(input: {
  mailbox_id: string;
  folder: string;
  uid_validity: string;
  changes: Array<{ uid: number; flags: string[] }>;
}): Promise<number> {
  const now = new Date();
  for (const change of input.changes) {
    const is_seen = change.flags.includes("\\Seen");
    const scope = and(
      eq(message.mailbox_id, input.mailbox_id),
      eq(message.folder, input.folder),
      eq(message.uid_validity, input.uid_validity),
      eq(message.uid, change.uid),
    );
    if (!is_seen) {
      await db
        .update(message)
        .set({ is_seen, is_flagged: change.flags.includes("\\Flagged"), updatedAt: now })
        .where(scope);
      continue;
    }
    // opened_at is the first \Seen transition and never moves afterwards; §8's rescue detection compares it
    // against the action's applied_at, which a bare is_read flag cannot express.
    await db
      .update(message)
      .set({
        is_seen,
        is_flagged: change.flags.includes("\\Flagged"),
        opened_at: sql`COALESCE(${message.opened_at}, ${now})`,
        updatedAt: now,
      })
      .where(scope);
  }
  return input.changes.length;
}

export async function syncFolderIncrementally(input: {
  provider: MailboxProvider;
  mailbox_row: MailboxRow;
  folder: string;
}): Promise<FolderSyncResult> {
  const status = await input.provider.openFolder(input.folder);
  const cursor = await loadCursor({ mailbox_id: input.mailbox_row.id, folder: input.folder, kind: "messages" });
  const matcher = createIdentityMatcher({
    patterns: mailboxIdentityAddresses(input.mailbox_row),
    flavor: parseMailboxFlavor(input.mailbox_row.flavor),
  });

  if (cursor === null) {
    await saveCursor({
      mailbox_id: input.mailbox_row.id,
      folder: input.folder,
      kind: "messages",
      uid_validity: status.uid_validity,
      last_seen_uid: 0,
      highest_modseq: null,
    });
    return { folder: input.folder, new_messages: 0, flag_updates: 0, vanished: 0, resynced: true };
  }

  if (cursor.uid_validity !== status.uid_validity) {
    const rekey = await rekeyFolder({
      provider: input.provider,
      mailbox_row: input.mailbox_row,
      folder: input.folder,
      old_uid_validity: cursor.uid_validity,
      new_uid_validity: status.uid_validity,
    });
    // The server invalidated every UID, so the folder is refetched from UID 1 on the next pass — no
    // exceptions (§4.2 step 1).
    await saveCursor({
      mailbox_id: input.mailbox_row.id,
      folder: input.folder,
      kind: "messages",
      uid_validity: status.uid_validity,
      last_seen_uid: 0,
      highest_modseq: null,
    });
    return { folder: input.folder, new_messages: 0, flag_updates: rekey.rekeyed, vanished: rekey.disappeared, resynced: true };
  }

  let flag_updates = 0;
  let vanished = 0;
  if (input.provider.capabilities.condstore && cursor.highest_modseq !== null) {
    const result = await input.provider.fetchFlagChanges(input.folder, cursor.highest_modseq);
    flag_updates = await applyFlagChanges({
      mailbox_id: input.mailbox_row.id,
      folder: input.folder,
      uid_validity: status.uid_validity,
      changes: result.changes,
    });
    vanished = await markVanished({
      mailbox_id: input.mailbox_row.id,
      folder: input.folder,
      uid_validity: status.uid_validity,
      uids: result.vanished_uids,
    });
  }

  const fetched = await input.provider.fetchHeaders(input.folder, buildUidRange(cursor.last_seen_uid));
  const fresh = dropStaleUids(fetched, cursor.last_seen_uid);
  const written = await writeMessages({
    mailbox_row: input.mailbox_row,
    folder: input.folder,
    uid_validity: status.uid_validity,
    messages: fresh,
    matcher,
  });

  await saveCursor({
    mailbox_id: input.mailbox_row.id,
    folder: input.folder,
    kind: "messages",
    uid_validity: status.uid_validity,
    last_seen_uid: highestUid(fresh, cursor.last_seen_uid),
    highest_modseq: status.highest_modseq,
    last_sync_at: new Date(),
  });

  return { folder: input.folder, new_messages: written.inserted, flag_updates, vanished, resynced: false };
}
