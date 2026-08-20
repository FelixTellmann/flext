import type { MessageAddress } from "@server/mail/rescue/locate";
import { messageAddressForAction } from "@server/mail/rescue/locate";
import type { RescueSignal } from "@server/mail/rescue/signals";
import { judgeRescue } from "@server/mail/rescue/signals";

// One `applied` action still awaiting judgement. `applied_at` is non-null by construction: the port's
// query excludes rows without one, because §8's test is "after appliedAt" and a row with no apply moment
// has nothing to be after.
export type RescueCandidateRow = {
  action_id: string;
  message_id: string;
  // Nullable on the table, and nullable here: a row whose policy was deleted must still be judged and
  // still be stamped. It simply has nothing left to suspend.
  sender_policy_id: string | null;
  kind: string;
  to_state_json: string | null;
  applied_at: Date;
};

// The three facts the verdict and the reason text need, read from wherever the message lives NOW.
// `subject` rides along because the operator reads the suspension reason without the message in front of
// them — a reason naming only dates identifies no message they can go and look at.
export type LiveMessageFacts = {
  subject: string | null;
  opened_at: Date | null;
  last_reply_at: Date | null;
};

export type RescueStampEntry = { action_id: string; rescued_at: Date };
export type PolicySuspensionEntry = { sender_policy_id: string; suspended_at: Date; reason: string };

// The database sits behind a port so the pass can be exercised over a fake, exactly as ActionJournal does
// for the executor: every DATABASE_URL variant points at the same production MySQL, so a test that
// reached a real implementation would suspend live policies and stamp 44,102 live Action rows.
// server/mail/rescue/journal.ts holds the only drizzle-backed implementation.
//
// Two properties belong to the implementation, not to callers of this pass:
//   - loadRescueCandidates filters `rescuedAt IS NULL` IN THE QUERY. That is what makes the pass
//     idempotent and what stops it re-suspending a policy the operator deliberately un-suspended.
//   - suspendPolicy is guarded `WHERE suspendedAt IS NULL` IN THE UPDATE. A policy already suspended
//     keeps its original reason, because the first rescue is the one that explains it.
export type RescuePort = {
  loadRescueCandidates: (input: { mailbox_id: string; batch_size: number }) => Promise<RescueCandidateRow[]>;
  // Null for an address that resolves to no row at all — a message the operator deleted outright, or a
  // move whose destination the sync has not fetched yet. Neither is an error: the next pass judges it.
  loadLiveMessage: (input: { mailbox_id: string; address: MessageAddress }) => Promise<LiveMessageFacts | null>;
  markRescued: (entries: RescueStampEntry[]) => Promise<void>;
  suspendPolicy: (entry: PolicySuspensionEntry) => Promise<void>;
};

export type DetectRescuesResult = {
  examined: number;
  rescued: number;
  suspended: number;
  // Candidates whose address resolved to no live row. Counted rather than swallowed: a run where this
  // climbs means addresses are going stale, which is the failure Task 1 exists to prevent.
  unresolved: number;
};

const NO_SUBJECT = "(no subject)";

// Past tense, because the operator is reading about something that already happened to their mail. The
// fallback keeps an unrecognised kind readable instead of throwing while writing the one sentence the
// operator uses to decide whether a rule was wrong.
const KIND_PHRASES: Record<string, string> = {
  archive: "archived it",
  file: "filed it away",
  auto_trash: "moved it to trash",
};

const SIGNAL_PHRASES: Record<RescueSignal, string> = {
  opened: "you opened",
  replied: "you replied to",
};

function asDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}

// What the operator reads before deciding whether to clear the suspension. A reason they cannot act on is
// one they will clear blindly, so it names all four things they need: the signal, the message, when they
// acted, and when the rule acted — plus the fact that the action itself is reversible.
export function rescueSuspensionReason(input: {
  signal: RescueSignal;
  at: Date;
  subject: string | null;
  kind: string;
  applied_at: Date;
}): string {
  const subject = input.subject === null || input.subject.length === 0 ? NO_SUBJECT : input.subject;
  const kind_phrase = KIND_PHRASES[input.kind] ?? `applied "${input.kind}" to it`;

  return `rescued: ${SIGNAL_PHRASES[input.signal]} "${subject}" on ${asDay(input.at)} after this rule ${kind_phrase} on ${asDay(
    input.applied_at,
  )}. The rule is suspended until you clear it; the action is in the journal and can be undone.`;
}

// Reads rows the sync already wrote and writes only to SenderPolicy and Action. No provider, no IMAP, no
// mailbox mutation of any kind — the whole point of §8's rescue test is that it observes what the
// operator did without touching what they did it to.
export async function detectRescues(input: { port: RescuePort; mailbox_id: string; batch_size: number }): Promise<DetectRescuesResult> {
  if (input.mailbox_id.length === 0) {
    throw new Error("detectRescues needs a mailbox id: an unscoped pass would suspend policies off evidence from every mailbox at once.");
  }
  if (!Number.isInteger(input.batch_size) || input.batch_size < 1) {
    throw new Error(
      `detectRescues needs a positive batch size, got ${input.batch_size}. The caller bounds how much of the journal one run reads.`,
    );
  }

  const candidates = await input.port.loadRescueCandidates({ mailbox_id: input.mailbox_id, batch_size: input.batch_size });

  const stamps: RescueStampEntry[] = [];
  const suspended_in_this_run = new Set<string>();
  let unresolved = 0;
  let suspended = 0;

  for (const candidate of candidates) {
    // Where the message lives NOW, which on generic IMAP is a different row from the one the action
    // names. Joining on Action.messageId would read a dead row whose openedAt can never change again.
    const address = messageAddressForAction({ message_id: candidate.message_id, to_state_json: candidate.to_state_json });
    const live = await input.port.loadLiveMessage({ mailbox_id: input.mailbox_id, address });

    if (live === null) {
      unresolved += 1;
      continue;
    }

    const verdict = judgeRescue({ applied_at: candidate.applied_at, opened_at: live.opened_at, last_reply_at: live.last_reply_at });
    if (!verdict.rescued) {
      continue;
    }

    stamps.push({ action_id: candidate.action_id, rescued_at: new Date() });

    if (candidate.sender_policy_id === null) {
      continue;
    }
    if (suspended_in_this_run.has(candidate.sender_policy_id)) {
      continue;
    }

    // Suspend BEFORE stamping. A crash between the two re-detects the same rescue on the next pass and
    // re-suspends harmlessly; the reverse order would stamp the action, hide it from every future pass,
    // and leave the wrong rule running forever.
    await input.port.suspendPolicy({
      sender_policy_id: candidate.sender_policy_id,
      suspended_at: new Date(),
      reason: rescueSuspensionReason({
        signal: verdict.signal,
        at: verdict.at,
        subject: live.subject,
        kind: candidate.kind,
        applied_at: candidate.applied_at,
      }),
    });
    suspended_in_this_run.add(candidate.sender_policy_id);
    suspended += 1;
  }

  if (stamps.length > 0) {
    await input.port.markRescued(stamps);
  }

  return { examined: candidates.length, rescued: stamps.length, suspended, unresolved };
}
