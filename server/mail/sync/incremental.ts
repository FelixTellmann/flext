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
    // opened_at is the first OBSERVED unseen→seen transition and never moves afterwards; §8's rescue
    // detection compares it against the action's applied_at, which a bare is_read flag cannot express.
    //
    // The guard on the stored is_seen is what makes it a transition rather than a sighting. CONDSTORE
    // reports everything above the stored MODSEQ, and applying an action mutates the message — a MOVE, or
    // a Gmail label change — which bumps that MODSEQ. So the sync after a bulk apply is re-told about
    // every message the apply touched, each carrying the \Seen it has held for years. Stamping on that
    // sighting wrote openedAt = now for 1,562 already-read messages on 2026-08-22, every one of them
    // later than its own appliedAt, and the rescue detector read the lot as "the operator rescued this"
    // and suspended 34 policies.
    //
    // Since inbox-dwell 1.5 this guard carries a SECOND load, and the newer one is generated on purpose
    // rather than stumbled into. The executor can now mark messages \Seen itself (quarantine does, on
    // every first contact it moves), and that write comes back through this exact path looking like a
    // human opening the message. actions/journal.ts's recordSelfMarkedRead writes Message.isSeen = 1
    // BEFORE the STORE goes out, so by the time the flag is reported here the stored value is already 1
    // and nothing is stamped. Anything that weakens this guard re-arms the sweeps to suspend themselves.
    //
    // The consequence is deliberate: mail that was already read when it was backfilled never receives an
    // openedAt, because there is no evidence of when it was opened and inventing one is what broke this.
    // felix@tellmann.co.za shows the end state — 4 of 4,719 applied messages carry one — so `opened`
    // detection there is near-blind, honestly, in the same way `starred` is absent in signals.ts.
    await db
      .update(message)
      .set({
        // ORDER IS LOAD-BEARING and must stay above is_seen: MySQL evaluates an UPDATE's SET assignments
        // left to right, and a column read after its own assignment yields the NEW value. is_seen is
        // assigned in this same clause, so reading it below its own assignment would compare against the
        // value this sync is writing (always 1 here) and the guard would never hold.
        opened_at: sql`IF(${message.is_seen} = 0, COALESCE(${message.opened_at}, ${now}), ${message.opened_at})`,
        is_seen,
        is_flagged: change.flags.includes("\\Flagged"),
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
