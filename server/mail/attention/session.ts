// Deciding whether the operator was actually reading mail.
//
// The dwell clock counts triage sessions survived rather than days elapsed (inbox-dwell §1.1), so this is
// the thing the whole unread sweep rests on: get it wrong and mail either never ages or ages while he is
// on a plane. Pure, so it can be argued with from fixtures.

// One sync window's worth of witnessed human activity.
//
// These MUST be transitions, never raw CONDSTORE reports. Any mutation bumps MODSEQ, so the sync after a
// bulk apply is re-told about every message it touched, each carrying flags it has held for years —
// counting those would let the sweeps manufacture their own triage sessions and accelerate their own
// clock. That is 565fb58's bug class in a new component; server/mail/sync/incremental.ts filters through
// the stored value before anything reaches here.
export type AttentionEvidence = {
  observed_at: Date;
  mailbox_id: string;
  // unseen -> seen, judged against what the database already held.
  seen_transitions: number;
  // \Flagged set or cleared, same test.
  flag_changes: number;
  // A message that appeared in a Sent folder.
  replies_sent: number;
};

export type OpenSession = {
  id: string;
  started_at: Date;
  ended_at: Date;
  seen_transitions: number;
  flag_changes: number;
  replies_sent: number;
  evidence_mailbox_ids: string[];
};

export type SessionOutcome =
  | { kind: "ignored"; reason: string }
  | { kind: "extended"; session: OpenSession }
  | { kind: "opened"; session: Omit<OpenSession, "id"> };

// §1.4. A single seen-transition is a phone auto-preview or a notification tap, not a triage. Two
// distinct events, or any reply, is someone working. The operator's own framing: "I've read 2 emails and
// ignored 10 would be a good sign that I've checked my inbox."
export const MIN_EVIDENCE_EVENTS = 2;

// Consecutive qualifying windows inside this gap are one sitting. Without it a twenty-minute triage
// spread across three syncs counts three times and burns the whole decline budget in one go.
export const SESSION_GAP_MS = 2 * 60 * 60 * 1000;

export function evidenceCount(evidence: AttentionEvidence): number {
  return evidence.seen_transitions + evidence.flag_changes + evidence.replies_sent;
}

// A reply is sufficient on its own. Sending mail is unambiguously a person at a keyboard, and it is the
// one signal here that cannot be produced by a phone rendering a preview pane.
export function qualifiesAsAttention(evidence: AttentionEvidence): boolean {
  return evidence.replies_sent > 0 || evidenceCount(evidence) >= MIN_EVIDENCE_EVENTS;
}

export function foldEvidence(input: { open: OpenSession | null; evidence: AttentionEvidence; gap_ms?: number }): SessionOutcome {
  const { open, evidence } = input;
  const gap_ms = input.gap_ms ?? SESSION_GAP_MS;

  if (!qualifiesAsAttention(evidence)) {
    return { kind: "ignored", reason: `${evidenceCount(evidence)} evidence events, below the ${MIN_EVIDENCE_EVENTS} needed` };
  }

  // Measured from the session's END, not its start: a long sitting stays one session however long it
  // runs, and only silence closes it. Measuring from the start would split any triage lasting over the
  // gap into two, which would count one sitting twice against every unread message.
  if (open !== null && evidence.observed_at.getTime() - open.ended_at.getTime() <= gap_ms) {
    return {
      kind: "extended",
      session: {
        ...open,
        ended_at: evidence.observed_at,
        seen_transitions: open.seen_transitions + evidence.seen_transitions,
        flag_changes: open.flag_changes + evidence.flag_changes,
        replies_sent: open.replies_sent + evidence.replies_sent,
        evidence_mailbox_ids: [...new Set([...open.evidence_mailbox_ids, evidence.mailbox_id])].sort(),
      },
    };
  }

  return {
    kind: "opened",
    session: {
      started_at: evidence.observed_at,
      ended_at: evidence.observed_at,
      seen_transitions: evidence.seen_transitions,
      flag_changes: evidence.flag_changes,
      replies_sent: evidence.replies_sent,
      evidence_mailbox_ids: [evidence.mailbox_id],
    },
  };
}
