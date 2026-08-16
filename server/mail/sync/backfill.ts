import { createIdentityMatcher } from "@server/mail/classify/identity";
import type { MailboxRow } from "@server/mail/mailbox";
import { mailboxIdentityAddresses } from "@server/mail/mailbox";
import type { MailboxProvider } from "@server/mail/providers/types";
import { loadCursor, saveCursor } from "@server/mail/sync/cursor";
import { selectSentFolders, selectSyncFolders } from "@server/mail/sync/folders";
import { batchUidRanges, buildUidRange, dropStaleUids, highestUid } from "@server/mail/sync/uid-range";
import { incrementReplyCounts, writeMessages } from "@server/mail/sync/writer";
import { parseMailboxFlavor } from "@server/mail/types";

export type BackfillResult = {
  folders: number;
  messages: number;
  sent_scanned: number;
  reply_senders: number;
};

// 500 killed the container twice in the same UID window without ever throwing, which points at memory
// rather than a bad row — a JS exception would have been caught and recorded on the SyncRun. 100 cuts
// peak memory per fetch and, because the cursor advances per batch, narrows any repeat to a 100-UID span.
const BACKFILL_BATCH_SIZE = 100;

export async function scanSentFolder(input: {
  provider: MailboxProvider;
  mailbox_row: MailboxRow;
  folder: string;
}): Promise<{ scanned: number; senders: number }> {
  const status = await input.provider.openFolder(input.folder);
  const cursor = await loadCursor({ mailbox_id: input.mailbox_row.id, folder: input.folder, kind: "sent-scan" });
  const from_scratch = cursor === null || cursor.uid_validity !== status.uid_validity;
  const last_seen_uid = from_scratch ? 0 : cursor.last_seen_uid;

  const matcher = createIdentityMatcher({
    patterns: mailboxIdentityAddresses(input.mailbox_row),
    flavor: parseMailboxFlavor(input.mailbox_row.flavor),
  });

  const counts = new Map<string, number>();
  let scanned = 0;
  let highest_seen = last_seen_uid;

  const ranges = from_scratch
    ? batchUidRanges({ uid_next: status.uid_next, batch_size: BACKFILL_BATCH_SIZE })
    : [buildUidRange(last_seen_uid)];

  for (const range of ranges) {
    const fetched = dropStaleUids(await input.provider.fetchHeaders(input.folder, range), highest_seen);
    for (const entry of fetched) {
      scanned += 1;
      const authored_by_me = entry.envelope.from.some((address) => matcher.matches(address.address));
      if (!authored_by_me) {
        continue;
      }
      // "Have I ever written to this person?" is the highest-signal feature in the system and no vendor
      // has it; it costs exactly this one scan (§4.4).
      for (const recipient of [...entry.envelope.to, ...entry.envelope.cc]) {
        if (matcher.matches(recipient.address)) {
          continue;
        }
        counts.set(recipient.address, (counts.get(recipient.address) ?? 0) + 1);
      }
    }
    highest_seen = highestUid(fetched, highest_seen);
  }

  const senders = await incrementReplyCounts({ counts });

  await saveCursor({
    mailbox_id: input.mailbox_row.id,
    folder: input.folder,
    kind: "sent-scan",
    uid_validity: status.uid_validity,
    last_seen_uid: highest_seen,
    highest_modseq: status.highest_modseq,
    last_sync_at: new Date(),
  });

  return { scanned, senders };
}

export async function backfillMailbox(input: { provider: MailboxProvider; mailbox_row: MailboxRow }): Promise<BackfillResult> {
  const flavor = parseMailboxFlavor(input.mailbox_row.flavor);
  const folders = await input.provider.listFolders();
  const matcher = createIdentityMatcher({ patterns: mailboxIdentityAddresses(input.mailbox_row), flavor });

  let messages = 0;
  const walked = selectSyncFolders({ flavor, folders });
  for (const folder of walked) {
    const status = await input.provider.openFolder(folder);
    const cursor = await loadCursor({ mailbox_id: input.mailbox_row.id, folder, kind: "messages" });
    // A backfill can run for hours, and anything that interrupts it — an OOM kill, a dropped IMAP
    // connection, a redeploy — leaves no error to catch. Resuming from the checkpoint and writing one
    // after every batch caps the loss at a single batch instead of the whole folder.
    const resume_from = cursor !== null && cursor.uid_validity === status.uid_validity ? cursor.last_seen_uid : 0;

    for (const range of batchUidRanges({ uid_next: status.uid_next, batch_size: BACKFILL_BATCH_SIZE, from_uid: resume_from + 1 })) {
      const fetched = await input.provider.fetchHeaders(folder, range);
      const written = await writeMessages({
        mailbox_row: input.mailbox_row,
        folder,
        uid_validity: status.uid_validity,
        messages: fetched,
        matcher,
      });
      messages += written.inserted;

      // The checkpoint is the end of the range just walked, not the highest UID returned: folders are
      // sparse (one mailbox held 1891 messages across UIDs 484-5700), so a batch that matches nothing
      // would otherwise leave the cursor behind and refetch that span forever.
      await saveCursor({
        mailbox_id: input.mailbox_row.id,
        folder,
        kind: "messages",
        uid_validity: status.uid_validity,
        last_seen_uid: Number(range.split(":")[1]),
        highest_modseq: status.highest_modseq,
        last_sync_at: new Date(),
      });
    }
  }

  let sent_scanned = 0;
  let reply_senders = 0;
  for (const folder of selectSentFolders(folders)) {
    const scan = await scanSentFolder({ provider: input.provider, mailbox_row: input.mailbox_row, folder });
    sent_scanned += scan.scanned;
    reply_senders += scan.senders;
  }

  return { folders: walked.length, messages, sent_scanned, reply_senders };
}
