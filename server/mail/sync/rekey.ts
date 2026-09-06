import { db } from "@server/db/drizzle";
import { message } from "@server/db/schema";
import type { MailboxRow } from "@server/mail/mailbox";
import type { MailboxProvider, MessageIdentity } from "@server/mail/providers/types";
import { parseMailboxFlavor } from "@server/mail/types";
import { and, eq, isNull } from "drizzle-orm";

export type RekeyResult = {
  rekeyed: number;
  resurrected: number;
  disappeared: number;
};

export type RekeyRow = { id: string; stable_key: string | null };
export type RekeyOccupant = RekeyRow & { uid: number; vanished: boolean };
export type RekeyPlan = {
  moves: Array<{ row_id: string; uid: number }>;
  resurrected: string[];
  disappeared: string[];
};

export function stableKey(input: { gmail: boolean; gm_msgid: string | null; message_id: string | null }): string | null {
  return input.gmail ? input.gm_msgid : input.message_id;
}

// UIDs are gone after a server-side reindex, but X-GM-MSGID (Gmail) and RFC Message-ID (generic) are not.
// Without this the whole action journal silently detaches from its messages (§11).
//
// `occupants` are the rows already keyed under the new validity. A server can hand back a validity it used
// before — xneelo restored felix@tellmann.co.za's INBOX on 2026-09-06 with its 2017 UIDVALIDITY and its old
// UIDs after three days on a rebuilt one — and then every row the earlier re-key marked vanished still sits
// at exactly the (folder, validity, uid) the move wants to write, and the unique index rejects the move.
// The vanished row IS that message, so it is brought back instead, and the copy under the retired validity
// is retired with it.
export function planRekey(input: {
  rows: RekeyRow[];
  identities: MessageIdentity[];
  occupants: RekeyOccupant[];
  gmail: boolean;
}): RekeyPlan {
  const by_stable_key = new Map<string, string>();
  for (const row of input.rows) {
    if (row.stable_key === null) {
      continue;
    }
    by_stable_key.set(row.stable_key, row.id);
  }

  const occupied = new Map<number, RekeyOccupant>();
  for (const occupant of input.occupants) {
    occupied.set(occupant.uid, occupant);
  }

  // A message the server lists twice under the same stable key ends up at its last UID; the earlier UID
  // is inserted fresh by the next fetch. That was already the behaviour and is what the fixtures pin.
  const placement = new Map<string, number>();
  const resurrected = new Set<string>();
  for (const identity of input.identities) {
    const key = stableKey({ gmail: input.gmail, gm_msgid: identity.gm_msgid, message_id: identity.message_id });
    if (key === null) {
      continue;
    }
    const row_id = by_stable_key.get(key);
    if (row_id === undefined) {
      continue;
    }
    const occupant = occupied.get(identity.uid);
    if (occupant !== undefined && occupant.id !== row_id) {
      // A row whose stable key differs holds a different message at this UID; neither moving onto it nor
      // reviving it would be true, so the UID is left to the next fetch, whose upsert refreshes it.
      if (occupant.stable_key === key && occupant.vanished) {
        resurrected.add(occupant.id);
      }
      continue;
    }
    placement.set(row_id, identity.uid);
    occupied.set(identity.uid, { id: row_id, uid: identity.uid, stable_key: key, vanished: false });
  }

  const disappeared: string[] = [];
  for (const row of input.rows) {
    if (placement.has(row.id)) {
      continue;
    }
    disappeared.push(row.id);
  }

  return {
    moves: [...placement.entries()].map(([row_id, uid]) => ({ row_id, uid })),
    resurrected: [...resurrected],
    disappeared,
  };
}

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

  const occupants = await db
    .select({
      id: message.id,
      uid: message.uid,
      gm_msgid: message.gm_msgid,
      message_id: message.message_id,
      disappeared_at: message.disappeared_at,
    })
    .from(message)
    .where(
      and(eq(message.mailbox_id, input.mailbox_row.id), eq(message.folder, input.folder), eq(message.uid_validity, input.new_uid_validity)),
    );

  const plan = planRekey({
    rows: rows.map((row) => ({ id: row.id, stable_key: stableKey({ gmail, gm_msgid: row.gm_msgid, message_id: row.message_id }) })),
    identities,
    occupants: occupants.map((row) => ({
      id: row.id,
      uid: row.uid,
      stable_key: stableKey({ gmail, gm_msgid: row.gm_msgid, message_id: row.message_id }),
      vanished: row.disappeared_at !== null,
    })),
    gmail,
  });

  const now = new Date();
  for (const move of plan.moves) {
    await db
      .update(message)
      .set({ uid: move.uid, uid_validity: input.new_uid_validity, updatedAt: now })
      .where(eq(message.id, move.row_id));
  }
  for (const row_id of plan.resurrected) {
    await db.update(message).set({ disappeared_at: null, updatedAt: now }).where(eq(message.id, row_id));
  }
  for (const row_id of plan.disappeared) {
    await db.update(message).set({ disappeared_at: now, updatedAt: now }).where(eq(message.id, row_id));
  }

  return { rekeyed: plan.moves.length, resurrected: plan.resurrected.length, disappeared: plan.disappeared.length };
}
