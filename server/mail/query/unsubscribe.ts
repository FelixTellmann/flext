import { db } from "@server/db/drizzle";
import { mailbox, message, senderPolicy } from "@server/db/schema";
import { isInInboxSql } from "@server/mail/query/signal-sql";
import type { UnsubscribeAttemptRecord } from "@server/mail/unsubscribe/attempts";
import { loadLatestUnsubscribeAttempts } from "@server/mail/unsubscribe/attempts";
import type { UnsubscribeTarget } from "@server/mail/unsubscribe/parse";
import { isOneClick, parseListUnsubscribe } from "@server/mail/unsubscribe/parse";
import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";

// One sender the operator could stop hearing from entirely.
//
// Every rule in this system HIDES mail: archive moves it, file moves it, even trash only moves it. None
// of them stop it arriving. Unsubscribing is the only action here that reduces the volume rather than
// relocating it, which makes it worth its own surface rather than a column on the sender table.
export type UnsubscribeCandidate = {
  from_address: string;
  from_domain: string;
  mailbox_label: string;
  total: number;
  // Still landing in an inbox, as opposed to already filed away somewhere. High here means it is still
  // costing attention every week.
  in_inbox: number;
  newest: Date | null;
  sample_subject: string | null;
  // A rule already covers this sender. Not a reason to skip them — a rule hides the mail and
  // unsubscribing stops it, and doing both is usually right — but it is worth seeing which is which.
  has_policy: boolean;
  target: UnsubscribeTarget;
  // RFC 8058: the sender accepts a server-side POST, so the bulk button can act on them without a
  // browser. False for a link the operator has to open by hand.
  one_click: boolean;
  last_attempt: UnsubscribeAttemptRecord | null;
};

// Ordered by how much still reaches an inbox rather than by lifetime volume: a newsletter already caught
// by a rule costs nothing to receive, and one arriving weekly into the inbox costs attention every week.
export async function listUnsubscribeCandidates(input: { limit: number }): Promise<UnsubscribeCandidate[]> {
  // The digest's spelling (digest/query.ts), so the two inbox counts cannot disagree: one grouped query
  // spans every mailbox, and the two flavors spell "in the inbox" differently (signal-sql.ts).
  const in_inbox =
    sql<number>`SUM(CASE WHEN ${mailbox.flavor} = 'gmail' THEN ${isInInboxSql("gmail")} ELSE ${isInInboxSql("generic")} END)`.as(
      "in_inbox",
    );

  const rows = await db
    .select({
      from_address: message.from_address,
      from_domain: message.from_domain,
      mailbox_label: mailbox.label,
      total: sql<number>`COUNT(*)`.as("total"),
      in_inbox,
      newest: sql<Date>`MAX(${message.internal_date})`.as("newest"),
      sample_subject: sql<string>`MAX(${message.subject})`.as("sample_subject"),
      // MAX rather than a per-message read: the header is stable per sender in practice, and one row per
      // sender is the whole point of this screen. Same for the one-click header: its value is the RFC's
      // fixed string on every message that carries it, so MAX is "any message carries it".
      raw_unsubscribe: sql<string>`MAX(${message.list_unsubscribe})`.as("raw_unsubscribe"),
      raw_unsubscribe_post: sql<string | null>`MAX(${message.list_unsubscribe_post})`.as("raw_unsubscribe_post"),
      has_policy: sql<number>`MAX(${senderPolicy.id} IS NOT NULL)`.as("has_policy"),
    })
    .from(message)
    .innerJoin(mailbox, eq(mailbox.id, message.mailbox_id))
    .leftJoin(
      senderPolicy,
      sql`(${senderPolicy.scope} = 'address' AND LOWER(${senderPolicy.value}) = LOWER(${message.from_address}))
       OR (${senderPolicy.scope} = 'domain' AND LOWER(${senderPolicy.value}) = LOWER(${message.from_domain}))`,
    )
    .where(and(isNull(message.disappeared_at), isNotNull(message.list_unsubscribe), isNotNull(message.from_address)))
    .groupBy(message.from_address, message.from_domain, mailbox.label)
    .orderBy(desc(sql`in_inbox`), desc(sql`total`))
    .limit(input.limit);

  const attempts = await loadLatestUnsubscribeAttempts([...new Set(rows.map((row) => row.from_address ?? ""))]);

  return (
    rows
      .map((row) => {
        const target = parseListUnsubscribe(row.raw_unsubscribe);
        return {
          from_address: row.from_address ?? "",
          from_domain: row.from_domain ?? "",
          mailbox_label: row.mailbox_label,
          total: Number(row.total),
          in_inbox: Number(row.in_inbox),
          newest: row.newest === null ? null : new Date(row.newest),
          sample_subject: row.sample_subject,
          has_policy: Number(row.has_policy) > 0,
          target,
          // Both halves: the RFC header and an http target for the POST to go to.
          one_click: target.http !== null && isOneClick(row.raw_unsubscribe_post),
          last_attempt: attempts.get((row.from_address ?? "").toLowerCase()) ?? null,
        };
      })
      // A sender whose header carries neither a link nor a mailto has nothing actionable on this screen,
      // and listing them would be a list of things the operator cannot do anything about.
      .filter((row) => row.target.http !== null || row.target.mailto !== null)
  );
}
