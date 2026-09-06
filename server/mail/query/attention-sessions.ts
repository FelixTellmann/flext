import { db } from "@server/db/drizzle";
import { attentionSession, mailbox } from "@server/db/schema";
import { parseStringList } from "@server/mail/types";
import { desc, inArray } from "drizzle-orm";

// One recorded triage session, ready for the Sessions strip (inbox-dwell §3). Dates travel as ISO
// strings like listSyncRuns' rows do, so the loader payload's type matches what actually arrives.
export type RecentAttentionSession = {
  id: string;
  started_at: string;
  ended_at: string;
  seen_transitions: number;
  flag_changes: number;
  replies_sent: number;
  // Labels of the mailboxes that supplied evidence. A mailbox row deleted since the session was
  // recorded keeps its bare id here rather than disappearing — the strip is a calibration surface, and
  // a session that quietly names fewer mailboxes than it counted would miscalibrate it.
  mailbox_labels: string[];
};

// Newest first by ended_at, the same ordering loadLatestSession uses to find the session that can still
// be extended: "last believed reading mail" is the end of the most recent sitting, not its start.
export async function listRecentAttentionSessions(input: { limit: number }): Promise<RecentAttentionSession[]> {
  const rows = await db.select().from(attentionSession).orderBy(desc(attentionSession.ended_at)).limit(input.limit);
  if (rows.length === 0) {
    return [];
  }

  const sessions = rows.map((row) => ({ row, mailbox_ids: parseStringList(row.evidence_mailbox_ids) }));
  const all_ids = [...new Set(sessions.flatMap((entry) => entry.mailbox_ids))];
  const labels = new Map<string, string>();
  if (all_ids.length > 0) {
    const mailboxes = await db.select({ id: mailbox.id, label: mailbox.label }).from(mailbox).where(inArray(mailbox.id, all_ids));
    for (const entry of mailboxes) {
      labels.set(entry.id, entry.label);
    }
  }

  return sessions.map(({ row, mailbox_ids }) => ({
    id: row.id,
    started_at: row.started_at.toISOString(),
    ended_at: row.ended_at.toISOString(),
    seen_transitions: row.seen_transitions,
    flag_changes: row.flag_changes,
    replies_sent: row.replies_sent,
    mailbox_labels: mailbox_ids.map((id) => labels.get(id) ?? id),
  }));
}
