import type { MessageSignals } from "@server/mail/classify/signals";

export type ActionClass = "keep_inbox" | "archive" | "file" | "auto_trash" | "purge";

export type GuardName = "flagged" | "too_recent" | "never_touch" | "replied_in_thread" | "derived_allowlist" | "human_attachment";

export type GuardVerdict = { name: GuardName; blocks: readonly ActionClass[]; absolute: boolean };

export type NeverTouchRuleKind = "address" | "domain" | "subject_pattern";

export type NeverTouchRuleInput = { kind: NeverTouchRuleKind; value: string };

// The half of GuardInput that is knowable from sender-level facts alone — everything the Sender Policy
// surface has when it renders a policy row without a message in hand. `subject` is nullable for exactly
// that caller: a subject_pattern rule cannot be evaluated against a sender, so it simply does not match
// there, while evaluateGuards passes the real subject and gets the full rule.
export type SenderGuardInput = {
  from_address: string;
  from_domain: string;
  subject: string | null;
  sender_known: boolean;
  never_touch_rules: NeverTouchRuleInput[];
};

export type GuardInput = {
  signals: MessageSignals;
  from_address: string;
  from_domain: string;
  subject: string;
  is_flagged: boolean;
  is_starred: boolean;
  has_attachment: boolean;
  replied_in_thread: boolean;
  never_touch_rules: NeverTouchRuleInput[];
};

const ALL_ACTION_CLASSES = ["keep_inbox", "archive", "file", "auto_trash", "purge"] as const satisfies readonly ActionClass[];

function matchesNeverTouchRule(rule: NeverTouchRuleInput, input: SenderGuardInput): boolean {
  if (rule.kind === "address") {
    return rule.value.toLowerCase() === input.from_address.toLowerCase();
  }
  if (rule.kind === "domain") {
    const rule_domain = rule.value.toLowerCase();
    const message_domain = input.from_domain.toLowerCase();
    return message_domain === rule_domain || message_domain.endsWith(`.${rule_domain}`);
  }
  return input.subject?.toLowerCase().includes(rule.value.toLowerCase()) ?? false;
}

// The two guards whose definition is sender-level rather than message-level, so a caller holding only
// sender aggregates can hand real verdicts to isBlocked instead of paraphrasing its contract. Split out
// for src/routes/admin/senders.tsx, which used to test `action === "auto_trash" && my_reply_count > 0`
// by hand and so ignored the explicit-address override isBlocked applies — rendering an address-scoped
// auto_trash policy as suppressed while the engine would in fact trash the mail.
export function evaluateSenderGuards(input: SenderGuardInput): GuardVerdict[] {
  const verdicts: GuardVerdict[] = [];

  if (input.never_touch_rules.some((rule) => matchesNeverTouchRule(rule, input))) {
    verdicts.push({ name: "never_touch", blocks: ALL_ACTION_CLASSES, absolute: true });
  }
  // sender_known (my_reply_count > 0) means "we have written to this sender at all", not specifically
  // "we emailed them first" per §5.3 — no first-contact data exists to tell the two apart. sender_known
  // is a strict superset, so this guard over-fires relative to the spec's predicate; that is the safe
  // direction because it only ever blocks destruction, and the operator can still override it per-address.
  if (input.sender_known) {
    verdicts.push({ name: "derived_allowlist", blocks: ["auto_trash", "purge"], absolute: false });
  }

  return verdicts;
}

export function evaluateGuards(input: GuardInput): GuardVerdict[] {
  const sender_verdicts = evaluateSenderGuards({
    from_address: input.from_address,
    from_domain: input.from_domain,
    subject: input.subject,
    sender_known: input.signals.sender_known,
    never_touch_rules: input.never_touch_rules,
  });
  const verdicts: GuardVerdict[] = [];

  if (input.is_flagged || input.is_starred) {
    verdicts.push({ name: "flagged", blocks: ALL_ACTION_CLASSES, absolute: true });
  }
  if (input.signals.age_days < 1) {
    verdicts.push({ name: "too_recent", blocks: ALL_ACTION_CLASSES, absolute: true });
  }
  // The sender-level verdicts go back in at the positions they held before they were extracted, because
  // isBlocked reports the FIRST matching verdict by name and that name is what the shadow journal and the
  // Sender Policy surface display.
  verdicts.push(...sender_verdicts.filter((verdict) => verdict.absolute));

  // §5.3: these three protect against destruction, not organisation — active client correspondence is
  // exactly the shape "we've replied in this thread" and "we've written to this sender" describe, so
  // making them absolute (as an earlier spec draft did) would make automatic filing unreachable and
  // delete the record-keeping half of the product. They block trash/purge and, for replied_in_thread,
  // archive as well, but never `file`.
  if (input.replied_in_thread) {
    verdicts.push({ name: "replied_in_thread", blocks: ["archive", "auto_trash", "purge"], absolute: false });
  }
  verdicts.push(...sender_verdicts.filter((verdict) => !verdict.absolute));
  if (input.has_attachment && !input.signals.is_automated && !input.signals.is_bulk) {
    verdicts.push({ name: "human_attachment", blocks: ["auto_trash", "purge"], absolute: false });
  }

  return verdicts;
}

export function isBlocked(verdicts: GuardVerdict[], action: ActionClass, policy_is_explicit_address: boolean): GuardName | null {
  const absolute_hit = verdicts.find((verdict) => verdict.absolute && verdict.blocks.includes(action));
  if (absolute_hit) {
    return absolute_hit.name;
  }
  if (policy_is_explicit_address) {
    return null;
  }
  const scoped_hit = verdicts.find((verdict) => !verdict.absolute && verdict.blocks.includes(action));
  return scoped_hit ? scoped_hit.name : null;
}
