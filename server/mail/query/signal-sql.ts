import { message, senderSuppression, threadState } from "@server/db/schema";
import type { ThreadStateValue } from "@server/mail/classify/rules";
import { THREAD_STATE_VALUES } from "@server/mail/classify/rules";
import { BULK_PRECEDENCE_VALUES } from "@server/mail/classify/signals";
import type { MailboxFlavor } from "@server/mail/types";
import type { AnyColumn, SQL } from "drizzle-orm";
import { inArray, sql } from "drizzle-orm";

// A column, an expression, or a CTE's aliased column — the three shapes a caller can hand a predicate
// that has to be spliced into SQL over both a base table and a common table expression.
type SqlRef = AnyColumn | SQL | SQL.Aliased;

// The JSON-encoded token Phase 1 stores in Message.labels for a Gmail-flagged sent message (§4.1's
// X-GM-LABELS capture), not a folder — [Gmail]/Sent Mail is never synced for flavor "gmail", only the
// canonical [Gmail]/All Mail, so no Gmail row ever has a Sent folder to test against.
const GMAIL_SENT_LABEL = "\\Sent";

// The SQL half of §5.1's Precedence rule, kept honest against the pure half: normalizePrecedence() maps
// null to "" before lowercasing and trimming, so COALESCE ahead of LOWER(TRIM(...)) is the same input,
// and BULK_PRECEDENCE_VALUES is the same value list rather than a second copy of the literals. COALESCE
// also keeps NOT(...) usable — a bare comparison against NULL is NULL, which would drop every row that
// carries no Precedence header at all.
export function isBulkPrecedenceSql(): SQL<boolean> {
  return sql<boolean>`LOWER(TRIM(COALESCE(${message.precedence}, ''))) IN (${sql.join(
    BULK_PRECEDENCE_VALUES.map((value) => sql`${value}`),
    sql`, `,
  )})`;
}

// "Sent by the mailbox owner" is tested differently per flavor: generic IMAP mirrors sent mail into a
// real folder, but Gmail syncs only [Gmail]/All Mail (§4.1), so a Gmail row's Sent-ness lives in the
// \Sent label instead. Measured in production, folder alone finds 1012 / 0 / 0 / 0 sent rows across the
// four mailboxes while the label finds 0 / 35 / 96 / 124 — a folder-only test is permanently blind on
// Gmail. JSON_CONTAINS on the exact token (not `labels LIKE '%Sent%'`) so an operator label like
// "Clients/Sent-Invoices" cannot false-positive, and the token is bound as a parameter so MySQL cannot
// swallow the unrecognised \S escape. Either branch falls back to `0` — an unconfigured generic mailbox
// (no sent_folders) or a labels column with no usable data both yield `0` for every row, the same
// conservative default decide() falls back to when it has no evidence.
export function isSentByMeSql(flavor: MailboxFlavor, sent_folders: string[]): SQL<boolean> {
  if (flavor === "gmail") {
    return sql<boolean>`JSON_CONTAINS(COALESCE(${message.labels}, '[]'), JSON_QUOTE(${GMAIL_SENT_LABEL}))`;
  }
  if (sent_folders.length === 0) {
    return sql<boolean>`0`;
  }
  return sql<boolean>`${inArray(message.folder, sent_folders)}`;
}

// The one spelling of the thread group key: a null threadKey cannot be grouped against other messages, so
// each such message stands as its own single-message thread under its own id. It is also the key
// server/mail/query/threads.ts writes into ThreadState, so every consumer must join ThreadState on this
// expression and never on the raw column — the raw column matches no row for a null threadKey (23 live
// messages today), which silently loses every snooze, done and dismissal the operator made on them.
export function threadGroupKeySql(): SQL<string> {
  return sql<string>`COALESCE(${message.thread_key}, ${message.id})`;
}

// The TypeScript half of the expiry rule isThreadOpenSql encodes below, for consumers that read
// ThreadState.state as a value instead of testing it in SQL: a snooze suppresses only until its deadline
// passes, so a lapsed one resolves back to "open", while a snooze with no deadline never expires. Both
// halves live here so the queue and the shadow journal cannot disagree about a thread the operator
// snoozed. An absent row, and any state the column holds that is not one of the four, both read as open.
export function resolveThreadState(params: { state: string | null; snoozed_until: Date | null; now: Date }): ThreadStateValue {
  const state = THREAD_STATE_VALUES.find((value) => value === params.state);

  if (state === undefined) {
    return "open";
  }

  if (state === "snoozed" && params.snoozed_until !== null && params.snoozed_until.getTime() <= params.now.getTime()) {
    return "open";
  }

  return state;
}

// §1.9's `thread_state = 'open'` as a suppression test rather than an equality, because most threads have
// no ThreadState row at all (~14,600 messages, table populated only by operator action) and an absent row
// means open. A snooze suppresses only until snoozedUntil passes, so an expired snooze returns to the
// queue on its own without a sweep writing the row back to 'open'; a snooze with no deadline never
// expires. `now` is passed in rather than read as NOW() so one request's rows and its total cannot be
// evaluated against two different clocks.
export function isThreadOpenSql(params: { mailbox_id: SqlRef; thread_key: SqlRef; now: Date }): SQL<boolean> {
  return sql<boolean>`NOT EXISTS (
    SELECT 1 FROM ${threadState}
    WHERE ${threadState.mailbox_id} = ${params.mailbox_id}
      AND ${threadState.thread_key} = ${params.thread_key}
      AND (
        ${threadState.state} IN ('done', 'dismissed')
        OR (${threadState.state} = 'snoozed' AND (${threadState.snoozed_until} IS NULL OR ${threadState.snoozed_until} > ${params.now}))
      )
  )`;
}

// §1.9's `sender NOT IN sender_suppression`. NOT EXISTS rather than a join because SenderSuppression has
// no unique index on senderAddress — a repeat dismissal of the same sender writes a second row, which a
// join would turn into a duplicated queue row and an inflated total. A null from_address matches nothing
// and so is never suppressed.
export function isSenderNotSuppressedSql(from_address: SqlRef): SQL<boolean> {
  return sql<boolean>`NOT EXISTS (
    SELECT 1 FROM ${senderSuppression}
    WHERE LOWER(${senderSuppression.sender_address}) = LOWER(${from_address})
  )`;
}
