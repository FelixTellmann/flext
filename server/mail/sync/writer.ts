import { db } from "@server/db/drizzle";
import { mailboxObservedAddress, message, sender } from "@server/db/schema";
import { dkimAligned } from "@server/mail/classify/authentication";
import type { IdentityMatcher } from "@server/mail/classify/identity";
import { isAddressedToMe, isCcMe } from "@server/mail/classify/identity";
import { deriveThreadKey } from "@server/mail/classify/thread";
import type { MailboxRow } from "@server/mail/mailbox";
import { extractAddresses, headerValue, headerValues } from "@server/mail/providers/headers";
import type { FetchedMessage } from "@server/mail/providers/types";
import { serializeStringList } from "@server/mail/types";
import { and, eq, inArray, sql } from "drizzle-orm";

export type WriteResult = {
  inserted: number;
  updated: number;
};

const INSERT_CHUNK_SIZE = 200;

type SenderAggregate = {
  address: string;
  domain: string;
  display_name: string | null;
  count: number;
  last_seen_at: Date;
};

function addressDomain(address: string): string {
  return address.slice(address.lastIndexOf("@") + 1);
}

// Header values have no practical upper bound — a 191-char messageId column killed a whole 100-message
// batch with ER_DATA_TOO_LONG. The columns are wider now; this keeps one absurd header from failing the
// batch again rather than just losing its own tail.
function clamp(value: string | null, max: number): string | null {
  if (value === null || value.length <= max) {
    return value;
  }
  return value.slice(0, max);
}

function headerAddresses(headers: FetchedMessage["headers"], name: string): string[] {
  return headerValues(headers, name).flatMap((value) => extractAddresses(value));
}

async function existingUids(input: { mailbox_id: string; folder: string; uid_validity: string; uids: number[] }): Promise<Set<number>> {
  if (input.uids.length === 0) {
    return new Set();
  }
  const rows = await db
    .select({ uid: message.uid })
    .from(message)
    .where(
      and(
        eq(message.mailbox_id, input.mailbox_id),
        eq(message.folder, input.folder),
        eq(message.uid_validity, input.uid_validity),
        inArray(message.uid, input.uids),
      ),
    );
  return new Set(rows.map((row) => row.uid));
}

async function upsertSenders(aggregates: SenderAggregate[]): Promise<Map<string, string>> {
  const now = new Date();
  for (const aggregate of aggregates) {
    await db
      .insert(sender)
      .values({
        address: clamp(aggregate.address, 320) ?? "",
        domain: clamp(aggregate.domain, 253) ?? "",
        display_name: clamp(aggregate.display_name, 320),
        message_count: aggregate.count,
        first_seen_at: aggregate.last_seen_at,
        last_seen_at: aggregate.last_seen_at,
        updatedAt: now,
      })
      .onDuplicateKeyUpdate({
        set: {
          message_count: sql`${sender.message_count} + ${aggregate.count}`,
          last_seen_at: aggregate.last_seen_at,
          updatedAt: now,
        },
      });
  }

  const addresses = aggregates.map((aggregate) => clamp(aggregate.address, 320) ?? "");
  if (addresses.length === 0) {
    return new Map();
  }
  // MySQL's ON DUPLICATE KEY UPDATE never returns ids for the rows it updated, and Drizzle's
  // $returningId yields nothing when the primary key is a SQL default (Sender.id is
  // `.default(sql\`(UUID())\`)`) — that gap left every sync run stuck at status "running" in
  // Phase 1. Resolving ids with one SELECT per batch avoids both.
  const rows = await db.select({ id: sender.id, address: sender.address }).from(sender).where(inArray(sender.address, addresses));
  return new Map(rows.map((row) => [row.address.toLowerCase(), row.id]));
}

async function upsertObservedAddresses(input: {
  mailbox_id: string;
  observed: Map<string, { source_header: string; count: number }>;
}): Promise<void> {
  const now = new Date();
  for (const [address, entry] of input.observed) {
    await db
      .insert(mailboxObservedAddress)
      .values({
        mailbox_id: input.mailbox_id,
        address: clamp(address, 320) ?? "",
        source_header: entry.source_header,
        occurrences: entry.count,
        first_seen_at: now,
        last_seen_at: now,
        updatedAt: now,
      })
      .onDuplicateKeyUpdate({
        set: {
          occurrences: sql`${mailboxObservedAddress.occurrences} + ${entry.count}`,
          last_seen_at: now,
          updatedAt: now,
        },
      });
  }
}

export async function writeMessages(input: {
  mailbox_row: MailboxRow;
  folder: string;
  uid_validity: string;
  messages: FetchedMessage[];
  matcher: IdentityMatcher;
}): Promise<WriteResult> {
  if (input.messages.length === 0) {
    return { inserted: 0, updated: 0 };
  }

  const known_uids = await existingUids({
    mailbox_id: input.mailbox_row.id,
    folder: input.folder,
    uid_validity: input.uid_validity,
    uids: input.messages.map((entry) => entry.uid),
  });

  const now = new Date();
  const sender_aggregates = new Map<string, SenderAggregate>();
  const observed = new Map<string, { source_header: string; count: number }>();
  const rows = input.messages.map((entry) => {
    const from = entry.envelope.from[0] ?? null;
    const from_address = from?.address ?? null;
    const from_domain = from_address === null ? null : addressDomain(from_address);
    const delivered_to = headerAddresses(entry.headers, "Delivered-To");
    const x_original_to = headerAddresses(entry.headers, "X-Original-To");
    const content_type = headerValue(entry.headers, "Content-Type");

    if (from_address !== null && from_domain !== null && !known_uids.has(entry.uid)) {
      const aggregate = sender_aggregates.get(from_address);
      if (aggregate === undefined) {
        sender_aggregates.set(from_address, {
          address: from_address,
          domain: from_domain,
          display_name: from?.name ?? null,
          count: 1,
          last_seen_at: entry.internal_date,
        });
      }
      if (aggregate !== undefined) {
        aggregate.count += 1;
        aggregate.last_seen_at = entry.internal_date > aggregate.last_seen_at ? entry.internal_date : aggregate.last_seen_at;
      }
    }

    for (const address of delivered_to) {
      const seen = observed.get(address);
      observed.set(address, { source_header: "Delivered-To", count: (seen?.count ?? 0) + 1 });
    }
    for (const address of x_original_to) {
      const seen = observed.get(address);
      observed.set(address, { source_header: seen?.source_header ?? "X-Original-To", count: (seen?.count ?? 0) + 1 });
    }

    return {
      mailbox_id: input.mailbox_row.id,
      folder: input.folder,
      uid: entry.uid,
      uid_validity: input.uid_validity,
      gm_msgid: entry.gm_msgid,
      gm_thrid: entry.gm_thrid,
      message_id: clamp(entry.envelope.message_id, 512),
      thread_key: clamp(
        deriveThreadKey({
          gm_thrid: entry.gm_thrid,
          references: headerValue(entry.headers, "References"),
          in_reply_to: entry.envelope.in_reply_to,
          message_id: entry.envelope.message_id,
        }),
        512,
      ),
      from_address: clamp(from_address, 320),
      from_domain: clamp(from_domain, 253),
      from_name: clamp(from?.name ?? null, 320),
      to_me: isAddressedToMe({ to: entry.envelope.to.map((address) => address.address), delivered_to, x_original_to }, input.matcher),
      cc_me: isCcMe(
        entry.envelope.cc.map((address) => address.address),
        input.matcher,
      ),
      subject: entry.envelope.subject,
      sent_at: entry.envelope.date,
      internal_date: entry.internal_date,
      size: entry.size,
      has_attachment: (content_type ?? "").toLowerCase().startsWith("multipart/mixed"),
      list_id: clamp(headerValue(entry.headers, "List-Id"), 320),
      list_unsubscribe: headerValue(entry.headers, "List-Unsubscribe"),
      precedence: clamp(headerValue(entry.headers, "Precedence"), 191),
      auto_submitted: clamp(headerValue(entry.headers, "Auto-Submitted"), 191),
      dkim_aligned: dkimAligned(headerValue(entry.headers, "Authentication-Results"), from_domain),
      is_seen: entry.flags.includes("\\Seen"),
      is_flagged: entry.flags.includes("\\Flagged"),
      labels: entry.labels === null ? null : serializeStringList(entry.labels),
      updatedAt: now,
    };
  });

  const sender_ids = await upsertSenders([...sender_aggregates.values()]);
  const rows_with_sender = rows.map((row) => ({
    ...row,
    sender_id: row.from_address === null ? null : (sender_ids.get(row.from_address.toLowerCase()) ?? null),
  }));

  for (let offset = 0; offset < rows_with_sender.length; offset += INSERT_CHUNK_SIZE) {
    const chunk = rows_with_sender.slice(offset, offset + INSERT_CHUNK_SIZE);
    await db
      .insert(message)
      .values(chunk)
      .onDuplicateKeyUpdate({
        set: {
          uid: sql`VALUES(\`uid\`)`,
          uid_validity: sql`VALUES(\`uidValidity\`)`,
          is_seen: sql`VALUES(\`isSeen\`)`,
          is_flagged: sql`VALUES(\`isFlagged\`)`,
          labels: sql`VALUES(\`labels\`)`,
          disappeared_at: null,
          updatedAt: now,
        },
      });
  }

  await upsertObservedAddresses({ mailbox_id: input.mailbox_row.id, observed });

  const inserted = rows_with_sender.length - known_uids.size;
  return { inserted, updated: known_uids.size };
}

export async function incrementReplyCounts(input: { counts: Map<string, number> }): Promise<number> {
  const now = new Date();
  for (const [address, count] of input.counts) {
    await db
      .insert(sender)
      .values({
        address: clamp(address, 320) ?? "",
        domain: clamp(addressDomain(address), 253) ?? "",
        my_reply_count: count,
        first_seen_at: now,
        last_seen_at: now,
        updatedAt: now,
      })
      .onDuplicateKeyUpdate({
        set: {
          my_reply_count: sql`${sender.my_reply_count} + ${count}`,
          updatedAt: now,
        },
      });
  }
  return input.counts.size;
}
