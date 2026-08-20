import { describe, expect, test } from "bun:test";
import { CLIENT_SEGMENT_RULE, filingDecisionFor, LOGICAL_SEPARATOR, logicalPathFor } from "@server/mail/filing/paths";

describe("logicalPathFor", () => {
  test("composes client and topic under the Clients root", () => {
    expect(logicalPathFor({ client: "Listify", topic: "Invoices" })).toBe("Clients/Listify/Invoices");
  });

  test("uses the client alone when there is no topic", () => {
    expect(logicalPathFor({ client: "KidsLiving", topic: null })).toBe("Clients/KidsLiving");
  });

  test("passes a client-less topic through verbatim, hierarchy included", () => {
    expect(logicalPathFor({ client: null, topic: "Ops/Shopify" })).toBe("Ops/Shopify");
    expect(logicalPathFor({ client: null, topic: "Finances" })).toBe("Finances");
  });

  test("returns null when neither axis is set", () => {
    expect(logicalPathFor({ client: null, topic: null })).toBeNull();
  });

  test("normalizes empty and whitespace segments away", () => {
    expect(logicalPathFor({ client: null, topic: "Ops//Shopify " })).toBe("Ops/Shopify");
    expect(logicalPathFor({ client: "  ", topic: null })).toBeNull();
    expect(logicalPathFor({ client: null, topic: "///" })).toBeNull();
  });
});

describe("filingDecisionFor", () => {
  test("files an address-scoped policy regardless of DKIM state", () => {
    for (const dkim_aligned of [true, false, null]) {
      const decision = filingDecisionFor({ logical_path: "Finances", policy_scope: "address", dkim_aligned });
      expect(decision).toEqual({ outcome: "file", logical_path: "Finances" });
    }
  });

  test("files a domain-scoped policy only when DKIM is aligned", () => {
    const aligned = filingDecisionFor({ logical_path: "Finances", policy_scope: "domain", dkim_aligned: true });
    expect(aligned.outcome).toBe("file");
  });

  test("queues a domain-scoped policy when DKIM fails or is absent", () => {
    for (const dkim_aligned of [false, null]) {
      const decision = filingDecisionFor({ logical_path: "Finances", policy_scope: "domain", dkim_aligned });
      expect(decision.outcome).toBe("queue");
      expect(decision).toMatchObject({ reason: "dkim_unaligned" });
    }
  });

  test("queues a policy with no mapping before it looks at DKIM at all", () => {
    const decision = filingDecisionFor({ logical_path: null, policy_scope: "domain", dkim_aligned: true });
    expect(decision).toMatchObject({ outcome: "queue", reason: "no_mapping" });
  });

  // The branch the module argues cannot occur — rules.ts step 5 can only derive archive, keep_inbox or
  // needs_action, so no derived decision is ever `file`. Pinned anyway: the argument lives in a comment,
  // and a later caller reaching this branch some other way would otherwise change behaviour silently.
  test("leaves a decision with no policy behind it ungated rather than queued", () => {
    const decision = filingDecisionFor({ logical_path: "Finances", policy_scope: null, dkim_aligned: null });
    expect(decision).toEqual({ outcome: "file", logical_path: "Finances" });
  });
});

describe("CLIENT_SEGMENT_RULE", () => {
  // The rule is shared by two Zod schemas that both validate on the live path. Pinning it here is what
  // stops the separator acquiring a third spelling as a literal inside one of them.
  test("rejects a client name carrying the logical separator", () => {
    expect(CLIENT_SEGMENT_RULE.test("Clients/Listify")).toBe(false);
    expect(CLIENT_SEGMENT_RULE.test("Listify")).toBe(true);
  });

  test("names the separator it rejects, so the message cannot drift from the rule", () => {
    expect(CLIENT_SEGMENT_RULE.message).toContain(LOGICAL_SEPARATOR);
  });
});
