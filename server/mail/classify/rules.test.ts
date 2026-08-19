import { describe, expect, test } from "bun:test";
import type { GuardInput } from "@server/mail/classify/guards";
import type { Decision, DecisionInput, SenderPolicyInput, ThreadStateValue } from "@server/mail/classify/rules";
import { DERIVED_ACTIONS, decide } from "@server/mail/classify/rules";
import type { MessageSignals } from "@server/mail/classify/signals";

const base_signals: MessageSignals = {
  is_bulk: false,
  is_automated: false,
  addressed_to_me: true,
  cc_me: false,
  sender_known: false,
  dkim_aligned: true,
  volume_bucket: "low",
  age_days: 5,
};

const base_input: DecisionInput = {
  signals: base_signals,
  from_address: "person@example.com",
  from_domain: "example.com",
  subject: "Project update",
  is_flagged: false,
  is_starred: false,
  has_attachment: false,
  replied_in_thread: false,
  never_touch_rules: [],
  thread_state: "open",
  last_in_thread_is_mine: false,
  sender_suppressed: false,
  policies: [],
};

const address_archive: SenderPolicyInput = {
  id: "policy-address-archive",
  scope: "address",
  value: "person@example.com",
  action: "archive",
  suspended_at: null,
};

const address_trash: SenderPolicyInput = {
  id: "policy-address-trash",
  scope: "address",
  value: "person@example.com",
  action: "auto_trash",
  suspended_at: null,
};

const domain_archive: SenderPolicyInput = {
  id: "policy-domain-archive",
  scope: "domain",
  value: "example.com",
  action: "archive",
  suspended_at: null,
};

const domain_trash: SenderPolicyInput = {
  id: "policy-domain-trash",
  scope: "domain",
  value: "example.com",
  action: "auto_trash",
  suspended_at: null,
};

function outcome(decision: Decision): Pick<Decision, "action" | "source" | "policy_id" | "suppressed_by"> {
  return {
    action: decision.action,
    source: decision.source,
    policy_id: decision.policy_id,
    suppressed_by: decision.suppressed_by,
  };
}

function bulkInput(age_days: number, overrides: Partial<DecisionInput> = {}): DecisionInput {
  return {
    ...base_input,
    signals: { ...base_signals, is_bulk: true, addressed_to_me: false, age_days },
    from_address: "news@newsletter.example",
    from_domain: "newsletter.example",
    ...overrides,
  };
}

describe("step 1 — absolute guards override everything", () => {
  test("a flagged message beats an explicit address-level auto_trash policy", () => {
    const decision = decide({ ...base_input, is_flagged: true, policies: [address_trash] });
    expect(decision).toEqual({
      action: "keep_inbox",
      source: "guard",
      policy_id: null,
      suppressed_by: "flagged",
      reasons: ["absolute guard flagged blocks every action on this message"],
    });
  });

  test("a starred message beats an explicit address-level policy", () => {
    expect(outcome(decide({ ...base_input, is_starred: true, policies: [address_trash] }))).toEqual({
      action: "keep_inbox",
      source: "guard",
      policy_id: null,
      suppressed_by: "flagged",
    });
  });

  test("a message under 24 hours old beats an explicit address-level policy", () => {
    const decision = decide({ ...base_input, signals: { ...base_signals, age_days: 0 }, policies: [address_trash] });
    expect(outcome(decision)).toEqual({ action: "keep_inbox", source: "guard", policy_id: null, suppressed_by: "too_recent" });
  });

  test("a never_touch rule beats an explicit address-level policy", () => {
    const decision = decide({
      ...base_input,
      never_touch_rules: [{ kind: "address", value: "person@example.com" }],
      policies: [address_trash],
    });
    expect(outcome(decision)).toEqual({ action: "keep_inbox", source: "guard", policy_id: null, suppressed_by: "never_touch" });
  });
});

describe("step 2 — thread state suppresses", () => {
  test("snoozed suppresses an address-level policy", () => {
    const decision = decide({ ...base_input, thread_state: "snoozed", policies: [address_archive] });
    expect(decision).toEqual({
      action: "keep_inbox",
      source: "thread_state",
      policy_id: null,
      suppressed_by: null,
      reasons: ["the thread is snoozed, which suppresses any action"],
    });
  });

  test("done suppresses an address-level policy", () => {
    const decision = decide({ ...base_input, thread_state: "done", policies: [address_archive] });
    expect(outcome(decision)).toEqual({ action: "keep_inbox", source: "thread_state", policy_id: null, suppressed_by: null });
  });

  test("done suppresses a derived archive", () => {
    expect(outcome(decide(bulkInput(45, { thread_state: "done" })))).toEqual({
      action: "keep_inbox",
      source: "thread_state",
      policy_id: null,
      suppressed_by: null,
    });
  });

  test("open does not suppress", () => {
    expect(decide({ ...base_input, thread_state: "open", policies: [address_archive] }).source).toBe("address_policy");
  });

  test("dismissed does not suppress a policy, but does keep a message out of needs_action", () => {
    expect(decide({ ...base_input, thread_state: "dismissed", policies: [address_archive] }).source).toBe("address_policy");
    expect(outcome(decide({ ...base_input, thread_state: "dismissed" }))).toEqual({
      action: "keep_inbox",
      source: "fallback",
      policy_id: null,
      suppressed_by: null,
    });
  });
});

describe("step 3 — address-level policy", () => {
  test("applies and reports its own policy id", () => {
    const decision = decide({ ...base_input, policies: [address_archive] });
    expect(decision).toEqual({
      action: "archive",
      source: "address_policy",
      policy_id: "policy-address-archive",
      suppressed_by: null,
      reasons: ["address policy for person@example.com says archive"],
    });
  });

  test("wins over a domain-level policy for the same message", () => {
    const decision = decide({ ...base_input, policies: [domain_trash, address_archive] });
    expect(outcome(decision)).toEqual({
      action: "archive",
      source: "address_policy",
      policy_id: "policy-address-archive",
      suppressed_by: null,
    });
  });

  test("outranks a scoped guard, so suppressed_by stays null", () => {
    const decision = decide({ ...base_input, replied_in_thread: true, policies: [address_trash] });
    expect(outcome(decision)).toEqual({
      action: "auto_trash",
      source: "address_policy",
      policy_id: "policy-address-trash",
      suppressed_by: null,
    });
  });

  test("matches case-insensitively", () => {
    const decision = decide({ ...base_input, from_address: "Person@Example.com", policies: [address_archive] });
    expect(decision.source).toBe("address_policy");
  });

  test("does not match a different address", () => {
    const decision = decide({ ...base_input, from_address: "someone-else@example.com", policies: [address_archive] });
    expect(decision.source).not.toBe("address_policy");
  });

  test("a suspended address policy is treated as absent and the domain policy applies", () => {
    const decision = decide({
      ...base_input,
      policies: [{ ...address_archive, suspended_at: new Date("2026-08-01T00:00:00Z") }, domain_archive],
    });
    expect(outcome(decision)).toEqual({
      action: "archive",
      source: "domain_policy",
      policy_id: "policy-domain-archive",
      suppressed_by: null,
    });
  });
});

describe("step 4 — domain-level policy", () => {
  test("applies when no address policy matches", () => {
    const decision = decide({ ...base_input, policies: [domain_archive] });
    expect(decision).toEqual({
      action: "archive",
      source: "domain_policy",
      policy_id: "policy-domain-archive",
      suppressed_by: null,
      reasons: ["domain policy for example.com says archive"],
    });
  });

  test("a scoped guard suppresses it and the guard name is reported", () => {
    const decision = decide({ ...base_input, replied_in_thread: true, policies: [domain_trash] });
    expect(decision).toEqual({
      action: "keep_inbox",
      source: "domain_policy",
      policy_id: "policy-domain-trash",
      suppressed_by: "replied_in_thread",
      reasons: ["domain policy for example.com says auto_trash", "suppressed by guard: replied_in_thread"],
    });
  });

  test("the derived_allowlist guard suppresses a domain auto_trash policy", () => {
    const decision = decide({
      ...base_input,
      signals: { ...base_signals, sender_known: true },
      policies: [domain_trash],
    });
    expect(outcome(decision)).toEqual({
      action: "keep_inbox",
      source: "domain_policy",
      policy_id: "policy-domain-trash",
      suppressed_by: "derived_allowlist",
    });
  });

  test("the human_attachment guard suppresses a domain auto_trash policy", () => {
    const decision = decide({ ...base_input, has_attachment: true, policies: [domain_trash] });
    expect(outcome(decision)).toEqual({
      action: "keep_inbox",
      source: "domain_policy",
      policy_id: "policy-domain-trash",
      suppressed_by: "human_attachment",
    });
  });

  test("a domain policy to file survives replied_in_thread, which blocks only destruction", () => {
    const decision = decide({
      ...base_input,
      replied_in_thread: true,
      policies: [{ id: "policy-domain-file", scope: "domain", value: "example.com", action: "file", suspended_at: null }],
    });
    expect(outcome(decision)).toEqual({ action: "file", source: "domain_policy", policy_id: "policy-domain-file", suppressed_by: null });
  });

  test("does not match a subdomain, so a policy never widens its own destructive scope", () => {
    const decision = decide({ ...base_input, from_domain: "mail.example.com", policies: [domain_trash] });
    expect(decision.source).not.toBe("domain_policy");
  });

  test("a suspended domain policy is treated as absent", () => {
    const decision = decide({
      ...base_input,
      signals: { ...base_signals, addressed_to_me: false },
      policies: [{ ...domain_trash, suspended_at: new Date("2026-08-01T00:00:00Z") }],
    });
    expect(outcome(decision)).toEqual({ action: "keep_inbox", source: "fallback", policy_id: null, suppressed_by: null });
  });
});

describe("step 5 — derived defaults (§5.4)", () => {
  test("bulk, never replied to, older than 30 days derives archive", () => {
    const decision = decide(bulkInput(45));
    expect(decision).toEqual({
      action: "archive",
      source: "derived",
      policy_id: null,
      suppressed_by: null,
      reasons: ["sender sends bulk mail", "no reply has ever been sent to this sender", "45 days old, past the 30-day derived-archive age"],
    });
  });

  test("bulk, never replied to, newer than 30 days keeps the message to accrue evidence", () => {
    const decision = decide(bulkInput(10));
    expect(decision).toEqual({
      action: "keep_inbox",
      source: "derived",
      policy_id: null,
      suppressed_by: null,
      reasons: [
        "sender sends bulk mail",
        "no reply has ever been sent to this sender",
        "10 days old, within the 30-day window where evidence is still accruing",
      ],
    });
  });

  test("the 30-day boundary keeps at exactly 30 and archives at 31", () => {
    expect(outcome(decide(bulkInput(30)))).toEqual({ action: "keep_inbox", source: "derived", policy_id: null, suppressed_by: null });
    expect(outcome(decide(bulkInput(31)))).toEqual({ action: "archive", source: "derived", policy_id: null, suppressed_by: null });
  });

  test("an automated sender takes the same two rows as a bulk one", () => {
    const automated = { ...base_signals, is_bulk: false, is_automated: true, addressed_to_me: false };
    const old_decision = decide({ ...base_input, signals: { ...automated, age_days: 45 } });
    const new_decision = decide({ ...base_input, signals: { ...automated, age_days: 3 } });
    expect(outcome(old_decision)).toEqual({ action: "archive", source: "derived", policy_id: null, suppressed_by: null });
    expect(old_decision.reasons).toContain("sender is automated");
    expect(outcome(new_decision)).toEqual({ action: "keep_inbox", source: "derived", policy_id: null, suppressed_by: null });
  });

  test("a known sender never reaches the derived archive row, however old the message", () => {
    const decision = decide(
      bulkInput(900, { signals: { ...base_signals, is_bulk: true, addressed_to_me: false, sender_known: true, age_days: 900 } }),
    );
    expect(outcome(decision)).toEqual({ action: "keep_inbox", source: "fallback", policy_id: null, suppressed_by: null });
  });

  test("a scoped guard suppresses a derived archive and names itself", () => {
    const decision = decide(bulkInput(45, { replied_in_thread: true }));
    expect(outcome(decision)).toEqual({
      action: "keep_inbox",
      source: "derived",
      policy_id: null,
      suppressed_by: "replied_in_thread",
    });
  });

  test("a human message addressed to me with the ball in my court derives needs_action", () => {
    const decision = decide(base_input);
    expect(outcome(decision)).toEqual({ action: "needs_action", source: "derived", policy_id: null, suppressed_by: null });
  });

  test.each([
    ["the last message in the thread is mine", { last_in_thread_is_mine: true }],
    ["the sender is suppressed", { sender_suppressed: true }],
    ["the thread is dismissed", { thread_state: "dismissed" as ThreadStateValue }],
    ["the message only cc'd me", { signals: { ...base_signals, addressed_to_me: false, cc_me: true } }],
    ["the sender is a bulk list", { signals: { ...base_signals, is_bulk: true, sender_known: true } }],
  ])("needs_action does not fire when %s", (_label, override: Partial<DecisionInput>) => {
    expect(decide({ ...base_input, ...override }).action).not.toBe("needs_action");
  });
});

describe("step 6 — the fallback is the safety spine", () => {
  test("an unclassified message is left in place with source fallback", () => {
    const decision = decide({ ...base_input, signals: { ...base_signals, addressed_to_me: false } });
    expect(decision).toEqual({
      action: "keep_inbox",
      source: "fallback",
      policy_id: null,
      suppressed_by: null,
      reasons: ["no guard, thread state, policy or derived default applied, so the message is left in place"],
    });
  });

  test("a non-matching policy set still falls through to keep_inbox", () => {
    const decision = decide({
      ...base_input,
      signals: { ...base_signals, addressed_to_me: false },
      policies: [
        { ...address_trash, value: "stranger@elsewhere.test" },
        { ...domain_trash, value: "elsewhere.test" },
      ],
    });
    expect(outcome(decision)).toEqual({ action: "keep_inbox", source: "fallback", policy_id: null, suppressed_by: null });
  });
});

const DERIVED_ACTION_NAMES: string[] = [...DERIVED_ACTIONS];
const THREAD_STATES: ThreadStateValue[] = ["open", "snoozed", "done", "dismissed"];
const AGE_DAYS = [0, 1, 5, 30, 31, 400];
const DKIM_VALUES: (boolean | null)[] = [null, true, false];

function guardFlagCombinations(): Pick<GuardInput, "is_flagged" | "is_starred" | "has_attachment" | "replied_in_thread">[] {
  const combinations: Pick<GuardInput, "is_flagged" | "is_starred" | "has_attachment" | "replied_in_thread">[] = [];
  for (const is_flagged of [false, true]) {
    for (const is_starred of [false, true]) {
      for (const has_attachment of [false, true]) {
        for (const replied_in_thread of [false, true]) {
          combinations.push({ is_flagged, is_starred, has_attachment, replied_in_thread });
        }
      }
    }
  }
  return combinations;
}

function everyInputCombination(policies: readonly SenderPolicyInput[]): DecisionInput[] {
  const inputs: DecisionInput[] = [];
  for (const is_bulk of [false, true]) {
    for (const is_automated of [false, true]) {
      for (const sender_known of [false, true]) {
        for (const addressed_to_me of [false, true]) {
          for (const cc_me of [false, true]) {
            for (const last_in_thread_is_mine of [false, true]) {
              for (const sender_suppressed of [false, true]) {
                for (const thread_state of THREAD_STATES) {
                  for (const age_days of AGE_DAYS) {
                    for (const guard_flags of guardFlagCombinations()) {
                      inputs.push({
                        ...base_input,
                        ...guard_flags,
                        signals: { ...base_signals, is_bulk, is_automated, sender_known, addressed_to_me, cc_me, age_days },
                        thread_state,
                        last_in_thread_is_mine,
                        sender_suppressed,
                        policies,
                      });
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
  return inputs;
}

describe("invariants over every input combination", () => {
  test("no input can make a derived default emit auto_trash or purge", () => {
    const derived_actions = new Set<string>();
    for (const input of everyInputCombination([])) {
      const decision = decide(input);
      expect(decision.action).not.toBe("auto_trash");
      expect(decision.action).not.toBe("purge");
      if (decision.source === "derived") {
        expect(DERIVED_ACTION_NAMES).toContain(decision.action);
        derived_actions.add(decision.action);
      }
    }
    expect([...derived_actions].sort()).toEqual(["archive", "keep_inbox", "needs_action"]);
  });

  test("decide never emits purge, even with a policy present", () => {
    for (const input of everyInputCombination([address_trash, domain_trash])) {
      expect(decide(input).action).not.toBe("purge");
    }
  });

  test("a policy is the only route to auto_trash", () => {
    let policy_trash_count = 0;
    for (const input of everyInputCombination([address_trash, domain_trash])) {
      const decision = decide(input);
      if (decision.action !== "auto_trash") {
        continue;
      }
      policy_trash_count += 1;
      expect(decision.source).toBe("address_policy");
      expect(decision.policy_id).toBe("policy-address-trash");
    }
    expect(policy_trash_count).toBeGreaterThan(0);
  });

  test("every decision that names a guard also declines to act", () => {
    for (const input of everyInputCombination([address_archive, domain_trash])) {
      const decision = decide(input);
      if (decision.suppressed_by === null) {
        continue;
      }
      expect(decision.action).toBe("keep_inbox");
    }
  });
});

describe("dkim_aligned is a tri-state whose null means unknown", () => {
  test("the decision is identical for null, true and false, so null justifies nothing", () => {
    for (const input of everyInputCombination([address_trash, domain_trash])) {
      const decisions = DKIM_VALUES.map((dkim_aligned) => decide({ ...input, signals: { ...input.signals, dkim_aligned } }));
      expect(decisions[1]).toEqual(decisions[0]);
      expect(decisions[2]).toEqual(decisions[0]);
    }
  });

  test("an unknown dkim result on an old bulk message still only derives archive", () => {
    const decision = decide(
      bulkInput(400, { signals: { ...base_signals, is_bulk: true, addressed_to_me: false, dkim_aligned: null, age_days: 400 } }),
    );
    expect(outcome(decision)).toEqual({ action: "archive", source: "derived", policy_id: null, suppressed_by: null });
  });

  test("an unknown dkim result never produces a destructive decision without a policy", () => {
    for (const input of everyInputCombination([])) {
      const decision = decide({ ...input, signals: { ...input.signals, dkim_aligned: null } });
      expect(decision.action).not.toBe("auto_trash");
      expect(decision.action).not.toBe("purge");
    }
  });
});

describe("a policy can never name purge", () => {
  const purge_policy: SenderPolicyInput = {
    id: "policy-domain-purge",
    scope: "domain",
    value: "example.com",
    // @ts-expect-error purge is excluded from PolicyAction: §1.7 runs it as a separate sweep, never from classification.
    action: "purge",
    suspended_at: null,
  };

  test("a stored purge row is refused at runtime and stays visible as its own policy", () => {
    const decision = decide({ ...base_input, policies: [purge_policy] });
    expect(decision).toEqual({
      action: "keep_inbox",
      source: "domain_policy",
      policy_id: "policy-domain-purge",
      suppressed_by: null,
      reasons: ["domain policy for example.com names an action classification never applies"],
    });
  });

  test("no input combination lets a stored purge row reach the decision", () => {
    for (const input of everyInputCombination([purge_policy])) {
      expect(decide(input).action).not.toBe("purge");
    }
  });

  test("an unrecognised action is refused the same way", () => {
    const decision = decide({
      ...base_input,
      // @ts-expect-error only POLICY_ACTIONS values are valid; this models a hand-written database row.
      policies: [{ ...address_archive, action: "delete_everything" }],
    });
    expect(outcome(decision)).toEqual({
      action: "keep_inbox",
      source: "address_policy",
      policy_id: "policy-address-archive",
      suppressed_by: null,
    });
  });
});
