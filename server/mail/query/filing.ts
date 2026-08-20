import { db } from "@server/db/drizzle";
import { action, mailbox, message } from "@server/db/schema";
import { DEFERRED_STATUS } from "@server/mail/actions/executor";
import { FILE_KIND } from "@server/mail/actions/kinds";
import type { FilingQueueReason } from "@server/mail/filing/paths";
import { FILING_QUEUE_REASONS } from "@server/mail/filing/paths";
import type { MessageLocation } from "@server/mail/query/deep-link";
import { buildMessageLocation } from "@server/mail/query/deep-link";
import type { SQL } from "drizzle-orm";
import { and, desc, eq, sql } from "drizzle-orm";

// Task 10's half of §9's trust surface: every `file` action the gate in server/mail/filing/paths.ts could
// not resolve on its own, queued at `kind = 'file' AND status = 'deferred'` rather than a table of its
// own — there is no second status (server/mail/actions/status.ts). Reads only. resolveFiling in
// server/orpc/mail.ts is the only write path out of `deferred`, and it moves the row back to `pending` so
// it rejoins the executor unchanged.

export type ListFilingQueueInput = {
  mailbox_id: string | null;
  limit: number;
  offset: number;
};

export type FilingQueueRow = {
  action_id: string;
  // The action's OWN mailbox column (nullable, like listActionJournal's), not message.mailbox_id: resolving
  // a row checks this value against the mailbox the operator names, so the UI needs the real column, not
  // the message's, to make that call correctly.
  mailbox_id: string | null;
  message_id: string;
  subject: string | null;
  from_address: string | null;
  internal_date: string;
  mailbox_label: string;
  target_path: string | null;
  reason: FilingQueueReason | null;
  detail: string;
  location: MessageLocation;
};

export type FilingQueueResult = { rows: FilingQueueRow[]; total: number };

// action.error holds "<reason>: <detail>" — filingQueueReason (server/mail/filing/paths.ts) is the only
// writer of that shape. Split on the first ": " rather than a fixed-width slice, because detail is free
// text and may itself contain a colon. A reason outside FILING_QUEUE_REASONS should never occur — it is
// reported as null rather than guessed, so a row this parser cannot label stays visible instead of being
// silently mis-rendered as one of the four known reasons.
function parseQueueError(error: string | null): { reason: FilingQueueReason | null; detail: string } {
  if (error === null) {
    return { reason: null, detail: "" };
  }
  const separator_index = error.indexOf(": ");
  if (separator_index === -1) {
    return { reason: null, detail: error };
  }
  const raw_reason = error.slice(0, separator_index);
  const detail = error.slice(separator_index + 2);
  const known = (FILING_QUEUE_REASONS as readonly string[]).includes(raw_reason) ? (raw_reason as FilingQueueReason) : null;
  return { reason: known, detail };
}

// Every predicate applied to both the rows query and the count query, and both built before LIMIT —
// Phase 2's pagination bug shipped in exactly the shape where a predicate landed after the fetch instead.
function buildWhere(input: ListFilingQueueInput): SQL {
  const conditions: SQL[] = [eq(action.kind, FILE_KIND), eq(action.status, DEFERRED_STATUS)];
  if (input.mailbox_id !== null) {
    conditions.push(eq(message.mailbox_id, input.mailbox_id));
  }
  return and(...conditions) as SQL;
}

type FilingQueueQueryRow = {
  action_id: string;
  action_mailbox_id: string | null;
  message_id: string;
  subject: string | null;
  from_address: string | null;
  internal_date: Date;
  mailbox_label: string;
  target_path: string | null;
  error: string | null;
  folder: string;
  flavor: string;
  account_index: number | null;
  gm_thrid: string | null;
  header_message_id: string | null;
};

function toFilingQueueRow(row: FilingQueueQueryRow): FilingQueueRow {
  const { reason, detail } = parseQueueError(row.error);
  return {
    action_id: row.action_id,
    mailbox_id: row.action_mailbox_id,
    message_id: row.message_id,
    subject: row.subject,
    from_address: row.from_address,
    internal_date: row.internal_date.toISOString(),
    mailbox_label: row.mailbox_label,
    target_path: row.target_path,
    reason,
    detail,
    location: buildMessageLocation({
      flavor: row.flavor,
      account_index: row.account_index,
      gm_thrid: row.gm_thrid,
      folder: row.folder,
      message_id: row.header_message_id,
    }),
  };
}

export async function listFilingQueue(input: ListFilingQueueInput): Promise<FilingQueueResult> {
  const where = buildWhere(input);

  const rows_promise = db
    .select({
      action_id: action.id,
      action_mailbox_id: action.mailbox_id,
      message_id: action.message_id,
      subject: message.subject,
      from_address: message.from_address,
      internal_date: message.internal_date,
      mailbox_label: mailbox.label,
      target_path: action.target_path,
      error: action.error,
      folder: message.folder,
      flavor: mailbox.flavor,
      account_index: mailbox.account_index,
      gm_thrid: message.gm_thrid,
      header_message_id: message.message_id,
    })
    .from(action)
    .innerJoin(message, eq(message.id, action.message_id))
    .innerJoin(mailbox, eq(mailbox.id, message.mailbox_id))
    .where(where)
    .orderBy(desc(message.internal_date), desc(action.id))
    .limit(input.limit)
    .offset(input.offset);

  const total_promise = db
    .select({ total: sql<number>`COUNT(*)` })
    .from(action)
    .innerJoin(message, eq(message.id, action.message_id))
    .innerJoin(mailbox, eq(mailbox.id, message.mailbox_id))
    .where(where);

  const [rows, total_rows] = await Promise.all([rows_promise, total_promise]);

  return { rows: rows.map(toFilingQueueRow), total: Number(total_rows[0]?.total ?? 0) };
}
