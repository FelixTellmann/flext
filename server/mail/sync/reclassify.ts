import { db } from "@server/db/drizzle";
import { message } from "@server/db/schema";
import { dkimAligned } from "@server/mail/classify/authentication";
import type { IdentityMatcher } from "@server/mail/classify/identity";
import { createIdentityMatcher, isAddressedToMe, isCcMe } from "@server/mail/classify/identity";
import type { MailboxRow } from "@server/mail/mailbox";
import { mailboxIdentityAddresses } from "@server/mail/mailbox";
import { extractAddresses, headerValue, headerValues } from "@server/mail/providers/headers";
import { hasHumanAttachment, isCalendarMessage } from "@server/mail/providers/structure";
import type { FetchedMessage, HeaderMap, MailboxProvider } from "@server/mail/providers/types";
import { loadCursor, saveCursor } from "@server/mail/sync/cursor";
import { selectSyncFolders } from "@server/mail/sync/folders";
import { batchUidRanges } from "@server/mail/sync/uid-range";
import { parseMailboxFlavor } from "@server/mail/types";
import { and, eq, inArray } from "drizzle-orm";

export type ReclassifyResult = {
  examined: number;
  changed: number;
};

type StoredClassification = {
  id: string;
  uid: number;
  from_domain: string | null;
  to_me: boolean;
  cc_me: boolean;
  dkim_aligned: boolean | null;
  has_attachment: boolean;
  is_calendar: boolean | null;
};

type DerivedClassification = {
  to_me: boolean;
  cc_me: boolean;
  dkim_aligned: boolean | null;
  // The calendar-detection backfill. This pass already re-fetches every stored message to re-derive
  // columns — it is how the corrected identity list and the fixed DKIM parser reached existing mail — so
  // adding BODYSTRUCTURE to its fetch is the whole backfill. ~50,000 rows carry is_calendar = null until
  // it runs, and a signal that only applied to mail arriving from now on would not solve the problem that
  // prompted it: the ~263 meeting invitations already sitting in the inbox.
  has_attachment: boolean;
  is_calendar: boolean | null;
};

function headerAddresses(headers: HeaderMap, name: string): string[] {
  return headerValues(headers, name).flatMap((value) => extractAddresses(value));
}

function deriveClassification(input: {
  fetched: FetchedMessage;
  stored: StoredClassification;
  matcher: IdentityMatcher;
}): DerivedClassification {
  return {
    to_me: isAddressedToMe(
      {
        to: input.fetched.envelope.to.map((address) => address.address),
        delivered_to: headerAddresses(input.fetched.headers, "Delivered-To"),
        x_original_to: headerAddresses(input.fetched.headers, "X-Original-To"),
      },
      input.matcher,
    ),
    cc_me: isCcMe(
      input.fetched.envelope.cc.map((address) => address.address),
      input.matcher,
    ),
    // Alignment is judged against the From domain already recorded on the row, not one re-derived from
    // this fetch: an envelope that comes back without a From would otherwise wipe a correct verdict to
    // NULL, which is the exact failure this pass exists to undo.
    dkim_aligned: dkimAligned(headerValue(input.fetched.headers, "Authentication-Results"), input.stored.from_domain),
    // Both derived from the MIME structure, and both KEEP their stored value when the server returned
    // none. Same reasoning as the From-domain line above: a fetch that comes back without a structure
    // must not wipe a verdict a previous pass established, and null here means "never observed" rather
    // than "observed to be absent".
    has_attachment: input.fetched.structure === null ? input.stored.has_attachment : hasHumanAttachment(input.fetched.structure),
    is_calendar: input.fetched.structure === null ? input.stored.is_calendar : isCalendarMessage(input.fetched.structure),
  };
}

async function loadStoredClassifications(input: {
  mailbox_id: string;
  folder: string;
  uid_validity: string;
  uids: number[];
}): Promise<Map<number, StoredClassification>> {
  if (input.uids.length === 0) {
    return new Map();
  }
  const rows = await db
    .select({
      id: message.id,
      uid: message.uid,
      from_domain: message.from_domain,
      to_me: message.to_me,
      cc_me: message.cc_me,
      dkim_aligned: message.dkim_aligned,
      has_attachment: message.has_attachment,
      is_calendar: message.is_calendar,
    })
    .from(message)
    .where(
      and(
        eq(message.mailbox_id, input.mailbox_id),
        eq(message.folder, input.folder),
        eq(message.uid_validity, input.uid_validity),
        inArray(message.uid, input.uids),
      ),
    );
  return new Map(rows.map((row) => [row.uid, row]));
}

async function reclassifyFolder(input: {
  provider: MailboxProvider;
  mailbox_row: MailboxRow;
  folder: string;
  matcher: IdentityMatcher;
  batch_size: number;
}): Promise<ReclassifyResult> {
  const status = await input.provider.openFolder(input.folder);
  // A dedicated cursor kind keeps this pass from disturbing the message cursor or the Sent scan, so an
  // incremental sync running on the same folder mid-reclassify still resumes from its own checkpoint. A
  // finished folder leaves the cursor at uid_next - 1, so correcting the identity list again later means
  // deleting the kind = 'reclassify' rows before the next run does anything.
  const cursor = await loadCursor({ mailbox_id: input.mailbox_row.id, folder: input.folder, kind: "reclassify" });
  const resume_from = cursor !== null && cursor.uid_validity === status.uid_validity ? cursor.last_seen_uid : 0;

  let examined = 0;
  let changed = 0;

  for (const range of batchUidRanges({ uid_next: status.uid_next, batch_size: input.batch_size, from_uid: resume_from + 1 })) {
    // fetchHeaders is the only fetch this pass makes. It compiles to BODY.PEEK[HEADER.FIELDS (...)] plus
    // ENVELOPE and BODYSTRUCTURE — a bare BODY[] would set \Seen on every message it read (§4.2), and
    // BODYSTRUCTURE is the server describing the MIME tree rather than sending any of it, so neither
    // touches a flag nor transfers a body.
    const fetched = await input.provider.fetchHeaders(input.folder, range);
    const stored = await loadStoredClassifications({
      mailbox_id: input.mailbox_row.id,
      folder: input.folder,
      uid_validity: status.uid_validity,
      uids: fetched.map((entry) => entry.uid),
    });

    for (const entry of fetched) {
      const row = stored.get(entry.uid);
      if (row === undefined) {
        continue;
      }
      examined += 1;

      const derived = deriveClassification({ fetched: entry, stored: row, matcher: input.matcher });
      // Writing every row unconditionally would push updatedAt across the whole table and leave `changed`
      // saying nothing about what the pass actually corrected.
      // Every derived field, not the three this pass started with. Comparing a subset would make the
      // calendar backfill a silent no-op on every row whose identity and DKIM verdicts were already
      // right — which is nearly all of them, and is precisely the set the backfill exists to reach.
      if (
        derived.to_me === row.to_me &&
        derived.cc_me === row.cc_me &&
        derived.dkim_aligned === row.dkim_aligned &&
        derived.has_attachment === row.has_attachment &&
        derived.is_calendar === row.is_calendar
      ) {
        continue;
      }

      await db
        .update(message)
        .set({ ...derived, updatedAt: new Date() })
        .where(eq(message.id, row.id));
      changed += 1;
    }

    // Checkpointing the end of the range rather than the highest UID returned mirrors the backfill: sparse
    // folders would otherwise leave the cursor behind a batch that matched nothing and refetch it forever.
    await saveCursor({
      mailbox_id: input.mailbox_row.id,
      folder: input.folder,
      kind: "reclassify",
      uid_validity: status.uid_validity,
      last_seen_uid: Number(range.split(":")[1]),
      highest_modseq: status.highest_modseq,
      last_sync_at: new Date(),
    });
  }

  return { examined, changed };
}

export async function reclassifyMailbox(input: {
  provider: MailboxProvider;
  mailbox_row: MailboxRow;
  batch_size: number;
}): Promise<ReclassifyResult> {
  const flavor = parseMailboxFlavor(input.mailbox_row.flavor);
  const folders = await input.provider.listFolders();
  const matcher = createIdentityMatcher({ patterns: mailboxIdentityAddresses(input.mailbox_row), flavor });

  const totals: ReclassifyResult = { examined: 0, changed: 0 };
  for (const folder of selectSyncFolders({ flavor, folders })) {
    const result = await reclassifyFolder({
      provider: input.provider,
      mailbox_row: input.mailbox_row,
      folder,
      matcher,
      batch_size: input.batch_size,
    });
    totals.examined += result.examined;
    totals.changed += result.changed;
  }

  return totals;
}
