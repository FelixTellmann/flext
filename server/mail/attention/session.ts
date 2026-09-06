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

// What an earlier incremental run witnessed, read back from SyncRun. The same three counters, keyed by
// when the run started so a pooled session can begin at the first read rather than the run that
// happened to tip the count.
export type EvidenceRun = {
  started_at: Date;
  mailbox_id: string;
  seen_transitions: number;
  flag_changes: number;
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
//
// Counted over every mailbox's runs of the last EVIDENCE_WINDOW_MS, not over one run alone: the operator
// reads one to three messages an hour spread across four mailboxes, so no single fifteen-minute run ever
// held two events and five days of real use produced zero sessions. The threshold was right; the bucket
// was wrong (docs/decisions/2026-09-06-session-evidence-pooled.md).
export const MIN_EVIDENCE_EVENTS = 2;

// Consecutive qualifying windows inside this gap are one sitting. Without it a twenty-minute triage
// spread across three syncs counts three times and burns the whole decline budget in one go.
export const SESSION_GAP_MS = 2 * 60 * 60 * 1000;

// How far back earlier runs' evidence is pooled with this run's. The same length as the gap on purpose:
// a session opened from pooled evidence starts at the earliest run in the window, and with the two equal
// that start can never fall inside the session before it, which would already have been extended.
export const EVIDENCE_WINDOW_MS = SESSION_GAP_MS;

type EvidenceCounts = Pick<AttentionEvidence, "seen_transitions" | "flag_changes" | "replies_sent">;

export function evidenceCount(evidence: EvidenceCounts): number {
  return evidence.seen_transitions + evidence.flag_changes + evidence.replies_sent;
}

// A reply is sufficient on its own. Sending mail is unambiguously a person at a keyboard, and it is the
// one signal here that cannot be produced by a phone rendering a preview pane.
export function qualifiesAsAttention(evidence: EvidenceCounts): boolean {
  return evidence.replies_sent > 0 || evidenceCount(evidence) >= MIN_EVIDENCE_EVENTS;
}

function sumEvidence(runs: EvidenceCounts[]): EvidenceCounts {
  return runs.reduce(
    (total, run) => ({
      seen_transitions: total.seen_transitions + run.seen_transitions,
      flag_changes: total.flag_changes + run.flag_changes,
      replies_sent: total.replies_sent + run.replies_sent,
    }),
    { seen_transitions: 0, flag_changes: 0, replies_sent: 0 },
  );
}

// `window` is whatever earlier runs the port handed over; the cut to the last EVIDENCE_WINDOW_MS is made
// here so the rule is complete from fixtures and does not depend on the port's query being right.
export function foldEvidence(input: {
  open: OpenSession | null;
  evidence: AttentionEvidence;
  window: EvidenceRun[];
  gap_ms?: number;
}): SessionOutcome {
  const { open, evidence } = input;
  const gap_ms = input.gap_ms ?? SESSION_GAP_MS;
  const observed_at = evidence.observed_at.getTime();

  // A run that saw nothing itself neither opens nor extends, however much the window holds: the window's
  // own runs were judged when they happened, and letting an empty run re-judge them would slide a
  // session's end forward by up to a full window past the last real evidence.
  if (evidenceCount(evidence) === 0) {
    return { kind: "ignored", reason: "no evidence this run" };
  }

  const pooled_runs = input.window.filter((run) => {
    const started_at = run.started_at.getTime();
    return started_at >= observed_at - EVIDENCE_WINDOW_MS && started_at <= observed_at && evidenceCount(run) > 0;
  });
  const pooled = sumEvidence([...pooled_runs, evidence]);

  if (!qualifiesAsAttention(pooled)) {
    return {
      kind: "ignored",
      reason: `${evidenceCount(pooled)} evidence events across ${pooled_runs.length + 1} runs, below the ${MIN_EVIDENCE_EVENTS} needed`,
    };
  }

  // Measured from the session's END, not its start: a long sitting stays one session however long it
  // runs, and only silence closes it. Measuring from the start would split any triage lasting over the
  // gap into two, which would count one sitting twice against every unread message.
  //
  // Only this run's evidence is added: whatever the window holds was folded in when it was witnessed.
  if (open !== null && observed_at - open.ended_at.getTime() <= gap_ms) {
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

  // The sitting began with the first read, not with the run that tipped the count.
  const earliest = pooled_runs.reduce((first, run) => (run.started_at < first ? run.started_at : first), evidence.observed_at);
  return {
    kind: "opened",
    session: {
      started_at: earliest,
      ended_at: evidence.observed_at,
      ...pooled,
      evidence_mailbox_ids: [...new Set([...pooled_runs.map((run) => run.mailbox_id), evidence.mailbox_id])].sort(),
    },
  };
}
