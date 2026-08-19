import { db } from "@server/db/drizzle";
import { mailbox, message, sender } from "@server/db/schema";
import type { MessageSignals } from "@server/mail/classify/signals";
import { deriveSignals } from "@server/mail/classify/signals";
import type { MessageLocation } from "@server/mail/query/deep-link";
import { buildMessageLocation } from "@server/mail/query/deep-link";
import {
  isBulkPrecedenceSql,
  isSenderNotSuppressedSql,
  isSentByMeSql,
  isThreadOpenSql,
  threadGroupKeySql,
} from "@server/mail/query/signal-sql";
import { parseMailboxFlavor, parseStringList } from "@server/mail/types";
import type { SQL } from "drizzle-orm";
import { and, asc, eq, gte, isNull, not, sql } from "drizzle-orm";

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

type MailboxSentConfig = { id: string; flavor: string; sent_folders: string | null };

async function loadMailboxSentConfigs(mailbox_id: string | null): Promise<MailboxSentConfig[]> {
  return db
    .select({ id: mailbox.id, flavor: mailbox.flavor, sent_folders: mailbox.sent_folders })
    .from(mailbox)
    .where(mailbox_id === null ? undefined : eq(mailbox.id, mailbox_id));
}

// "Sent by the mailbox owner" for every mailbox in scope at once, each branch fenced by its own mailboxId
// so a Gmail label test never runs against a generic mailbox's rows. The per-flavour test itself is
// isSentByMeSql, shared with the shadow runner, because a folder-only test is permanently false on Gmail.
function sentByMeSql(configs: MailboxSentConfig[]): SQL<boolean> {
  if (configs.length === 0) {
    return sql<boolean>`0`;
  }

  const branches = configs.map(
    (config) =>
      sql`(${eq(message.mailbox_id, config.id)} AND ${isSentByMeSql(parseMailboxFlavor(config.flavor), parseStringList(config.sent_folders))})`,
  );

  return sql<boolean>`(${sql.join(branches, sql` OR `)})`;
}

function buildWhere(mailbox_id: string | null, sent_by_me: SQL<boolean>): SQL {
  const conditions: SQL[] = [
    isNull(message.list_id),
    isNull(message.list_unsubscribe),
    isNull(message.auto_submitted),
    not(isBulkPrecedenceSql()),
    eq(message.to_me, true),
    isNull(message.disappeared_at),
    // Keeps the operator's own messages out of the candidate pool, so a queue row is always headed by an
    // inbound message. This is not §1.9's last_in_thread_is_mine — that term is about the newest message
    // in the whole thread and is tested at thread level in listNeedsAction, over a pool that deliberately
    // still contains the operator's own replies.
    not(sent_by_me),
  ];
  if (mailbox_id !== null) {
    conditions.push(eq(message.mailbox_id, mailbox_id));
  }

  return and(...conditions) as SQL;
}

function buildReasons(signals: MessageSignals, params: { is_seen: boolean; sender_message_count: number }): string[] {
  const reasons: string[] = [];

  if (signals.addressed_to_me) {
    reasons.push("addressed directly to you");
  }
  if (!signals.sender_known) {
    reasons.push("you have never replied to this sender");
  }
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
  // constrains every candidate row to list_id IS NULL, list_unsubscribe IS NULL, auto_submitted IS NULL,
  // to_me = 1 and a Precedence that is not bulk|list — so no bulk or automated input can be set, and a
  // null precedence derives the same is_bulk as the "urgent"/"first-class" value the row may carry.
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
  max_age_days: number | null;
}): Promise<{ rows: NeedsActionRow[]; total: number }> {
  const sent_by_me = sentByMeSql(await loadMailboxSentConfigs(input.mailbox_id));
  const where = buildWhere(input.mailbox_id, sent_by_me);
  const now = new Date();
  const group_key = threadGroupKeySql();
  const mailbox_scope = input.mailbox_id === null ? undefined : eq(message.mailbox_id, input.mailbox_id);

  // §1.9's last_in_thread_is_mine, ranked over every live message in the thread rather than over the
  // candidate pool: the newest message in a thread is frequently one buildWhere excludes — the operator's
  // own reply above all — and it is exactly that message whose sender decides whether the thread still
  // needs an answer. Same pool, same ordering and same is_mine test as the shadow runner's
  // loadThreadFacts, so the two readings of the rule cannot drift apart.
  // The head_ prefixes are load-bearing: Drizzle renders a CTE's aliased columns unqualified, so two
  // CTEs in one statement that both expose `group_key` or `row_number` make every reference to either
  // ambiguous and MySQL rejects the query at runtime.
  const thread_head = db.$with("thread_head").as(
    db
      .select({
        head_group_key: group_key.as("head_group_key"),
        head_is_mine: sent_by_me.as("head_is_mine"),
        head_row_number:
          sql<number>`ROW_NUMBER() OVER (PARTITION BY ${group_key} ORDER BY ${message.internal_date} DESC, ${message.id} DESC)`.as(
            "head_row_number",
          ),
      })
      .from(message)
      .where(and(isNull(message.disappeared_at), mailbox_scope)),
  );

  // MySQL's only_full_group_by forbids grouping by threadKey (not a primary key) while selecting
  // other raw columns alongside it, so every displayed column must come from one real row.
  // internalDate is IMAP INTERNALDATE, which is whole-second precision even though the column
  // stores fsp:3 — two messages landing in the same second is the normal case here, not a rare
  // edge case, so a (groupKey, MAX(internalDate)) self-join can and does return more than one row
  // per thread (verified against production: 33 colliding groups, several with 3 rows). ROW_NUMBER()
  // ordered by internalDate DESC then id DESC gives a single, deterministic newest row per thread.
  const ranked = db.$with("ranked").as(
    db
      .select({
        id: message.id,
        group_key: group_key.as("group_key"),
        thread_key: message.thread_key,
        subject: message.subject,
        from_address: message.from_address,
        from_name: message.from_name,
        mailbox_id: message.mailbox_id,
        internal_date: message.internal_date,
        is_seen: message.is_seen,
        cc_me: message.cc_me,
        dkim_aligned: message.dkim_aligned,
        gm_thrid: message.gm_thrid,
        folder: message.folder,
        message_id: message.message_id,
        row_number:
          sql<number>`ROW_NUMBER() OVER (PARTITION BY ${group_key} ORDER BY ${message.internal_date} DESC, ${message.id} DESC)`.as(
            "row_number",
          ),
        message_count: sql<number>`COUNT(*) OVER (PARTITION BY ${group_key})`.as("message_count"),
      })
      .from(message)
      .where(where),
  );

  // Every clause here is applied to the rows query and to the total identically, and all of it before
  // LIMIT — a predicate applied after the fetch makes pagination skip threads, which is the bug Phase 2
  // shipped in this file. Filtering on ranked.internal_date (the newest message per thread) rather than on
  // the base where clause keeps message_count whole-thread and applies the age cutoff to the thread as a
  // whole, not to individual older messages inside a thread that's otherwise still current.
  const conditions: SQL[] = [
    eq(ranked.row_number, 1),
    sql`COALESCE(${thread_head.head_is_mine}, 0) = 0`,
    isThreadOpenSql({ mailbox_id: ranked.mailbox_id, thread_key: ranked.group_key, now }),
    isSenderNotSuppressedSql(ranked.from_address),
  ];
  if (input.max_age_days !== null) {
    conditions.push(gte(ranked.internal_date, new Date(now.getTime() - input.max_age_days * 86_400_000)));
  }
  const where_ranked = and(...conditions) as SQL;

  const thread_head_join = and(eq(thread_head.head_group_key, ranked.group_key), eq(thread_head.head_row_number, 1)) as SQL;

  const rows_promise = db
    .with(thread_head, ranked)
    .select({
      thread_key: ranked.thread_key,
      subject: ranked.subject,
      from_address: ranked.from_address,
      from_name: ranked.from_name,
      mailbox_id: ranked.mailbox_id,
      mailbox_label: mailbox.label,
      internal_date: ranked.internal_date,
      is_seen: ranked.is_seen,
      cc_me: ranked.cc_me,
      dkim_aligned: ranked.dkim_aligned,
      message_count: ranked.message_count,
      sender_message_count: sender.message_count,
      my_reply_count: sender.my_reply_count,
      flavor: mailbox.flavor,
      account_index: mailbox.account_index,
      gm_thrid: ranked.gm_thrid,
      folder: ranked.folder,
      message_id: ranked.message_id,
    })
    .from(ranked)
    .innerJoin(mailbox, eq(mailbox.id, ranked.mailbox_id))
    .leftJoin(sender, eq(sender.address, ranked.from_address))
    .leftJoin(thread_head, thread_head_join)
    .where(where_ranked)
    .orderBy(asc(ranked.internal_date), asc(ranked.id))
    .limit(input.limit)
    .offset(input.offset);

  const total_promise = db
    .with(thread_head, ranked)
    .select({ total: sql<number>`COUNT(*)` })
    .from(ranked)
    .leftJoin(thread_head, thread_head_join)
    .where(where_ranked);

  const [rows, total_rows] = await Promise.all([rows_promise, total_promise]);

  return {
    rows: rows.map((row) => toNeedsActionRow(row, now)),
    total: Number(total_rows[0]?.total ?? 0),
  };
}
