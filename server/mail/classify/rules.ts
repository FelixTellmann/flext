import type { ActionClass, GuardInput, GuardName, GuardVerdict } from "@server/mail/classify/guards";
import { evaluateGuards, isBlocked } from "@server/mail/classify/guards";

export type ThreadStateValue = "open" | "snoozed" | "done" | "dismissed";

export type PolicyScope = "address" | "domain";

// A policy can never name `purge`: §1.7 and §8 run the irreversible sweep as a separate scheduled job,
// never inline with classification, so no path through decide() may emit it. The type states it and
// POLICY_ACTIONS re-checks it at runtime, because `sender_policy.action` is a varchar with no database
// enum behind it — a hand-written row must not be able to reach the executor with `purge` in it.
export type PolicyAction = Exclude<ActionClass, "purge">;

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
};

export type DecisionSource = "guard" | "thread_state" | "address_policy" | "domain_policy" | "derived" | "fallback";

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

type DerivedOutcome = { action: DerivedAction; reasons: string[] };

export function matchesNeedsActionSignals(input: DecisionInput): boolean {
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
  const match = input.policies.find(
    (policy) => policy.scope === scope && policy.suspended_at === null && policy.value.toLowerCase() === normalized_target,
  );
  return match ?? null;
}

function describeSender(input: DecisionInput, scope: PolicyScope): string {
  return scope === "address" ? input.from_address : input.from_domain;
}

function policyDecision(input: DecisionInput, verdicts: GuardVerdict[], scope: PolicyScope): Decision | null {
  const policy = findPolicy(input, scope);
  if (policy === null) {
    return null;
  }

  const source: DecisionSource = scope === "address" ? "address_policy" : "domain_policy";
  const target = describeSender(input, scope);

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
  reasons.push("no reply has ever been sent to this sender");
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

  const absolute_guard = absoluteGuardName(verdicts);
  if (absolute_guard !== null) {
    return {
      action: "keep_inbox",
      source: "guard",
      policy_id: null,
      suppressed_by: absolute_guard,
      reasons: [`absolute guard ${absolute_guard} blocks every action on this message`],
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

  const policy_decision = policyDecision(input, verdicts, "address") ?? policyDecision(input, verdicts, "domain");
  if (policy_decision !== null) {
    return policy_decision;
  }

  const derived = derivedOutcome(input);
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
