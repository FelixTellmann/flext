import { describe, expect, test } from "bun:test";
import type { ActionClass, GuardInput, GuardVerdict } from "@server/mail/classify/guards";
import { evaluateGuards, evaluateSenderGuards, isBlocked } from "@server/mail/classify/guards";
import type { MessageSignals } from "@server/mail/classify/signals";
import { deriveSignals } from "@server/mail/classify/signals";

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

const base_input: GuardInput = {
  signals: base_signals,
  from_address: "person@example.com",
  from_domain: "example.com",
  subject: "Project update",
  is_flagged: false,
  is_starred: false,
  has_attachment: false,
  replied_in_thread: false,
  never_touch_rules: [],
};

const ALL_ACTIONS: ActionClass[] = ["keep_inbox", "archive", "file", "auto_trash", "purge"];

describe("flagged", () => {
  test("fires when flagged", () => {
    const verdicts = evaluateGuards({ ...base_input, is_flagged: true });
    expect(verdicts).toContainEqual({ name: "flagged", blocks: ALL_ACTIONS, absolute: true });
  });

  test("fires when starred", () => {
    const verdicts = evaluateGuards({ ...base_input, is_starred: true });
    expect(verdicts.map((verdict) => verdict.name)).toContain("flagged");
  });

  test("does not fire when neither flagged nor starred", () => {
    const verdicts = evaluateGuards(base_input);
    expect(verdicts.map((verdict) => verdict.name)).not.toContain("flagged");
  });
});

describe("too_recent", () => {
  test("fires just under the 24-hour boundary", () => {
    const signals = deriveSignals({
      list_id: null,
      list_unsubscribe: null,
      precedence: null,
      auto_submitted: null,
      from_address: "person@example.com",
      to_me: true,
      cc_me: false,
      dkim_aligned: true,
      internal_date: new Date("2026-08-18T00:00:01Z"),
      sender_message_count: 1,
      my_reply_count: 0,
      now: new Date("2026-08-19T00:00:00Z"),
    });
    const verdicts = evaluateGuards({ ...base_input, signals });
    expect(verdicts.map((verdict) => verdict.name)).toContain("too_recent");
  });

  test("does not fire at exactly the 24-hour boundary", () => {
    const signals = deriveSignals({
      list_id: null,
      list_unsubscribe: null,
      precedence: null,
      auto_submitted: null,
      from_address: "person@example.com",
      to_me: true,
      cc_me: false,
      dkim_aligned: true,
      internal_date: new Date("2026-08-18T00:00:00Z"),
      sender_message_count: 1,
      my_reply_count: 0,
      now: new Date("2026-08-19T00:00:00Z"),
    });
    const verdicts = evaluateGuards({ ...base_input, signals });
    expect(verdicts.map((verdict) => verdict.name)).not.toContain("too_recent");
  });
});

describe("never_touch", () => {
  test("matches by address", () => {
    const verdicts = evaluateGuards({
      ...base_input,
      never_touch_rules: [{ kind: "address", value: "person@example.com" }],
    });
    expect(verdicts.map((verdict) => verdict.name)).toContain("never_touch");
  });

  test("matches by domain", () => {
    const verdicts = evaluateGuards({
      ...base_input,
      never_touch_rules: [{ kind: "domain", value: "example.com" }],
    });
    expect(verdicts.map((verdict) => verdict.name)).toContain("never_touch");
  });

  test("a domain rule protects a subdomain", () => {
    const verdicts = evaluateGuards({
      ...base_input,
      from_domain: "mail.example.com",
      never_touch_rules: [{ kind: "domain", value: "example.com" }],
    });
    expect(verdicts.map((verdict) => verdict.name)).toContain("never_touch");
  });

  test("a domain rule does not protect a merely similar domain", () => {
    const verdicts = evaluateGuards({
      ...base_input,
      from_domain: "notexample.com",
      never_touch_rules: [{ kind: "domain", value: "example.com" }],
    });
    expect(verdicts.map((verdict) => verdict.name)).not.toContain("never_touch");
  });

  test("matches by subject pattern", () => {
    const verdicts = evaluateGuards({
      ...base_input,
      subject: "Re: urgent legal notice",
      never_touch_rules: [{ kind: "subject_pattern", value: "legal notice" }],
    });
    expect(verdicts.map((verdict) => verdict.name)).toContain("never_touch");
  });

  test("does not fire when no rule matches", () => {
    const verdicts = evaluateGuards({
      ...base_input,
      never_touch_rules: [{ kind: "address", value: "someone-else@example.com" }],
    });
    expect(verdicts.map((verdict) => verdict.name)).not.toContain("never_touch");
  });
});

describe("replied_in_thread", () => {
  test("fires and blocks archive, auto_trash and purge but not file", () => {
    const verdicts = evaluateGuards({ ...base_input, replied_in_thread: true });
    const verdict = verdicts.find((entry) => entry.name === "replied_in_thread");
    expect(verdict).toEqual({ name: "replied_in_thread", blocks: ["archive", "auto_trash", "purge"], absolute: false });
  });

  test("does not fire when we have not replied", () => {
    const verdicts = evaluateGuards(base_input);
    expect(verdicts.map((verdict) => verdict.name)).not.toContain("replied_in_thread");
  });
});

describe("derived_allowlist", () => {
  test("fires when the sender is known and blocks only auto_trash and purge", () => {
    const verdicts = evaluateGuards({ ...base_input, signals: { ...base_signals, sender_known: true } });
    const verdict = verdicts.find((entry) => entry.name === "derived_allowlist");
    expect(verdict).toEqual({ name: "derived_allowlist", blocks: ["auto_trash", "purge"], absolute: false });
  });

  test("does not fire when the sender is unknown", () => {
    const verdicts = evaluateGuards(base_input);
    expect(verdicts.map((verdict) => verdict.name)).not.toContain("derived_allowlist");
  });
});

describe("human_attachment", () => {
  test("fires for an attachment from a human sender", () => {
    const verdicts = evaluateGuards({ ...base_input, has_attachment: true });
    const verdict = verdicts.find((entry) => entry.name === "human_attachment");
    expect(verdict).toEqual({ name: "human_attachment", blocks: ["auto_trash", "purge"], absolute: false });
  });

  test("does not fire for an attachment from a bulk sender", () => {
    const verdicts = evaluateGuards({ ...base_input, has_attachment: true, signals: { ...base_signals, is_bulk: true } });
    expect(verdicts.map((verdict) => verdict.name)).not.toContain("human_attachment");
  });

  test("does not fire for an attachment from an automated sender", () => {
    const verdicts = evaluateGuards({ ...base_input, has_attachment: true, signals: { ...base_signals, is_automated: true } });
    expect(verdicts.map((verdict) => verdict.name)).not.toContain("human_attachment");
  });

  test("does not fire without an attachment", () => {
    const verdicts = evaluateGuards(base_input);
    expect(verdicts.map((verdict) => verdict.name)).not.toContain("human_attachment");
  });
});

describe("isBlocked", () => {
  test("a file decision survives replied_in_thread", () => {
    const verdicts = evaluateGuards({ ...base_input, replied_in_thread: true });
    expect(isBlocked(verdicts, "file", false)).toBeNull();
  });

  test("an auto_trash decision is blocked by replied_in_thread", () => {
    const verdicts = evaluateGuards({ ...base_input, replied_in_thread: true });
    expect(isBlocked(verdicts, "auto_trash", false)).toBe("replied_in_thread");
  });

  test("an explicit address-level policy overrides a scoped guard", () => {
    const verdicts = evaluateGuards({ ...base_input, replied_in_thread: true });
    expect(isBlocked(verdicts, "auto_trash", true)).toBeNull();
  });

  test("the same explicit address-level policy is still blocked by an absolute guard", () => {
    const verdicts = evaluateGuards({ ...base_input, replied_in_thread: true, is_flagged: true });
    expect(isBlocked(verdicts, "auto_trash", true)).toBe("flagged");
  });

  test("a domain-level policy does not get the address-level override", () => {
    const verdicts = evaluateGuards({ ...base_input, replied_in_thread: true });
    expect(isBlocked(verdicts, "auto_trash", false)).toBe("replied_in_thread");
  });

  test("returns null when no guard fired", () => {
    const verdicts = evaluateGuards(base_input);
    expect(isBlocked(verdicts, "purge", false)).toBeNull();
  });

  test("an absolute guard blocks regardless of address-level policy", () => {
    const verdicts: GuardVerdict[] = [{ name: "too_recent", blocks: ALL_ACTIONS, absolute: true }];
    expect(isBlocked(verdicts, "keep_inbox", true)).toBe("too_recent");
  });
});

// The Sender Policy surface (src/routes/admin/senders.tsx) has only these two guards' inputs, and it must
// reach the same verdict isBlocked gives the engine — it rendered "suppressed by guard: derived_allowlist"
// over an address-scoped auto_trash policy the engine would have executed until 2026-08-19.
describe("evaluateSenderGuards", () => {
  const sender_input = {
    from_address: "person@example.com",
    from_domain: "example.com",
    subject: null,
    sender_known: true,
    never_touch_rules: [],
  };

  test("derived_allowlist suppresses a domain-scoped auto_trash policy", () => {
    expect(isBlocked(evaluateSenderGuards(sender_input), "auto_trash", false)).toBe("derived_allowlist");
  });

  test("derived_allowlist does not suppress an address-scoped auto_trash policy", () => {
    expect(isBlocked(evaluateSenderGuards(sender_input), "auto_trash", true)).toBeNull();
  });

  test("never_touch suppresses an address-scoped policy, because it is absolute", () => {
    const verdicts = evaluateSenderGuards({ ...sender_input, never_touch_rules: [{ kind: "address", value: "person@example.com" }] });
    expect(isBlocked(verdicts, "auto_trash", true)).toBe("never_touch");
  });

  test("a subject_pattern rule cannot fire without a subject", () => {
    const verdicts = evaluateSenderGuards({ ...sender_input, never_touch_rules: [{ kind: "subject_pattern", value: "legal notice" }] });
    expect(verdicts.map((verdict) => verdict.name)).not.toContain("never_touch");
  });

  test("the same two guards are what evaluateGuards derives from a full message", () => {
    const verdicts = evaluateGuards({ ...base_input, signals: { ...base_signals, sender_known: true } });
    expect(verdicts.map((verdict) => verdict.name)).toEqual(["derived_allowlist"]);
  });
});
