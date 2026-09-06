import type { ActionClass, GuardInput, GuardName, GuardVerdict } from "@server/mail/classify/guards";
import { evaluateGuards, isBlocked } from "@server/mail/classify/guards";

export const THREAD_STATE_VALUES = ["open", "snoozed", "done", "dismissed"] as const;

export type ThreadStateValue = (typeof THREAD_STATE_VALUES)[number];

export type PolicyScope = "address" | "domain";

// A policy can never name `purge`: §1.7 and §8 run the irreversible sweep as a separate scheduled job,
// never inline with classification, so no path through decide() may emit it. The type states it and
// POLICY_ACTIONS re-checks it at runtime, because `sender_policy.action` is a varchar with no database
// enum behind it — a hand-written row must not be able to reach the executor with `purge` in it.
// `quarantine` joins `purge` in the exclusion, for the same reason and by a different route. A policy is
// a statement about a sender the operator has already met; quarantine is what happens when there is no
// such statement to make. A policy naming it would be self-cancelling — its own existence disqualifies
// the message from the rule it names — so the type refuses it rather than leaving a rule that reads as
// available and silently never fires.
export type PolicyAction = Exclude<ActionClass, "purge" | "quarantine">;

export const POLICY_ACTIONS = ["keep_inbox", "archive", "file", "auto_trash"] as const satisfies readonly PolicyAction[];

export type SenderPolicyInput = {
  id: string;
  scope: PolicyScope;
  value: string;
  action: PolicyAction;
  suspended_at: Date | null;
};

export type DecisionInput = GuardInput & {
  thread_state: ThreadStateValue;
  last_in_thread_is_mine: boolean;
  sender_suppressed: boolean;
  policies: readonly SenderPolicyInput[];
  // Inbox-dwell 1.8/1.9. Computed by the CALLER from stored columns — in the inbox, is_seen, older than
  // the mailbox's dwell_settled_days — never in here. decide() stays pure over its input and gains no
  // notion of "now" beyond the age_days it is already handed.
  //
  // False on every classification path. The scheduled classify pass looks at mail it has never seen
  // before, where nothing has had time to settle; only the sweep stage sets this.
  settled_sweep_candidate: boolean;
  // Inbox-dwell 1.1/1.9. How many triage sessions this message has sat unread through — computed by the
  // CALLER from the session log, never in here, for the same reason settled_sweep_candidate is.
  //
  // Null means "not a candidate for the unread sweep": already read, not in the inbox, or this pass is
  // not the unread sweep at all. Distinct from 0, which means the message IS a candidate and has simply
  // survived no sessions yet.
  declined_exposures: number | null;
  // 1.9's two thresholds. Supplied rather than derived here because which one applies depends on whether
  // the Needs Action signal set claims the message, and the mailbox's own configured count.
  declined_threshold: number;
};

export const DECISION_SOURCES = [
  "guard",
  "thread_state",
  "address_policy",
  "domain_policy",
  "suspended_policy",
  "first_contact",
  "derived",
  "sweep_settled",
  "sweep_declined",
  "fallback",
] as const;

export type DecisionSource = (typeof DECISION_SOURCES)[number];

// The one spelling of the settled sweep's source. The sweep's candidate query filters on it to stay
// idempotent per message, and 1.11's rescue handler keys on it to know a rescue has no policy to blame —
// a literal in either place is the two-spellings-of-one-semantic shape this module exists to prevent.
export const SWEEP_SETTLED_SOURCE = "sweep_settled" as const satisfies DecisionSource;

// The unread sweep's source. Same reasoning as the settled one: the candidate query filters on it to stay
// idempotent per message, and 1.11's rescue handler keys on it to know a rescue has no policy to blame.
export const SWEEP_DECLINED_SOURCE = "sweep_declined" as const satisfies DecisionSource;

// `Action.source` is a varchar with no database enum behind it, so a row written by an older build or by
// hand can hold a value decide() never emits. Null says exactly that — "not one of ours" — rather than an
// assertion that hands a caller a union member the string was never checked against.
export function toDecisionSource(raw: string): DecisionSource | null {
  return DECISION_SOURCES.find((value) => value === raw) ?? null;
}

export type Decision = {
  action: ActionClass | "needs_action";
  source: DecisionSource;
  policy_id: string | null;
  suppressed_by: GuardName | null;
  reasons: string[];
};

// §5.4: a derived default may only ever propose `archive` — destruction requires a policy a human
// created. The derived step is typed to this set so that emitting `auto_trash` or `purge` from it is a
// compile error rather than a code-review catch.
export const DERIVED_ACTIONS = ["keep_inbox", "archive", "needs_action"] as const;

export type DerivedAction = (typeof DERIVED_ACTIONS)[number];

export const DERIVED_ARCHIVE_AGE_DAYS = 30;

// Shorter than the bulk-mail window above, deliberately. A meeting that finished a week ago has no
// further claim on the inbox, and unlike an unrecognised newsletter there is no evidence still accruing
// about whether the sender matters — the operator has already replied to them.
export const CALENDAR_ARCHIVE_AGE_DAYS = 7;

type DerivedOutcome = { action: DerivedAction; reasons: string[] };

type PolicyMatch = { policy: SenderPolicyInput; scope: PolicyScope };

// Narrowed to the four things it actually reads, rather than taking the whole DecisionInput. The shadow
// runner has to ask this question BEFORE it can finish building one — 1.9's double threshold depends on
// the answer — and widening the parameter would have forced a cast there, which is a lie the type system
// then stops checking.
export type NeedsActionSignalInput = Pick<DecisionInput, "signals" | "last_in_thread_is_mine" | "thread_state" | "sender_suppressed">;

export function matchesNeedsActionSignals(input: NeedsActionSignalInput): boolean {
  return (
    !input.signals.is_bulk &&
    !input.signals.is_automated &&
    input.signals.addressed_to_me &&
    !input.last_in_thread_is_mine &&
    input.thread_state === "open" &&
    !input.sender_suppressed
  );
}

function isApplicablePolicyAction(action: string): action is PolicyAction {
  return POLICY_ACTIONS.some((value) => value === action);
}

function absoluteGuardName(verdicts: GuardVerdict[]): GuardName | null {
  return verdicts.find((verdict) => verdict.absolute)?.name ?? null;
}

function findPolicy(input: DecisionInput, scope: PolicyScope): SenderPolicyInput | null {
  const target = scope === "address" ? input.from_address : input.from_domain;
  const normalized_target = target.toLowerCase();
  const match = input.policies.find((policy) => policy.scope === scope && policy.value.toLowerCase() === normalized_target);
  return match ?? null;
}

// The single spelling of §5.2's address-outranks-domain precedence, so step 1 can name the policy an
// absolute guard overrode and steps 3-4 cannot disagree with it about which policy matched.
function matchPolicy(input: DecisionInput): PolicyMatch | null {
  const address_match = findPolicy(input, "address");
  if (address_match !== null) {
    return { policy: address_match, scope: "address" };
  }
  const domain_match = findPolicy(input, "domain");
  if (domain_match !== null) {
    return { policy: domain_match, scope: "domain" };
  }
  return null;
}

function describeSender(input: DecisionInput, scope: PolicyScope): string {
  return scope === "address" ? input.from_address : input.from_domain;
}

function policyDecision(input: DecisionInput, verdicts: GuardVerdict[], match: PolicyMatch): Decision {
  const { policy, scope } = match;
  const source: DecisionSource = scope === "address" ? "address_policy" : "domain_policy";
  const target = describeSender(input, scope);

  // §8 suspends a policy because acting on this target already went wrong once, so resolution stops here
  // rather than falling through to a broader rule and re-acting on the same sender by another route.
  if (policy.suspended_at !== null) {
    return {
      action: "keep_inbox",
      source: "suspended_policy",
      policy_id: policy.id,
      suppressed_by: null,
      reasons: [
        `${scope} policy for ${target} says ${policy.action}`,
        "that policy is suspended, so nothing is done and no broader rule applies",
      ],
    };
  }

  if (!isApplicablePolicyAction(policy.action)) {
    return {
      action: "keep_inbox",
      source,
      policy_id: policy.id,
      suppressed_by: null,
      reasons: [`${scope} policy for ${target} names an action classification never applies`],
    };
  }

  const suppressed_by = isBlocked(verdicts, policy.action, scope === "address");

  if (suppressed_by !== null) {
    return {
      action: "keep_inbox",
      source,
      policy_id: policy.id,
      suppressed_by,
      reasons: [`${scope} policy for ${target} says ${policy.action}`, `suppressed by guard: ${suppressed_by}`],
    };
  }

  return {
    action: policy.action,
    source,
    policy_id: policy.id,
    suppressed_by: null,
    reasons: [`${scope} policy for ${target} says ${policy.action}`],
  };
}

function describeUnsolicitedSender(input: DecisionInput): string[] {
  const reasons: string[] = [];
  if (input.signals.is_bulk) {
    reasons.push("sender sends bulk mail");
  }
  if (input.signals.is_automated) {
    reasons.push("sender is automated");
  }
  // Inside the gate, not after it: the claim is only true while the caller has checked sender_known, and
  // Phase 2 already shipped a queue that asserted "no reply sent" on rows where nothing established it.
  if (!input.signals.sender_known) {
    reasons.push("no reply has ever been sent to this sender");
  }
  return reasons;
}

function derivedOutcome(input: DecisionInput): DerivedOutcome | null {
  const { signals } = input;
  const unsolicited_bulk = (signals.is_bulk || signals.is_automated) && !signals.sender_known;

  if (unsolicited_bulk && signals.age_days > DERIVED_ARCHIVE_AGE_DAYS) {
    return {
      action: "archive",
      reasons: [
        ...describeUnsolicitedSender(input),
        `${signals.age_days} days old, past the ${DERIVED_ARCHIVE_AGE_DAYS}-day derived-archive age`,
      ],
    };
  }

  if (unsolicited_bulk) {
    return {
      action: "keep_inbox",
      reasons: [
        ...describeUnsolicitedSender(input),
        `${signals.age_days} days old, within the ${DERIVED_ARCHIVE_AGE_DAYS}-day window where evidence is still accruing`,
      ],
    };
  }

  // Meeting churn from someone the operator actually works with. The largest single block of unsorted
  // mail in the estate as of 2026-08-26 — ~263 messages of "Updated invitation" and "Canceled event" from
  // colleagues — and no policy could name it: resolution is by sender, and those senders also send real
  // mail, so a rule on them would archive both.
  //
  // `sender_known` is load-bearing, not decoration. It limits this to people the operator has written
  // back to, which is what separates a colleague's meeting series from an invitation sent by a stranger —
  // the second is a first contact and belongs to the quarantine rung above, not here.
  //
  // `=== true` rather than truthiness: is_calendar is a tri-state and null means the structure was never
  // observed. Archiving on "not definitely false" would sweep every message that predates the column.
  if (signals.is_calendar === true && signals.sender_known && signals.age_days > CALENDAR_ARCHIVE_AGE_DAYS) {
    return {
      action: "archive",
      reasons: [
        "a calendar message, by its MIME structure rather than its subject line",
        "from a sender this mailbox has replied to",
        `${signals.age_days} days old, past the ${CALENDAR_ARCHIVE_AGE_DAYS}-day calendar-archive age`,
      ],
    };
  }

  if (matchesNeedsActionSignals(input)) {
    return {
      action: "needs_action",
      reasons: [
        "addressed to me by a human",
        "the last message in the thread is not mine",
        "the thread is open and the sender is not suppressed",
      ],
    };
  }

  return null;
}

// dkim_aligned is deliberately never read here. It is a tri-state whose `null` means "the server does
// not stamp Authentication-Results", not "DKIM failed", and reading it as failure would mis-handle the
// largest mailbox in the system. The one rule that genuinely wants DKIM evidence — §6's requirement that
// filing be alignment-verified — declines to act by routing to `filing_queue`, which is filing/resolver.ts's
// job because a Decision has no way to name that queue.
export function decide(input: DecisionInput): Decision {
  const verdicts = evaluateGuards(input);

  const policy_match = matchPolicy(input);

  const absolute_guard = absoluteGuardName(verdicts);
  if (absolute_guard !== null) {
    const reasons = [`absolute guard ${absolute_guard} blocks every action on this message`];
    if (policy_match !== null && policy_match.policy.suspended_at !== null) {
      reasons.push("the policy it overrode is also suspended");
    }
    return {
      action: "keep_inbox",
      source: "guard",
      policy_id: policy_match?.policy.id ?? null,
      suppressed_by: absolute_guard,
      reasons,
    };
  }

  if (input.thread_state === "snoozed" || input.thread_state === "done") {
    return {
      action: "keep_inbox",
      source: "thread_state",
      policy_id: null,
      suppressed_by: null,
      reasons: [`the thread is ${input.thread_state}, which suppresses any action`],
    };
  }

  if (policy_match !== null) {
    return policyDecision(input, verdicts, policy_match);
  }

  // Below every explicit rule and above `derived`, per §D3 of the quarantine spec.
  //
  // Reaching this line already proves no address or domain policy names this sender — matchPolicy
  // returned null above — so the "no policy" third of the first-contact test needs no separate check and
  // cannot drift out of agreement with the precedence that establishes it.
  //
  // `derived` sits below rather than above because a derived rule infers from behaviour with a sender,
  // and a first contact has no behaviour to infer from. There is nothing here for the two to disagree
  // about.
  if (input.signals.is_first_contact) {
    const suppressed_by = isBlocked(verdicts, "quarantine", false);
    if (suppressed_by !== null) {
      return {
        action: "keep_inbox",
        source: "first_contact",
        policy_id: null,
        suppressed_by,
        reasons: [
          `first message ever from ${input.from_address}, never replied to, named by no policy`,
          `guard ${suppressed_by} blocks quarantining it`,
        ],
      };
    }
    return {
      action: "quarantine",
      source: "first_contact",
      policy_id: null,
      suppressed_by: null,
      reasons: [
        `first message ever from ${input.from_address}`,
        "nothing has ever been sent back to this sender",
        "no address or domain policy names them",
      ],
    };
  }

  const derived = derivedOutcome(input);

  // Step 6.4, immediately above the settled sweep and for the same reasons — see the block below for why
  // position alone does the work of six explicit checks.
  //
  // Unread mail the operator has been shown and has declined, session after session. `>=` against a
  // threshold the CALLER supplies per message, because mail somebody is waiting on gets a longer rope:
  // 1.9 puts ordinary mail at 3 declines and Needs Action mail at 6, and which applies depends on facts
  // only the caller has.
  //
  // Above settled rather than below it because the two candidate sets are disjoint — settled is read mail,
  // declined is unread — so the order is a statement of intent rather than a tiebreak. Stated anyway: if
  // the definitions ever overlap, being declined is the more specific claim and should win.
  if (input.declined_exposures !== null && input.declined_exposures >= input.declined_threshold) {
    const suppressed_by = isBlocked(verdicts, "archive", false);
    if (suppressed_by !== null) {
      return {
        action: "keep_inbox",
        source: SWEEP_DECLINED_SOURCE,
        policy_id: null,
        suppressed_by,
        reasons: [`unread through ${input.declined_exposures} triage sessions`, `suppressed by guard: ${suppressed_by}`],
      };
    }
    return {
      action: "archive",
      source: SWEEP_DECLINED_SOURCE,
      policy_id: null,
      suppressed_by: null,
      reasons: [
        `present and unread through ${input.declined_exposures} triage sessions`,
        "offered and declined each time, rather than simply old",
      ],
    };
  }

  // Step 6.5, and its POSITION is the whole rule. Every step above either returns or declines before
  // reaching here, so each of them beats a sweep without a single explicit check, and only step 7's
  // fallback is displaced. The first draft of this design had the sweep "honour the ladder's verdict",
  // which for essentially every candidate is that fallback — it would have archived nothing, ever.
  //
  // A derived outcome that NAMES an action (archive, or needs_action) keeps it; a derived keep_inbox
  // means "bulk mail, evidence still accruing", which is not an opinion worth defending against a
  // message that has demonstrably sat read in the inbox for a week. needs_action winning here is what
  // protects the Needs Action queue in Branch A, with no special case written anywhere.
  if (input.settled_sweep_candidate && (derived === null || derived.action === "keep_inbox")) {
    // 1.10: the Settled sweep, and ONLY the Settled sweep, is exempt from replied_in_thread. That guard
    // stops a SENDER POLICY archiving live client correspondence; this is a different claim — this
    // message has been in the inbox a week and has demonstrably been read. A thread answered a week ago
    // and untouched since is the textbook settled thread, the best candidate rather than the worst.
    // Every other guard, absolute and scoped, applies unchanged.
    const sweep_verdicts = verdicts.filter((verdict) => verdict.name !== "replied_in_thread");
    const suppressed_by = isBlocked(sweep_verdicts, "archive", false);
    if (suppressed_by !== null) {
      return {
        action: "keep_inbox",
        source: "sweep_settled",
        policy_id: null,
        suppressed_by,
        reasons: ["read, and settled in the inbox past the dwell", `suppressed by guard: ${suppressed_by}`],
      };
    }
    return {
      action: "archive",
      source: "sweep_settled",
      policy_id: null,
      suppressed_by: null,
      reasons: ["read, and settled in the inbox past the dwell", "no guard, thread state, policy or derived rule claims this message"],
    };
  }

  if (derived !== null) {
    const derived_action_class: ActionClass | null = derived.action === "needs_action" ? null : derived.action;
    const suppressed_by = derived_action_class === null ? null : isBlocked(verdicts, derived_action_class, false);
    if (suppressed_by !== null) {
      return {
        action: "keep_inbox",
        source: "derived",
        policy_id: null,
        suppressed_by,
        reasons: [...derived.reasons, `suppressed by guard: ${suppressed_by}`],
      };
    }
    return { action: derived.action, source: "derived", policy_id: null, suppressed_by: null, reasons: derived.reasons };
  }

  // §5.2 step 6, the safety spine: every step above either returns or declines, so an unclassified
  // message lands here and is left exactly where it is. The system acts only where a policy explicitly
  // says to, which makes silence the safe outcome — never replace this with a computed action.
  return {
    action: "keep_inbox",
    source: "fallback",
    policy_id: null,
    suppressed_by: null,
    reasons: ["no guard, thread state, policy or derived default applied, so the message is left in place"],
  };
}
