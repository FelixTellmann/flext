import { FIRST_CONTACT_SOURCE, SWEEP_SETTLED_SOURCE } from "@server/mail/classify/rules";
import type { MessageAddress } from "@server/mail/rescue/locate";
import { messageAddressForAction } from "@server/mail/rescue/locate";
import type { RescueSignal } from "@server/mail/rescue/signals";
import { judgeRescue, seenAtApply } from "@server/mail/rescue/signals";

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
  // Decision.source. What tells a policy-driven action apart from a sweep-driven one, which is the whole
  // basis of 1.11: a sweep row has no senderPolicyId and so has nothing for this detector to suspend.
  source: string;
  to_state_json: string | null;
  // The message's state at the instant the rule moved it. Read for its flags only: an `opened` rescue
  // requires \Seen to have been ABSENT here, because a message the operator had already read cannot be
  // rescued by opening it. See seenAtApply in signals.ts.
  from_state_json: string | null;
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

// The one spelling of "which address is this?", shared by the pass, the drizzle implementation and the
// fake, so a Map built by one is readable by the others. Two shapes, two prefixes: a row id and a
// folder/uid pair can never collide.
export function messageAddressKey(address: MessageAddress): string {
  return address.by === "row" ? `row:${address.message_id}` : `addr:${address.folder}:${address.uid_validity}:${address.uid}`;
}

export type RescueStampEntry = { action_id: string; rescued_at: Date };
export type PolicySuspensionEntry = { sender_policy_id: string; suspended_at: Date; reason: string };

export type DwellSuspensionEntry = { mailbox_id: string; suspended_at: Date; reason: string };

// Inbox-dwell 1.11. A rescue against a SWEEP means something weaker than a rescue against a policy —
// opening week-old archived mail is ordinary behaviour, not necessarily a mistake — so one is journaled
// and surfaced rather than acted on. Three inside a rolling window is a pattern.
//
// The same threshold and window govern first-contact quarantine (docs/decisions/2026-09-06-scheduled-
// source-autonomy-per-mailbox.md): it is the other scheduled source with no policy to blame, and a
// message the operator went and pulled out of Quarantine is the same weak signal a re-opened archive is.
export const SWEEP_RESCUE_SUSPENSION_THRESHOLD = 3;
export const SWEEP_RESCUE_WINDOW_DAYS = 30;

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
// What the caller passed back after the previous chunk: the last row's ordering key. `null` means "start
// from the beginning" — the same spelling loadRescueCandidates already used for "no floor" before chunking
// existed, kept rather than inventing a second sentinel.
export type RescueCursor = { applied_at: Date; action_id: string };

export type RescuePort = {
  // `batch_size` is a CHUNK size, not a cap: detectRescues calls this in a loop, advancing `after` by the
  // last row of each chunk, until a chunk comes back smaller than `batch_size`. The implementation orders
  // by (appliedAt, id) ascending and, when `after` is non-null, returns only rows strictly greater than it
  // in that order — the same keyset pagination the window comment in journal.ts already argues for over
  // OFFSET: the candidate set shifts under a running pass as rows get stamped, and OFFSET counts POSITION
  // in that shifting set rather than identity.
  loadRescueCandidates: (input: { mailbox_id: string; batch_size: number; after: RescueCursor | null }) => Promise<RescueCandidateRow[]>;
  // Set-based, and that is a property of the INTERFACE rather than an implementation detail: "the newest
  // sent-by-me message in this thread" cannot be answered per address without scanning the mailbox once
  // per candidate — `COALESCE(threadKey, id) = ?` is non-sargable and no (mailboxId, threadKey) index
  // exists, so a per-address port would be ~7,900 × 30,000 rows every sync on felix@tellmann.co.za. One
  // call per batch lets the implementation build thread facts once, the way loadThreadFacts in
  // server/mail/shadow/run.ts and server/mail/query/needs-action.ts already do.
  //
  // Keyed by messageAddressKey. An address simply absent from the Map resolves to no row at all — a
  // message the operator deleted outright, or a move whose destination the sync has not fetched yet.
  // Neither is an error: the next pass judges it.
  loadLiveMessages: (input: { mailbox_id: string; addresses: MessageAddress[] }) => Promise<Map<string, LiveMessageFacts>>;
  markRescued: (entries: RescueStampEntry[]) => Promise<void>;
  // Returns whether the guarded UPDATE actually suspended anything: false means the policy was already
  // suspended and kept its original reason. The caller cannot infer this — the guard lives in SQL — so a
  // void return would make `suspended` in the result a count of ATTEMPTS, reporting suspensions the
  // database correctly refused to make.
  suspendPolicy: (entry: PolicySuspensionEntry) => Promise<boolean>;
  // 1.11's two. A sweep action carries no senderPolicyId, so without these the detector would discard
  // every rescue against it for want of an id to blame — leaving the newest and least-proven rule in the
  // system as the only one with no safety net.
  countRecentSweepRescues: (input: { mailbox_id: string; since: Date }) => Promise<number>;
  // Guarded `WHERE dwellSuspendedAt IS NULL`, exactly as suspendPolicy is, and returns whether it
  // actually suspended anything — so a mailbox the operator deliberately un-suspended is not re-suspended
  // on the next pass off the same aged evidence, and the result counts suspensions rather than attempts.
  suspendMailboxDwell: (entry: DwellSuspensionEntry) => Promise<boolean>;
  // First contact's pair, on its own columns: a rescue out of Quarantine says nothing about the sweeps,
  // and the operator clears each suspension on its own evidence. Same window, same SQL guard.
  countRecentFirstContactRescues: (input: { mailbox_id: string; since: Date }) => Promise<number>;
  suspendMailboxFirstContact: (entry: DwellSuspensionEntry) => Promise<boolean>;
};

export type DetectRescuesResult = {
  examined: number;
  rescued: number;
  // Policies this run actually suspended, never the number of attempts: a rescue against a policy that
  // was already suspended is a real rescue (it is stamped) but not a new suspension.
  suspended: number;
  // Candidates whose address resolved to no live row. Counted rather than swallowed: a run where this
  // climbs means addresses are going stale, which is the failure Task 1 exists to prevent.
  unresolved: number;
  // 1.11: whether THIS pass suspended the mailbox's sweeps. False when they were already suspended.
  dwell_suspended: boolean;
  // Whether THIS pass suspended the mailbox's first-contact quarantine, on the same terms.
  first_contact_suspended: boolean;
};

const NO_SUBJECT = "(no subject)";

// Past tense, because the operator is reading about something that already happened to their mail. The
// fallback keeps an unrecognised kind readable instead of throwing while writing the one sentence the
// operator uses to decide whether a rule was wrong.
const KIND_PHRASES: Record<string, string> = {
  archive: "archived it",
  file: "filed it away",
  auto_trash: "moved it to trash",
  quarantine: "moved it to Quarantine",
};

const SIGNAL_PHRASES: Record<RescueSignal, string> = {
  opened: "you opened",
  replied: "you replied to",
};

// Date AND time, and the zone named. A date alone contradicts itself on the common case: the sync runs
// hourly, so an archive at 09:00 and an open at 16:00 the same day printed "you opened X on 2026-08-20
// after this rule archived it on 2026-08-20", which reads as nonsense and makes the operator distrust the
// whole sentence. Naming UTC is the other half — the operator reads this at UTC+2, where a bare UTC date
// is wrong by a day for anything that happened after 22:00 local.
function asMoment(at: Date): string {
  return `${at.toISOString().slice(0, 10)} ${at.toISOString().slice(11, 16)} UTC`;
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

  return `rescued: ${SIGNAL_PHRASES[input.signal]} "${subject}" on ${asMoment(input.at)} after this rule ${kind_phrase} on ${asMoment(
    input.applied_at,
  )}. The rule is suspended until you clear it; the action is in the journal and can be undone.`;
}

// A loop breaker, not a size the pass is ever meant to reach: RESCUE_WINDOW_DAYS (journal.ts) already
// bounds the candidate set, and a well-behaved cursor exhausts it (chunk smaller than batch_size) long
// before this fires. 500 chunks covers a candidate set of 500 * batch_size — at the RESCUE_BATCH_SIZE the
// sync uses, that is millions of rows, far past anything one mailbox's 30-day window will ever hold. If it
// fires, the cursor has stopped advancing (an implementation bug) or the window has stopped bounding the
// set (a design assumption broken elsewhere) — either way a bug worth surfacing loudly, never a truncation
// to swallow silently and report as a clean `examined: N`.
const MAX_CHUNK_ITERATIONS = 500;

// Reads rows the sync already wrote and writes only to SenderPolicy and Action. No provider, no IMAP, no
// mailbox mutation of any kind — the whole point of §8's rescue test is that it observes what the
// operator did without touching what they did it to.
//
// Loops chunk by chunk rather than reading one batch: `batch_size` bounds ONE ROUND TRIP, not the total
// work. A single bulk apply can land thousands of actions within the same second, all sorted to the front
// of the 30-day window by appliedAt — a single-batch read would examine the same head of that window every
// sync and never reach the rest until it aged out 30 days later, which is silent starvation dressed up as
// a healthy `examined: N, rescued: 0`. Looping with a keyset cursor keeps memory and any one query bounded
// by `batch_size` while still covering the whole window every pass.
export async function detectRescues(input: { port: RescuePort; mailbox_id: string; batch_size: number }): Promise<DetectRescuesResult> {
  if (input.mailbox_id.length === 0) {
    throw new Error("detectRescues needs a mailbox id: an unscoped pass would suspend policies off evidence from every mailbox at once.");
  }
  if (!Number.isInteger(input.batch_size) || input.batch_size < 1) {
    throw new Error(
      `detectRescues needs a positive batch size, got ${input.batch_size}. The caller bounds how much of the journal one round trip reads.`,
    );
  }

  let cursor: RescueCursor | null = null;
  let examined = 0;
  let rescued = 0;
  let suspended = 0;
  let unresolved = 0;
  // Spans the WHOLE pass, not one chunk: a policy suspended by chunk 1 must not be attempted again — and
  // miscounted as a fresh suspension — when chunk 3 carries another rescue against the same policy.
  const suspended_in_this_run = new Set<string>();
  // 1.11. Counted across the whole pass, then resolved once at the end rather than per rescue: the
  // threshold is about a PATTERN over a window, so asking after every single stamp would both cost a query
  // per rescue and read a count that does not yet include the stamps this pass is about to write.
  let sweep_rescues_this_run = 0;
  let first_contact_rescues_this_run = 0;

  async function resolveSweepSuspension(): Promise<boolean> {
    if (sweep_rescues_this_run === 0) {
      return false;
    }

    const since = new Date(Date.now() - SWEEP_RESCUE_WINDOW_DAYS * 86_400_000);
    const recent = await input.port.countRecentSweepRescues({ mailbox_id: input.mailbox_id, since });
    if (recent < SWEEP_RESCUE_SUSPENSION_THRESHOLD) {
      return false;
    }

    return input.port.suspendMailboxDwell({
      mailbox_id: input.mailbox_id,
      suspended_at: new Date(),
      reason:
        `${recent} messages the settled sweep archived were opened or replied to within the last ` +
        `${SWEEP_RESCUE_WINDOW_DAYS} days. The sweep is suspended on this mailbox until you clear it; ` +
        "every action it took is in the journal and can be undone.",
    });
  }

  async function resolveFirstContactSuspension(): Promise<boolean> {
    if (first_contact_rescues_this_run === 0) {
      return false;
    }

    const since = new Date(Date.now() - SWEEP_RESCUE_WINDOW_DAYS * 86_400_000);
    const recent = await input.port.countRecentFirstContactRescues({ mailbox_id: input.mailbox_id, since });
    if (recent < SWEEP_RESCUE_SUSPENSION_THRESHOLD) {
      return false;
    }

    return input.port.suspendMailboxFirstContact({
      mailbox_id: input.mailbox_id,
      suspended_at: new Date(),
      reason:
        `${recent} first contacts moved to Quarantine were opened or replied to within the last ` +
        `${SWEEP_RESCUE_WINDOW_DAYS} days. First-contact quarantine is suspended on this mailbox until you ` +
        "clear it; every action it took is in the journal and can be undone.",
    });
  }

  async function finish(): Promise<DetectRescuesResult> {
    const dwell_suspended = await resolveSweepSuspension();
    const first_contact_suspended = await resolveFirstContactSuspension();
    return { examined, rescued, suspended, unresolved, dwell_suspended, first_contact_suspended };
  }

  for (let iteration = 0; iteration < MAX_CHUNK_ITERATIONS; iteration += 1) {
    const candidates = await input.port.loadRescueCandidates({ mailbox_id: input.mailbox_id, batch_size: input.batch_size, after: cursor });
    if (candidates.length === 0) {
      return finish();
    }

    // Where each message lives NOW, which on generic IMAP is a different row from the one the action
    // names. Joining on Action.messageId would read a dead row whose openedAt can never change again.
    const addresses = candidates.map((candidate) =>
      messageAddressForAction({ message_id: candidate.message_id, to_state_json: candidate.to_state_json }),
    );
    // One call per CHUNK, not per candidate: the thread half of these facts costs a scan of the mailbox,
    // and paying it per row is what turned this pass into a full cross product.
    const live_by_key = await input.port.loadLiveMessages({ mailbox_id: input.mailbox_id, addresses });

    const stamps: RescueStampEntry[] = [];

    for (const [index, candidate] of candidates.entries()) {
      examined += 1;
      const address = addresses[index];
      const live = address === undefined ? undefined : live_by_key.get(messageAddressKey(address));

      if (live === undefined) {
        unresolved += 1;
        continue;
      }

      const verdict = judgeRescue({
        applied_at: candidate.applied_at,
        opened_at: live.opened_at,
        last_reply_at: live.last_reply_at,
        seen_at_apply: seenAtApply(candidate.from_state_json),
      });
      if (!verdict.rescued) {
        continue;
      }

      stamps.push({ action_id: candidate.action_id, rescued_at: new Date() });

      if (candidate.sender_policy_id === null) {
        // 1.11: a sweep row has no policy to blame, and discarding its rescues is how the newest rule in
        // the system would end up the only one running unattended with no safety net. Counted here and
        // resolved once in finish(); everything else with no policy id genuinely has nothing to do.
        if (candidate.source === SWEEP_SETTLED_SOURCE) {
          sweep_rescues_this_run += 1;
        }
        if (candidate.source === FIRST_CONTACT_SOURCE) {
          first_contact_rescues_this_run += 1;
        }
        continue;
      }
      if (suspended_in_this_run.has(candidate.sender_policy_id)) {
        continue;
      }

      // Suspend BEFORE stamping. A crash between the two re-detects the same rescue on the next pass and
      // re-suspends harmlessly; the reverse order would stamp the action, hide it from every future pass,
      // and leave the wrong rule running forever.
      const newly_suspended = await input.port.suspendPolicy({
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

      if (newly_suspended) {
        suspended += 1;
      }
    }

    if (stamps.length > 0) {
      await input.port.markRescued(stamps);
      rescued += stamps.length;
    }

    const last = candidates[candidates.length - 1];
    if (last === undefined || candidates.length < input.batch_size) {
      return finish();
    }
    cursor = { applied_at: last.applied_at, action_id: last.action_id };
  }

  throw new Error(
    `detectRescues did not finish within ${MAX_CHUNK_ITERATIONS} chunks of ${input.batch_size} for mailbox ${input.mailbox_id}. ` +
      "Either the candidate set is far larger than a 30-day window should ever hold, or the pagination cursor stopped advancing.",
  );
}
