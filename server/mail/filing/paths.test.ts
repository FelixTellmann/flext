import { describe, expect, test } from "bun:test";
import {
  FILING_QUEUE_REASONS,
  FOLDER_SEGMENT_RULE,
  filingDecisionFor,
  filingQueueReason,
  LOGICAL_SEPARATOR,
  logicalPathFor,
} from "@server/mail/filing/paths";

describe("logicalPathFor", () => {
  test("a client rule files to the client, one segment", () => {
    expect(logicalPathFor({ client: "KidsLiving", topic: null })).toBe("KidsLiving");
  });

  test("a topic rule files to the topic, one segment", () => {
    expect(logicalPathFor({ client: null, topic: "Finances" })).toBe("Finances");
  });

  test("a rule carrying both files to the client", () => {
    expect(logicalPathFor({ client: "Listify", topic: "Invoices" })).toBe("Listify");
  });

  test("returns null when neither axis is set", () => {
    expect(logicalPathFor({ client: null, topic: null })).toBeNull();
  });

  // Rows stored before the flat-folders decision may still carry a separator; they render the same name
  // tmp/flatten-filing-policies.ts rewrites them to, never a nested path.
  test("a pre-flattening value renders its last segment, and never a separator", () => {
    expect(logicalPathFor({ client: null, topic: "Personal/Travel" })).toBe("Travel");
    expect(logicalPathFor({ client: null, topic: "Ops//Shopify " })).toBe("Shopify");
    expect(logicalPathFor({ client: "Clients/Acme", topic: "Personal/Travel" })).toBe("Acme");
    for (const mapping of [
      { client: "A/B/C", topic: null },
      { client: null, topic: "A/B/C" },
      { client: "A/B", topic: "C/D" },
    ]) {
      expect(logicalPathFor(mapping)).not.toContain(LOGICAL_SEPARATOR);
    }
  });

  test("normalizes empty and whitespace values away", () => {
    expect(logicalPathFor({ client: "  ", topic: null })).toBeNull();
    expect(logicalPathFor({ client: null, topic: "///" })).toBeNull();
    expect(logicalPathFor({ client: "  ", topic: "Finances" })).toBe("Finances");
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
      logical_path: "Acme",
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

describe("FOLDER_SEGMENT_RULE", () => {
  // The rule is shared by two Zod schemas that both validate client AND topic on the live path. Pinning
  // it here is what stops the separator acquiring a third spelling as a literal inside one of them.
  test("rejects a client or topic carrying the logical separator", () => {
    expect(FOLDER_SEGMENT_RULE.test("Clients/Listify")).toBe(false);
    expect(FOLDER_SEGMENT_RULE.test("Personal/Travel")).toBe(false);
    expect(FOLDER_SEGMENT_RULE.test("Listify")).toBe(true);
  });

  test("names the separator it rejects, so the message cannot drift from the rule", () => {
    expect(FOLDER_SEGMENT_RULE.message).toContain(LOGICAL_SEPARATOR);
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
