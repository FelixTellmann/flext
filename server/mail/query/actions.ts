import { db } from "@server/db/drizzle";
import { action, mailbox, message } from "@server/db/schema";
import type { ActionStateSnapshot } from "@server/mail/actions/state";
import { parseActionState } from "@server/mail/actions/state";
import type { ActionErrorNote, ActionStatus } from "@server/mail/actions/status";
import { ACTION_STATUSES, classifyActionError, toActionStatus } from "@server/mail/actions/status";
import type { MessageLocation } from "@server/mail/query/deep-link";
import { buildMessageLocation } from "@server/mail/query/deep-link";
import type { SQL } from "drizzle-orm";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";

// §9's Action Journal is the trust surface: every action ever taken, with the pre-state undo would
// restore, filterable by date, mailbox, policy and sender. Reads only — every write lives behind
// server/mail/actions/.

export const ACTION_JOURNAL_STATUS_FILTERS = ["all", ...ACTION_STATUSES] as const;

export type ActionJournalStatusFilter = (typeof ACTION_JOURNAL_STATUS_FILTERS)[number];

export type ActionJournalRow = {
  action_id: string;
  message_id: string;
  // The action's OWN mailbox column, which is what undo and approval must be handed. Null on rows written
  // by Phase 3's shadow runner, which predate it: those cannot be undone or approved by id, because both
  // paths compare this value against the caller's mailbox. `mailbox_label` still names where the message
  // lives, so such a row stays readable.
  mailbox_id: string | null;
  mailbox_label: string;
  sender_policy_id: string | null;
  kind: string;
  source: string;
  status: string;
  known_status: ActionStatus | null;
  // Never render this without `status` beside it — three different writers fill the underlying column and
  // only one of them means "broken". classifyActionError carries which.
  error: ActionErrorNote | null;
  from_state: ActionStateSnapshot | null;
  to_state: ActionStateSnapshot | null;
  decided_at: string | null;
  applied_at: string | null;
  occurred_at: string;
  subject: string | null;
  from_address: string | null;
  internal_date: string;
  location: MessageLocation;
};

export type ListActionJournalInput = {
  mailbox_id: string | null;
  sender_policy_id: string | null;
  sender_address: string | null;
  status: ActionJournalStatusFilter;
  since: Date | null;
  until: Date | null;
  limit: number;
  offset: number;
};

// A shadow row has only decided_at, an applied one has both, and a row that never reached either still
// has createdAt (NOT NULL). Ordering and the date filter run over the same expression so a row can never
// sit outside the window the operator filtered by yet inside the page they are looking at.
function occurredAtSql(): SQL<Date> {
  return sql<Date>`COALESCE(${action.applied_at}, ${action.decided_at}, ${action.createdAt})`;
}

// The mailbox filter runs over message.mailboxId, not action.mailboxId: the latter is null on every row
// Phase 3 wrote, so filtering on it would hide exactly the backlog the operator is reviewing.
function buildWhere(input: ListActionJournalInput): SQL | undefined {
  const conditions: SQL[] = [];

  if (input.mailbox_id !== null) {
    conditions.push(eq(message.mailbox_id, input.mailbox_id));
  }
  if (input.sender_policy_id !== null) {
    conditions.push(eq(action.sender_policy_id, input.sender_policy_id));
  }
  if (input.sender_address !== null) {
    conditions.push(eq(message.from_address, input.sender_address));
  }
  if (input.status !== "all") {
    conditions.push(eq(action.status, input.status));
  }
  if (input.since !== null) {
    conditions.push(gte(occurredAtSql(), input.since));
  }
  if (input.until !== null) {
    conditions.push(lte(occurredAtSql(), input.until));
  }

  return conditions.length === 0 ? undefined : (and(...conditions) as SQL);
}

type JournalQueryRow = {
  action_id: string;
  message_id: string;
  action_mailbox_id: string | null;
  mailbox_label: string;
  sender_policy_id: string | null;
  kind: string;
  source: string;
  status: string;
  error: string | null;
  from_state_json: string | null;
  to_state_json: string | null;
  decided_at: Date | null;
  applied_at: Date | null;
  created_at: Date;
  subject: string | null;
  from_address: string | null;
  internal_date: Date;
  folder: string;
  flavor: string;
  account_index: number | null;
  gm_thrid: string | null;
  header_message_id: string | null;
};

function toJournalRow(row: JournalQueryRow): ActionJournalRow {
  return {
    action_id: row.action_id,
    message_id: row.message_id,
    mailbox_id: row.action_mailbox_id,
    mailbox_label: row.mailbox_label,
    sender_policy_id: row.sender_policy_id,
    kind: row.kind,
    source: row.source,
    status: row.status,
    known_status: toActionStatus(row.status),
    error: classifyActionError({ status: row.status, error: row.error }),
    from_state: parseActionState(row.from_state_json),
    to_state: parseActionState(row.to_state_json),
    decided_at: row.decided_at?.toISOString() ?? null,
    applied_at: row.applied_at?.toISOString() ?? null,
    occurred_at: (row.applied_at ?? row.decided_at ?? row.created_at).toISOString(),
    subject: row.subject,
    from_address: row.from_address,
    internal_date: row.internal_date.toISOString(),
    location: buildMessageLocation({
      flavor: row.flavor,
      account_index: row.account_index,
      gm_thrid: row.gm_thrid,
      folder: row.folder,
      message_id: row.header_message_id,
    }),
  };
}

export async function listActionJournal(input: ListActionJournalInput): Promise<{ rows: ActionJournalRow[]; total: number }> {
  const where = buildWhere(input);

  const rows_promise = db
    .select({
      action_id: action.id,
      message_id: action.message_id,
      action_mailbox_id: action.mailbox_id,
      mailbox_label: mailbox.label,
      sender_policy_id: action.sender_policy_id,
      kind: action.kind,
      source: action.source,
      status: action.status,
      error: action.error,
      from_state_json: action.from_state_json,
      to_state_json: action.to_state_json,
      decided_at: action.decided_at,
      applied_at: action.applied_at,
      created_at: action.createdAt,
      subject: message.subject,
      from_address: message.from_address,
      internal_date: message.internal_date,
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
    .orderBy(desc(occurredAtSql()), desc(action.id))
    .limit(input.limit)
    .offset(input.offset);

  const total_promise = db
    .select({ total: sql<number>`COUNT(*)` })
    .from(action)
    .innerJoin(message, eq(message.id, action.message_id))
    .innerJoin(mailbox, eq(mailbox.id, message.mailbox_id))
    .where(where);

  const [rows, total_rows] = await Promise.all([rows_promise, total_promise]);

  return { rows: rows.map(toJournalRow), total: Number(total_rows[0]?.total ?? 0) };
}
