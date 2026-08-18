import { db } from "@server/db/drizzle";
import { mailbox, message, sender, syncRun } from "@server/db/schema";
import type { VolumeBucket } from "@server/mail/classify/signals";
import { volumeBucket } from "@server/mail/classify/signals";
import type { MessageLocation } from "@server/mail/query/deep-link";
import { buildMessageLocation } from "@server/mail/query/deep-link";
import { isBulkPrecedenceSql } from "@server/mail/query/signal-sql";
import type { SQL } from "drizzle-orm";
import { and, asc, desc, eq, gte, isNull, like, ne, or, sql } from "drizzle-orm";

export type SenderSort = "messages" | "replies" | "last_seen" | "address";

export type SenderFilter = {
  search: string | null;
  replied: "all" | "never" | "replied";
  bulk: "all" | "bulk" | "direct";
  mailbox_id: string | null;
  min_messages: number;
};

export type SenderRow = {
  address: string;
  domain: string;
  display_name: string | null;
  message_count: number;
  my_reply_count: number;
  volume_bucket: VolumeBucket;
  bulk_count: number;
  automated_count: number;
  unread_count: number;
  in_inbox_count: number;
  attachment_count: number;
  last_seen_at: string | null;
  mailbox_labels: string[];
};

export type SenderProfile = SenderRow & {
  first_seen_at: string | null;
  per_mailbox: { label: string; count: number }[];
  recent_subjects: { subject: string | null; internal_date: string; folder: string; location: MessageLocation }[];
};

export type DashboardSummary = {
  total_messages: number;
  total_senders: number;
  senders_never_replied: number;
  mailboxes: {
    id: string;
    label: string;
    messages: number;
    unread: number;
    enabled: boolean;
    last_sync_at: string | null;
    last_error: string | null;
  }[];
};

type SenderAggregateSelection = {
  address: string;
  domain: string;
  display_name: string | null;
  message_count: number;
  my_reply_count: number;
  last_seen_at: Date | null;
  bulk_count: number;
  automated_count: number;
  unread_count: number;
  in_inbox_count: number;
  attachment_count: number;
  mailbox_labels: string | null;
};

function splitLabels(raw: string | null): string[] {
  if (raw === null || raw.length === 0) {
    return [];
  }
  return raw.split("|");
}

function senderAggregates() {
  return {
    bulk_count: sql<number>`SUM(${message.list_id} IS NOT NULL OR ${message.list_unsubscribe} IS NOT NULL OR ${isBulkPrecedenceSql()})`,
    automated_count: sql<number>`SUM(${message.auto_submitted} IS NOT NULL)`,
    unread_count: sql<number>`SUM(${message.is_seen} = 0)`,
    attachment_count: sql<number>`SUM(${message.has_attachment} = 1)`,
    // Gmail keeps INBOX as a label on the canonical All Mail folder; generic IMAP uses a real folder.
    in_inbox_count: sql<number>`SUM(${message.folder} = 'INBOX' OR ${message.labels} LIKE '%Inbox%')`,
    mailbox_labels: sql<string | null>`GROUP_CONCAT(DISTINCT ${mailbox.label} ORDER BY ${mailbox.label} SEPARATOR '|')`,
  };
}

function toSenderRow(row: SenderAggregateSelection): SenderRow {
  const message_count = Number(row.message_count);
  return {
    address: row.address,
    domain: row.domain,
    display_name: row.display_name,
    message_count,
    my_reply_count: Number(row.my_reply_count),
    volume_bucket: volumeBucket(message_count),
    bulk_count: Number(row.bulk_count),
    automated_count: Number(row.automated_count),
    unread_count: Number(row.unread_count),
    in_inbox_count: Number(row.in_inbox_count),
    attachment_count: Number(row.attachment_count),
    last_seen_at: row.last_seen_at?.toISOString() ?? null,
    mailbox_labels: splitLabels(row.mailbox_labels),
  };
}

function buildWhere(filter: SenderFilter): SQL | undefined {
  // Every per-sender aggregate below counts Message rows, so a message that reconcile marked as gone
  // server-side must not keep inflating them. Sender.messageCount / myReplyCount / lastSeenAt are stored
  // lifetime totals with no such filter available — they still include vanished mail.
  const conditions: SQL[] = [isNull(message.disappeared_at)];

  if (filter.search !== null && filter.search.length > 0) {
    const pattern = `%${filter.search}%`;
    conditions.push(or(like(sender.address, pattern), like(sender.domain, pattern), like(sender.display_name, pattern)) as SQL);
  }
  if (filter.replied === "never") {
    conditions.push(eq(sender.my_reply_count, 0));
  }
  if (filter.replied === "replied") {
    conditions.push(gte(sender.my_reply_count, 1));
  }
  if (filter.mailbox_id !== null) {
    conditions.push(eq(message.mailbox_id, filter.mailbox_id));
  }
  conditions.push(gte(sender.message_count, filter.min_messages));

  return conditions.length > 0 ? and(...conditions) : undefined;
}

function buildBulkHaving(bulk: SenderFilter["bulk"], bulk_count_expr: SQL): SQL | undefined {
  if (bulk === "bulk") {
    return sql`${bulk_count_expr} > 0`;
  }
  if (bulk === "direct") {
    return sql`${bulk_count_expr} = 0`;
  }
  return undefined;
}

function orderColumn(sort: SenderSort) {
  if (sort === "messages") {
    return sender.message_count;
  }
  if (sort === "replies") {
    return sender.my_reply_count;
  }
  if (sort === "last_seen") {
    return sender.last_seen_at;
  }
  return sender.address;
}

export async function listSenders(input: {
  filter: SenderFilter;
  sort: SenderSort;
  direction: "asc" | "desc";
  limit: number;
  offset: number;
}): Promise<{ rows: SenderRow[]; total: number }> {
  const where = buildWhere(input.filter);
  const order = input.direction === "asc" ? asc(orderColumn(input.sort)) : desc(orderColumn(input.sort));

  const rows_aggregates = senderAggregates();
  const rows_having = buildBulkHaving(input.filter.bulk, rows_aggregates.bulk_count);

  // Join on fromAddress, not senderId: Message.senderId is null on every existing row until Task 7's
  // repair pass, and the dashboard must be correct before, during and after it.
  const rows_promise = db
    .select({
      address: sender.address,
      domain: sender.domain,
      display_name: sender.display_name,
      message_count: sender.message_count,
      my_reply_count: sender.my_reply_count,
      last_seen_at: sender.last_seen_at,
      ...rows_aggregates,
    })
    .from(sender)
    .innerJoin(message, eq(message.from_address, sender.address))
    .innerJoin(mailbox, eq(mailbox.id, message.mailbox_id))
    .where(where)
    .groupBy(sender.id)
    .having(rows_having)
    .orderBy(order)
    .limit(input.limit)
    .offset(input.offset);

  const total_aggregates = senderAggregates();
  const total_having = buildBulkHaving(input.filter.bulk, total_aggregates.bulk_count);

  const total_promise = db
    .select({ id: sender.id })
    .from(sender)
    .innerJoin(message, eq(message.from_address, sender.address))
    .innerJoin(mailbox, eq(mailbox.id, message.mailbox_id))
    .where(where)
    .groupBy(sender.id)
    .having(total_having);

  const [rows, total_rows] = await Promise.all([rows_promise, total_promise]);

  return { rows: rows.map(toSenderRow), total: total_rows.length };
}

export async function getSenderProfile(address: string): Promise<SenderProfile | null> {
  const aggregates = senderAggregates();

  const [row] = await db
    .select({
      address: sender.address,
      domain: sender.domain,
      display_name: sender.display_name,
      message_count: sender.message_count,
      my_reply_count: sender.my_reply_count,
      first_seen_at: sender.first_seen_at,
      last_seen_at: sender.last_seen_at,
      ...aggregates,
    })
    .from(sender)
    .innerJoin(message, eq(message.from_address, sender.address))
    .innerJoin(mailbox, eq(mailbox.id, message.mailbox_id))
    .where(and(eq(sender.address, address), isNull(message.disappeared_at)))
    .groupBy(sender.id);

  if (row === undefined) {
    return null;
  }

  const [per_mailbox_rows, subject_rows] = await Promise.all([
    db
      .select({ label: mailbox.label, count: sql<number>`COUNT(*)` })
      .from(message)
      .innerJoin(mailbox, eq(mailbox.id, message.mailbox_id))
      .where(and(eq(message.from_address, address), isNull(message.disappeared_at)))
      .groupBy(mailbox.id),
    db
      .select({
        subject: message.subject,
        internal_date: message.internal_date,
        folder: message.folder,
        flavor: mailbox.flavor,
        account_index: mailbox.account_index,
        gm_thrid: message.gm_thrid,
        message_id: message.message_id,
      })
      .from(message)
      .innerJoin(mailbox, eq(mailbox.id, message.mailbox_id))
      .where(and(eq(message.from_address, address), isNull(message.disappeared_at)))
      .orderBy(desc(message.internal_date))
      .limit(20),
  ]);

  return {
    ...toSenderRow(row),
    first_seen_at: row.first_seen_at?.toISOString() ?? null,
    per_mailbox: per_mailbox_rows.map((entry) => ({ label: entry.label, count: Number(entry.count) })),
    recent_subjects: subject_rows.map((entry) => ({
      subject: entry.subject,
      internal_date: entry.internal_date.toISOString(),
      folder: entry.folder,
      location: buildMessageLocation({
        flavor: entry.flavor,
        account_index: entry.account_index,
        gm_thrid: entry.gm_thrid,
        folder: entry.folder,
        message_id: entry.message_id,
      }),
    })),
  };
}

export async function getDashboardSummary(): Promise<DashboardSummary> {
  const [mailbox_rows, message_totals, message_stats, sync_stats, sender_totals] = await Promise.all([
    db.select().from(mailbox).orderBy(mailbox.label),
    db.select({ total: sql<number>`COUNT(*)` }).from(message).where(isNull(message.disappeared_at)),
    db
      .select({
        mailbox_id: message.mailbox_id,
        messages: sql<number>`COUNT(*)`,
        unread: sql<number>`SUM(${message.is_seen} = 0)`,
      })
      .from(message)
      .where(isNull(message.disappeared_at))
      .groupBy(message.mailbox_id),
    db
      .select({ mailbox_id: syncRun.mailbox_id, last_sync_at: sql<string | null>`MAX(${syncRun.started_at})` })
      .from(syncRun)
      .where(ne(syncRun.status, "running"))
      .groupBy(syncRun.mailbox_id),
    db
      .select({
        total: sql<number>`COUNT(*)`,
        never_replied: sql<number>`SUM(${sender.my_reply_count} = 0)`,
      })
      .from(sender),
  ]);

  const message_stats_by_mailbox = new Map(message_stats.map((row) => [row.mailbox_id, row]));
  const last_sync_by_mailbox = new Map(sync_stats.map((row) => [row.mailbox_id, row.last_sync_at]));
  const sender_totals_row = sender_totals[0];

  return {
    total_messages: Number(message_totals[0]?.total ?? 0),
    total_senders: Number(sender_totals_row?.total ?? 0),
    senders_never_replied: Number(sender_totals_row?.never_replied ?? 0),
    mailboxes: mailbox_rows.map((row) => {
      const stats = message_stats_by_mailbox.get(row.id);
      const last_sync_at = last_sync_by_mailbox.get(row.id) ?? null;
      return {
        id: row.id,
        label: row.label,
        messages: Number(stats?.messages ?? 0),
        unread: Number(stats?.unread ?? 0),
        enabled: row.enabled,
        // mysql2 reports MAX() over a datetime column as a raw string, unlike a plain column select.
        last_sync_at: last_sync_at === null ? null : new Date(last_sync_at).toISOString(),
        last_error: row.last_error,
      };
    }),
  };
}
