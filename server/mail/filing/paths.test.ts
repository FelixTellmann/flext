import { describe, expect, test } from "bun:test";
import {
  CLIENT_SEGMENT_RULE,
  FILING_QUEUE_REASONS,
  filingDecisionFor,
  filingQueueReason,
  LOGICAL_SEPARATOR,
  logicalPathFor,
} from "@server/mail/filing/paths";

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
      const decision = filingDecisionFor({ logical_path: "Finances", policy_scope: "address", dkim_aligned, filing_confirmed_at: null });
      expect(decision).toEqual({ outcome: "file", logical_path: "Finances" });
    }
  });

  test("files a domain-scoped policy only when DKIM is aligned", () => {
    const aligned = filingDecisionFor({ logical_path: "Finances", policy_scope: "domain", dkim_aligned: true, filing_confirmed_at: null });
    expect(aligned.outcome).toBe("file");
  });

  test("queues a domain-scoped policy when DKIM fails or is absent", () => {
    for (const dkim_aligned of [false, null]) {
      const decision = filingDecisionFor({ logical_path: "Finances", policy_scope: "domain", dkim_aligned, filing_confirmed_at: null });
      expect(decision.outcome).toBe("queue");
      expect(decision).toMatchObject({ reason: "dkim_unaligned" });
    }
  });

  test("queues a policy with no mapping before it looks at DKIM at all", () => {
    const decision = filingDecisionFor({ logical_path: null, policy_scope: "domain", dkim_aligned: true, filing_confirmed_at: null });
    expect(decision).toMatchObject({ outcome: "queue", reason: "no_mapping" });
  });

  // Fails CLOSED. Only an explicit `address` scope un-gates, so a decision whose provenance is unknown is
  // treated as the stricter case rather than the looser one.
  test("queues a decision with no policy behind it rather than filing it ungated", () => {
    const decision = filingDecisionFor({ logical_path: "Finances", policy_scope: null, dkim_aligned: null, filing_confirmed_at: null });
    expect(decision).toMatchObject({ outcome: "queue", reason: "dkim_unaligned" });
  });

  // The live path to a null scope, named here so the reason is recorded where someone will read it:
  // deletePolicy hard-deletes and Action.senderPolicyId has an index but no foreign key, so the executor's
  // LEFT join hands this shape over for any `file` row whose policy was deleted after it was proposed.
  test("a deleted domain-scoped policy cannot file an unaligned message by losing its scope", () => {
    const decision = filingDecisionFor({
      logical_path: "Clients/Acme",
      policy_scope: null,
      dkim_aligned: false,
      filing_confirmed_at: null,
    });
    expect(decision.outcome).toBe("queue");
    expect(decision).toMatchObject({ reason: "dkim_unaligned" });
    if (decision.outcome !== "queue") {
      throw new Error("a queued decision carries the detail the operator reads");
    }
    expect(decision.detail).toContain("no longer exists");
  });

  // A null scope is gated on DKIM, not blocked outright: an aligned message still files.
  test("still files a scope-less decision when the message is DKIM-aligned", () => {
    const decision = filingDecisionFor({ logical_path: "Finances", policy_scope: null, dkim_aligned: true, filing_confirmed_at: null });
    expect(decision).toEqual({ outcome: "file", logical_path: "Finances" });
  });

  // Without this the gate re-fires on every shape resolveFilingActions produces — it rewrites neither the
  // policy scope nor the message's DKIM state — so a dkim_unaligned row would resolve, re-queue, resolve,
  // re-queue forever while the operator was shown a green "resolved" banner each time.
  test("an operator-confirmed destination files despite the DKIM gate", () => {
    const confirmed_at = new Date("2026-08-20T10:00:00.000Z");
    for (const policy_scope of ["domain", null] as const) {
      for (const dkim_aligned of [false, null]) {
        const decision = filingDecisionFor({ logical_path: "Finances", policy_scope, dkim_aligned, filing_confirmed_at: confirmed_at });
        expect(decision).toEqual({ outcome: "file", logical_path: "Finances" });
      }
    }
  });

  // Confirmation supersedes the DKIM proxy and nothing else. A human can vouch for a destination; they
  // cannot conjure one, so a row with no path still has nowhere to go.
  test("a confirmation cannot substitute for a missing path", () => {
    const decision = filingDecisionFor({
      logical_path: null,
      policy_scope: "domain",
      dkim_aligned: null,
      filing_confirmed_at: new Date("2026-08-20T10:00:00.000Z"),
    });
    expect(decision).toMatchObject({ outcome: "queue", reason: "no_mapping" });
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

describe("filingQueueReason", () => {
  // The single spelling of what lands in Action.error, so the executor and undo cannot drift from the
  // reasons Task 9's queue UI renders.
  test("prefixes the detail with a reason drawn from FILING_QUEUE_REASONS", () => {
    expect(filingQueueReason("unresolvable_folder", "CREATE was rejected")).toBe("unresolvable_folder: CREATE was rejected");
    expect(FILING_QUEUE_REASONS).toContain("unresolvable_folder");
  });
});
