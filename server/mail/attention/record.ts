import { db } from "@server/db/drizzle";
import { attentionSession } from "@server/db/schema";
import type { AttentionEvidence, OpenSession } from "@server/mail/attention/session";
import { foldEvidence } from "@server/mail/attention/session";
import { serializeStringList } from "@server/mail/types";
import { desc, eq } from "drizzle-orm";

// Behind a port for the same reason ActionJournal and RescuePort are: a test reaching the real
// implementation would write sessions into production and change what every unread sweep decides.
export type AttentionPort = {
  // The most recent session, whatever its age. foldEvidence decides whether it is close enough to extend
  // — the gap rule lives there, so it stays testable, and this stays a plain read.
  loadLatestSession: () => Promise<OpenSession | null>;
  openSession: (session: Omit<OpenSession, "id">) => Promise<void>;
  extendSession: (session: OpenSession) => Promise<void>;
};

export type RecordAttentionResult = { kind: "ignored" | "opened" | "extended"; detail: string };

// One sync's worth of evidence, folded into the session log. Global: no mailbox scope anywhere in here,
// because §1.3's whole point is that a check of the unified inbox is a check of all of them.
export async function recordAttention(input: { port: AttentionPort; evidence: AttentionEvidence }): Promise<RecordAttentionResult> {
  const open = await input.port.loadLatestSession();
  const outcome = foldEvidence({ open, evidence: input.evidence });

  if (outcome.kind === "ignored") {
    return { kind: "ignored", detail: outcome.reason };
  }
  if (outcome.kind === "extended") {
    await input.port.extendSession(outcome.session);
    return { kind: "extended", detail: `session ${outcome.session.id} now spans to ${outcome.session.ended_at.toISOString()}` };
  }

  await input.port.openSession(outcome.session);
  return { kind: "opened", detail: `new session at ${outcome.session.started_at.toISOString()}` };
}

export function createDatabaseAttentionPort(): AttentionPort {
  return {
    loadLatestSession: async () => {
      const [row] = await db.select().from(attentionSession).orderBy(desc(attentionSession.ended_at)).limit(1);
      if (row === undefined) {
        return null;
      }
      return {
        id: row.id,
        started_at: row.started_at,
        ended_at: row.ended_at,
        seen_transitions: row.seen_transitions,
        flag_changes: row.flag_changes,
        replies_sent: row.replies_sent,
        evidence_mailbox_ids: row.evidence_mailbox_ids === null ? [] : (JSON.parse(row.evidence_mailbox_ids) as string[]),
      };
    },
    openSession: async (session) => {
      const now = new Date();
      await db.insert(attentionSession).values({
        started_at: session.started_at,
        ended_at: session.ended_at,
        seen_transitions: session.seen_transitions,
        flag_changes: session.flag_changes,
        replies_sent: session.replies_sent,
        evidence_mailbox_ids: serializeStringList(session.evidence_mailbox_ids),
        updatedAt: now,
      });
    },
    extendSession: async (session) => {
      await db
        .update(attentionSession)
        .set({
          ended_at: session.ended_at,
          seen_transitions: session.seen_transitions,
          flag_changes: session.flag_changes,
          replies_sent: session.replies_sent,
          evidence_mailbox_ids: serializeStringList(session.evidence_mailbox_ids),
          updatedAt: new Date(),
        })
        .where(eq(attentionSession.id, session.id));
    },
  };
}
