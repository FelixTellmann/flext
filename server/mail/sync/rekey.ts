import { db } from "@server/db/drizzle";
import { message } from "@server/db/schema";
import type { MailboxRow } from "@server/mail/mailbox";
import type { MailboxProvider } from "@server/mail/providers/types";
import { parseMailboxFlavor } from "@server/mail/types";
import { and, eq, isNull } from "drizzle-orm";

export type RekeyResult = {
  rekeyed: number;
  disappeared: number;
};

export async function rekeyFolder(input: {
  provider: MailboxProvider;
  mailbox_row: MailboxRow;
  folder: string;
  old_uid_validity: string;
  new_uid_validity: string;
}): Promise<RekeyResult> {
  const gmail = parseMailboxFlavor(input.mailbox_row.flavor) === "gmail";
  const identities = await input.provider.fetchIdentities(input.folder);

  const rows = await db
    .select({ id: message.id, gm_msgid: message.gm_msgid, message_id: message.message_id })
    .from(message)
    .where(
      and(
        eq(message.mailbox_id, input.mailbox_row.id),
        eq(message.folder, input.folder),
        eq(message.uid_validity, input.old_uid_validity),
        isNull(message.disappeared_at),
      ),
    );

  // UIDs are gone after a server-side reindex, but X-GM-MSGID (Gmail) and RFC Message-ID (generic) are not.
  // Without this the whole action journal silently detaches from its messages (§11).
  const by_stable_key = new Map<string, string>();
  for (const row of rows) {
    const key = gmail ? row.gm_msgid : row.message_id;
    if (key === null) {
      continue;
    }
    by_stable_key.set(key, row.id);
  }

  const now = new Date();
  const matched_ids = new Set<string>();
  for (const identity of identities) {
    const key = gmail ? identity.gm_msgid : identity.message_id;
    if (key === null) {
      continue;
    }
    const row_id = by_stable_key.get(key);
    if (row_id === undefined) {
      continue;
    }
    await db.update(message).set({ uid: identity.uid, uid_validity: input.new_uid_validity, updatedAt: now }).where(eq(message.id, row_id));
    matched_ids.add(row_id);
  }

  let disappeared = 0;
  for (const row of rows) {
    if (matched_ids.has(row.id)) {
      continue;
    }
    await db.update(message).set({ disappeared_at: now, updatedAt: now }).where(eq(message.id, row.id));
    disappeared += 1;
  }

  return { rekeyed: matched_ids.size, disappeared };
}
