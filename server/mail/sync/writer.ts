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

async function upsertSenders(aggregates: SenderAggregate[]): Promise<void> {
  const now = new Date();
  for (const aggregate of aggregates) {
    await db
      .insert(sender)
      .values({
        address: aggregate.address,
        domain: aggregate.domain,
        display_name: aggregate.display_name,
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
        address,
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
      message_id: entry.envelope.message_id,
      thread_key: deriveThreadKey({
        gm_thrid: entry.gm_thrid,
        references: headerValue(entry.headers, "References"),
        in_reply_to: entry.envelope.in_reply_to,
        message_id: entry.envelope.message_id,
      }),
      from_address,
      from_domain,
      from_name: from?.name ?? null,
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
      list_id: headerValue(entry.headers, "List-Id"),
      list_unsubscribe: headerValue(entry.headers, "List-Unsubscribe"),
      precedence: headerValue(entry.headers, "Precedence"),
      auto_submitted: headerValue(entry.headers, "Auto-Submitted"),
      dkim_aligned: dkimAligned(headerValue(entry.headers, "Authentication-Results"), from_domain),
      is_seen: entry.flags.includes("\\Seen"),
      is_flagged: entry.flags.includes("\\Flagged"),
      labels: entry.labels === null ? null : serializeStringList(entry.labels),
      updatedAt: now,
    };
  });

  for (let offset = 0; offset < rows.length; offset += INSERT_CHUNK_SIZE) {
    const chunk = rows.slice(offset, offset + INSERT_CHUNK_SIZE);
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

  await upsertSenders([...sender_aggregates.values()]);
  await upsertObservedAddresses({ mailbox_id: input.mailbox_row.id, observed });

  const inserted = rows.length - known_uids.size;
  return { inserted, updated: known_uids.size };
}

export async function incrementReplyCounts(input: { counts: Map<string, number> }): Promise<number> {
  const now = new Date();
  for (const [address, count] of input.counts) {
    await db
      .insert(sender)
      .values({
        address,
        domain: addressDomain(address),
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
