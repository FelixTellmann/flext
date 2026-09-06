import { isOneClick, parseListUnsubscribe } from "@server/mail/unsubscribe/parse";

// The pure half of the bulk button: what to POST to, and what one sender's row on the result table says
// once the executor has run. No db import, so the tests stay off production.

export type OneClickSource = { mailbox_id: string; list_unsubscribe: string | null; list_unsubscribe_post: string | null };

export type OneClickTarget = { mailbox_id: string; url: string };

// Rows newest first; the first one that carries both the RFC 8058 header and an http target wins. A
// sender whose newer mail dropped the header but whose older mail had it still gets the older URL —
// the list is the same list.
export function pickOneClickTarget(rows: OneClickSource[]): OneClickTarget | null {
  for (const row of rows) {
    if (!isOneClick(row.list_unsubscribe_post)) {
      continue;
    }
    const url = parseListUnsubscribe(row.list_unsubscribe).http;
    if (url !== null) {
      return { mailbox_id: row.mailbox_id, url };
    }
  }
  return null;
}

export type SenderArchiveSummary = { archived: number; failed: number; waiting: number; retried: number; refused: number };

// `failed` is every row this press executed that is not `applied` afterwards: the executor's own
// `failed`, and a row still `pending` because its mailbox connection died before the batch reached it.
// Both mean "the operator pressed archive and this message is still in the inbox". `retried` is how many
// of this press's rows had failed on an earlier press and were reopened for this one; they are counted
// again under archived or failed by what happened this time.
export function summarizeSenderArchive(input: {
  counts: { pending: number; waiting: number; retried: number; refused: number };
  pending_action_ids: string[];
  statuses: Map<string, string>;
}): SenderArchiveSummary {
  let archived = 0;
  for (const action_id of input.pending_action_ids) {
    if (input.statuses.get(action_id) === "applied") {
      archived += 1;
    }
  }
  return {
    archived,
    failed: input.pending_action_ids.length - archived,
    waiting: input.counts.waiting,
    retried: input.counts.retried,
    refused: input.counts.refused,
  };
}

// The page keys rows by (mailbox, address), so one address ticked in two mailboxes arrives twice and
// would be POSTed twice. Case-insensitive because that is how policies match; the first spelling wins.
export function dedupeAddresses(addresses: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const address of addresses) {
    const key = address.trim().toLowerCase();
    if (key.length === 0 || seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(address.trim());
  }
  return unique;
}
