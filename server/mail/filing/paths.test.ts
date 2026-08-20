import { describe, expect, test } from "bun:test";
import { filingDecisionFor, logicalPathFor } from "@server/mail/filing/paths";

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
});
