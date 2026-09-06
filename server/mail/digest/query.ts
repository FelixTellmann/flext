import { db } from "@server/db/drizzle";
import { mailbox, message, senderPolicy } from "@server/db/schema";
import type { PolicyIndex } from "@server/mail/query/policies";
import { loadPolicyIndex } from "@server/mail/query/policies";
import { isInInboxSql } from "@server/mail/query/signal-sql";
import { isOneClick, parseListUnsubscribe } from "@server/mail/unsubscribe/parse";
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";

// The digest's question is "what is still reaching you that you never open" (register: phase 7 digest
// rows). A sender whose live rule already hides its mail has answered it; a sender with a watch-only rule
// has not, because watch-only mail still lands in the inbox.

export const DIGEST_UNOPENED_DAYS = 30;
export const DIGEST_LIMIT = 40;

export type DigestSenderRule = { action: string; autonomy: string; suspended: boolean };

export type DigestSender = {
  from_address: string;
  from_domain: string;
  mailbox_labels: string[];
  unopened: number;
  oldest: Date;
  newest: Date;
  // The rule the sender already has, if any. Never a live one at auto: those are excluded in SQL.
  rule: DigestSenderRule | null;
  one_click: boolean;
  mailto: boolean;
};

export type DigestSenderRow = {
  from_address: string;
  from_domain: string | null;
  mailbox_labels: string;
  unopened: number;
  oldest: Date;
  newest: Date;
};

export type DigestHeaderRow = {
  from_address: string;
  list_unsubscribe: string | null;
  list_unsubscribe_post: string | null;
};

const LABEL_SEPARATOR = "|";

export function assembleDigestSenders(input: {
  rows: DigestSenderRow[];
  headers: DigestHeaderRow[];
  policy_index: PolicyIndex;
}): DigestSender[] {
  const header_by_address = new Map(input.headers.map((header) => [header.from_address.toLowerCase(), header]));

  return input.rows.map((row) => {
    const key = row.from_address.toLowerCase();
    const from_domain = row.from_domain ?? "";
    const header = header_by_address.get(key) ?? null;
    const target = parseListUnsubscribe(header?.list_unsubscribe ?? null);
    const policy = input.policy_index.by_address.get(key) ?? input.policy_index.by_domain.get(from_domain.toLowerCase());

    return {
      from_address: row.from_address,
      from_domain,
      mailbox_labels: row.mailbox_labels.split(LABEL_SEPARATOR).filter((label) => label.length > 0),
      unopened: Number(row.unopened),
      oldest: new Date(row.oldest),
      newest: new Date(row.newest),
      rule: policy === undefined ? null : { action: policy.action, autonomy: policy.autonomy, suspended: policy.suspended_at !== null },
      one_click: target.http !== null && isOneClick(header?.list_unsubscribe_post ?? null),
      mailto: target.mailto !== null,
    };
  });
}

// Drizzle formats a Date bound to a datetime COLUMN as UTC; a Date bound inside a raw sql template goes
// through mysql2's own serializer, which uses the process time zone. Formatting here keeps the cutoff in
// the UTC the column holds whatever the container's TZ says.
export function toDatetimeLiteral(date: Date): string {
  return date.toISOString().slice(0, 23).replace("T", " ");
}

// The newest List-Unsubscribe per sender, from any folder: the newest message is the one whose header
// the list manager still honours.
async function loadNewestHeaders(addresses: string[]): Promise<DigestHeaderRow[]> {
  if (addresses.length === 0) {
    return [];
  }

  const ranked = db
    .select({
      from_address: sql<string>`LOWER(${message.from_address})`.as("from_address"),
      list_unsubscribe: message.list_unsubscribe,
      list_unsubscribe_post: message.list_unsubscribe_post,
      header_rank: sql<number>`ROW_NUMBER() OVER (PARTITION BY LOWER(${message.from_address}) ORDER BY ${message.internal_date} DESC)`.as(
        "header_rank",
      ),
    })
    .from(message)
    .where(
      and(inArray(sql`LOWER(${message.from_address})`, addresses), isNotNull(message.list_unsubscribe), isNull(message.disappeared_at)),
    )
    .as("ranked");

  return db
    .select({
      from_address: ranked.from_address,
      list_unsubscribe: ranked.list_unsubscribe,
      list_unsubscribe_post: ranked.list_unsubscribe_post,
    })
    .from(ranked)
    .where(eq(ranked.header_rank, 1));
}

export async function listDigestSenders(input: { now: Date; limit?: number }): Promise<DigestSender[]> {
  const cutoff = toDatetimeLiteral(new Date(input.now.getTime() - DIGEST_UNOPENED_DAYS * 24 * 60 * 60 * 1000));

  // Composed per row rather than per query because one grouped query spans every mailbox, and the two
  // flavors spell "in the inbox" differently (signal-sql.ts).
  const in_inbox = sql<boolean>`CASE WHEN ${mailbox.flavor} = 'gmail' THEN ${isInInboxSql("gmail")} ELSE ${isInInboxSql("generic")} END`;

  // NOT EXISTS rather than the LEFT JOIN query/unsubscribe.ts uses: a sender matched by both an address
  // and a domain rule would count every message twice, and the count is both the sort key and the number
  // the operator reads. A suspended rule at auto resolves its mail to keep_inbox (query/policies.ts), so
  // that sender is still reaching the inbox and stays in.
  const live_auto_rule = sql`EXISTS (
    SELECT 1 FROM ${senderPolicy}
    WHERE ${senderPolicy.autonomy} = 'auto'
      AND ${senderPolicy.suspended_at} IS NULL
      AND ((${senderPolicy.scope} = 'address' AND LOWER(${senderPolicy.value}) = LOWER(${message.from_address}))
        OR (${senderPolicy.scope} = 'domain' AND LOWER(${senderPolicy.value}) = LOWER(${message.from_domain})))
  )`;

  const rows = await db
    .select({
      // MIN over a group keyed on the lower-cased address: ONLY_FULL_GROUP_BY does not see through LOWER().
      from_address: sql<string>`MIN(${message.from_address})`,
      from_domain: sql<string | null>`MIN(${message.from_domain})`,
      mailbox_labels: sql<string>`GROUP_CONCAT(DISTINCT ${mailbox.label} ORDER BY ${mailbox.label} SEPARATOR ${LABEL_SEPARATOR})`,
      unopened: sql<number>`COUNT(*)`.as("unopened"),
      oldest: sql<Date>`MIN(${message.internal_date})`.as("oldest"),
      newest: sql<Date>`MAX(${message.internal_date})`,
    })
    .from(message)
    .innerJoin(mailbox, eq(mailbox.id, message.mailbox_id))
    .where(and(isNull(message.disappeared_at), isNotNull(message.from_address), in_inbox, sql`NOT ${live_auto_rule}`))
    .groupBy(sql`LOWER(${message.from_address})`)
    .having(sql`SUM(${message.opened_at} IS NOT NULL OR ${message.is_seen} = 1) = 0 AND MIN(${message.internal_date}) <= ${cutoff}`)
    .orderBy(desc(sql`unopened`), asc(sql`oldest`))
    .limit(input.limit ?? DIGEST_LIMIT);

  const [headers, policy_index] = await Promise.all([
    loadNewestHeaders(rows.map((row) => row.from_address.toLowerCase())),
    loadPolicyIndex(),
  ]);

  return assembleDigestSenders({ rows, headers, policy_index });
}
