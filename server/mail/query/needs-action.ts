import { db } from "@server/db/drizzle";
import { mailbox, message, sender } from "@server/db/schema";
import type { MessageSignals } from "@server/mail/classify/signals";
import { deriveSignals } from "@server/mail/classify/signals";
import type { MessageLocation } from "@server/mail/query/deep-link";
import { buildMessageLocation } from "@server/mail/query/deep-link";
import { parseStringList } from "@server/mail/types";
import type { SQL } from "drizzle-orm";
import { and, asc, eq, inArray, isNull, not, sql } from "drizzle-orm";

export type NeedsActionRow = {
  thread_key: string | null;
  subject: string | null;
  from_address: string | null;
  from_name: string | null;
  mailbox_label: string;
  mailbox_id: string;
  internal_date: string;
  age_days: number;
  message_count: number;
  is_seen: boolean;
  reasons: string[];
  location: MessageLocation;
};

type NeedsActionQueryRow = {
  thread_key: string | null;
  subject: string | null;
  from_address: string | null;
  from_name: string | null;
  mailbox_id: string;
  mailbox_label: string;
  internal_date: Date;
  is_seen: boolean;
  cc_me: boolean;
  dkim_aligned: boolean | null;
  message_count: number;
  sender_message_count: number | null;
  my_reply_count: number | null;
  flavor: string;
  account_index: number | null;
  gm_thrid: string | null;
  folder: string;
  message_id: string | null;
};

// A null threadKey cannot be grouped against other messages, so each one stands as its own
// single-message thread rather than being dropped or collapsed together.
function threadGroupKey(): SQL<string> {
  return sql<string>`COALESCE(${message.thread_key}, ${message.id})`;
}

async function sentFolderExclusion(mailbox_id: string | null): Promise<SQL | undefined> {
  const mailboxes = await db
    .select({ id: mailbox.id, sent_folders: mailbox.sent_folders })
    .from(mailbox)
    .where(mailbox_id === null ? undefined : eq(mailbox.id, mailbox_id));

  const exclusions = mailboxes
    .map((row) => ({ id: row.id, folders: parseStringList(row.sent_folders) }))
    .filter((row) => row.folders.length > 0)
    .map((row) => not(and(eq(message.mailbox_id, row.id), inArray(message.folder, row.folders)) as SQL));

  return exclusions.length > 0 ? and(...exclusions) : undefined;
}

function buildWhere(mailbox_id: string | null, sent_folder_exclusion: SQL | undefined): SQL {
  const conditions: SQL[] = [
    isNull(message.list_id),
    isNull(message.list_unsubscribe),
    isNull(message.auto_submitted),
    isNull(message.precedence),
    eq(message.to_me, true),
    isNull(message.disappeared_at),
  ];
  if (mailbox_id !== null) {
    conditions.push(eq(message.mailbox_id, mailbox_id));
  }
  // last_in_thread_is_mine has no thread-state table until Phase 3; excluding rows that live in a
  // Sent folder approximates it, since a message can only be "the last one" here if it isn't mine.
  if (sent_folder_exclusion !== undefined) {
    conditions.push(sent_folder_exclusion);
  }

  return and(...conditions) as SQL;
}

function buildReasons(signals: MessageSignals, params: { is_seen: boolean; sender_message_count: number }): string[] {
  const reasons: string[] = [];

  if (signals.addressed_to_me) {
    reasons.push("addressed directly to you");
  }
  reasons.push("no reply sent");
  if (!params.is_seen) {
    reasons.push(signals.age_days === 0 ? "unread today" : `unread for ${signals.age_days} days`);
  }
  if (params.sender_message_count > 1) {
    reasons.push(`sender has written ${params.sender_message_count} times`);
  }

  return reasons;
}

function toNeedsActionRow(row: NeedsActionQueryRow, now: Date): NeedsActionRow {
  const sender_message_count = Number(row.sender_message_count ?? 0);
  // list_id/list_unsubscribe/precedence/auto_submitted/to_me aren't re-selected: buildWhere already
  // constrains every candidate row to list_id IS NULL, list_unsubscribe IS NULL, precedence IS NULL,
  // auto_submitted IS NULL and to_me = 1, so their signal inputs are fixed.
  const signals = deriveSignals({
    list_id: null,
    list_unsubscribe: null,
    precedence: null,
    auto_submitted: null,
    from_address: row.from_address,
    to_me: true,
    cc_me: row.cc_me,
    dkim_aligned: row.dkim_aligned,
    internal_date: row.internal_date,
    sender_message_count,
    my_reply_count: Number(row.my_reply_count ?? 0),
    now,
  });

  return {
    thread_key: row.thread_key,
    subject: row.subject,
    from_address: row.from_address,
    from_name: row.from_name,
    mailbox_label: row.mailbox_label,
    mailbox_id: row.mailbox_id,
    internal_date: row.internal_date.toISOString(),
    age_days: signals.age_days,
    message_count: Number(row.message_count),
    is_seen: row.is_seen,
    reasons: buildReasons(signals, { is_seen: row.is_seen, sender_message_count }),
    location: buildMessageLocation({
      flavor: row.flavor,
      account_index: row.account_index,
      gm_thrid: row.gm_thrid,
      folder: row.folder,
      message_id: row.message_id,
    }),
  };
}

export async function listNeedsAction(input: {
  mailbox_id: string | null;
  limit: number;
  offset: number;
}): Promise<{ rows: NeedsActionRow[]; total: number }> {
  const sent_folder_exclusion = await sentFolderExclusion(input.mailbox_id);
  const where = buildWhere(input.mailbox_id, sent_folder_exclusion);
  const now = new Date();

  // MySQL's only_full_group_by forbids grouping by threadKey (not a primary key) while selecting
  // other raw columns alongside it. Self-joining the newest row per thread back onto Message keeps
  // subject/sender/etc. all coming from that one real row, instead of independent per-column MAX()es.
  const thread_stats = db.$with("thread_stats").as(
    db
      .select({
        group_key: threadGroupKey().as("group_key"),
        newest_date: sql<Date>`MAX(${message.internal_date})`.as("newest_date"),
        message_count: sql<number>`COUNT(*)`.as("message_count"),
      })
      .from(message)
      .where(where)
      .groupBy(threadGroupKey()),
  );

  const rows_promise = db
    .with(thread_stats)
    .select({
      thread_key: message.thread_key,
      subject: message.subject,
      from_address: message.from_address,
      from_name: message.from_name,
      mailbox_id: message.mailbox_id,
      mailbox_label: mailbox.label,
      internal_date: message.internal_date,
      is_seen: message.is_seen,
      cc_me: message.cc_me,
      dkim_aligned: message.dkim_aligned,
      message_count: thread_stats.message_count,
      sender_message_count: sender.message_count,
      my_reply_count: sender.my_reply_count,
      flavor: mailbox.flavor,
      account_index: mailbox.account_index,
      gm_thrid: message.gm_thrid,
      folder: message.folder,
      message_id: message.message_id,
    })
    .from(message)
    .innerJoin(thread_stats, and(eq(threadGroupKey(), thread_stats.group_key), eq(message.internal_date, thread_stats.newest_date)))
    .innerJoin(mailbox, eq(mailbox.id, message.mailbox_id))
    .leftJoin(sender, eq(sender.address, message.from_address))
    .where(where)
    .orderBy(asc(message.internal_date), asc(message.id))
    .limit(input.limit)
    .offset(input.offset);

  const total_promise = db.with(thread_stats).select({ total: sql<number>`COUNT(*)` }).from(thread_stats);

  const [rows, total_rows] = await Promise.all([rows_promise, total_promise]);

  return {
    rows: rows.map((row) => toNeedsActionRow(row, now)),
    total: Number(total_rows[0]?.total ?? 0),
  };
}
