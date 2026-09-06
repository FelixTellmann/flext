import { describe, expect, test } from "bun:test";
import type { DigestLinkDependencies } from "@server/mail/digest/link-action";
import { applyDigestLink, DIGEST_POLICY_SOURCE, digestLinkStatus, renderDigestLinkPage } from "@server/mail/digest/link-action";
import { signDigestLink } from "@server/mail/digest/links";
import type { PolicyIndex, PolicyRow, UpsertPolicyInput } from "@server/mail/query/policies";
import type { UnsubscribeBulkResult } from "@server/mail/unsubscribe/bulk";

const SECRET = "0123456789abcdef0123456789abcdef";
const now = new Date("2026-09-07T05:00:00.000Z");
const expires_at = "2026-09-21T05:00:00.000Z";
const address = "news@sender.example";

const policy = (overrides: Partial<PolicyRow>): PolicyRow => ({
  id: "p1",
  scope: "address",
  value: address,
  action: "archive",
  client: null,
  topic: null,
  mark_read: true,
  autonomy: "auto",
  autonomy_promoted_at: now,
  source: "unsubscribe",
  suspended_at: null,
  suspension_reason: null,
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

// Spread rather than written inline: outcome.ts's SenderArchiveSummary is gaining a counter in a parallel
// edit, and a spread is exempt from the excess-property check that a literal would fail on either side.
const archive_counts = { archived: 12, failed: 0, waiting: 3, refused: 0, retried: 0 };

const bulk_result: UnsubscribeBulkResult = {
  senders: [
    {
      ...archive_counts,
      from_address: address,
      attempt: { method: "http", status: "sent", response_code: 200, error: null, attempted_at: now },
      policy: "created",
      errors: [],
    },
  ],
  mailbox_errors: [],
  more_waiting: true,
};

function dependencies(
  overrides: Partial<DigestLinkDependencies> & { upserts?: UpsertPolicyInput[]; unsubscribed?: string[] },
): DigestLinkDependencies {
  const index: PolicyIndex = { by_address: new Map(), by_domain: new Map(), never_touch: [], suppressed: new Set() };
  return {
    secret: SECRET,
    loadPolicyIndex: async () => index,
    upsertPolicy: async (input) => {
      overrides.upserts?.push(input);
      return policy({ ...input, autonomy: "shadow", client: null, topic: null, mark_read: input.mark_read ?? false });
    },
    unsubscribe: async (from_address) => {
      overrides.unsubscribed?.push(from_address);
      return bulk_result;
    },
    wait_ms: 50,
    ...overrides,
  };
}

const token = (action: "file" | "unsubscribe", expiry = expires_at) => signDigestLink({ action, address, expires_at: expiry }, SECRET);

describe("applyDigestLink", () => {
  test("expired renders a plain page at 200, bad tokens 400, no secret is 503 misconfigured", async () => {
    const expired = await applyDigestLink({ token: token("file", "2026-09-01T00:00:00.000Z"), now }, dependencies({}));
    expect(expired).toEqual({ kind: "expired" });
    expect(digestLinkStatus(expired)).toBe(200);
    expect(renderDigestLinkPage(expired)).toContain("This link has expired");
    expect(renderDigestLinkPage(expired)).toContain("flext.dev/admin/unsubscribe");

    const invalid = await applyDigestLink({ token: "nope", now }, dependencies({}));
    expect(invalid).toEqual({ kind: "invalid" });
    expect(digestLinkStatus(invalid)).toBe(400);

    const misconfigured = await applyDigestLink({ token: token("file"), now }, dependencies({ secret: undefined }));
    expect(misconfigured).toEqual({ kind: "misconfigured" });
    expect(digestLinkStatus(misconfigured)).toBe(503);
    expect(renderDigestLinkPage(misconfigured)).toContain("SCRIPT_SECRET is missing");
    expect(renderDigestLinkPage(misconfigured)).not.toContain("not valid");
  });

  test("file creates a watch-only archive rule, marked read, with the digest source", async () => {
    const upserts: UpsertPolicyInput[] = [];
    const unsubscribed: string[] = [];
    const result = await applyDigestLink({ token: token("file"), now }, dependencies({ upserts, unsubscribed }));

    expect(result).toEqual({ kind: "filed", address });
    expect(upserts).toEqual([{ scope: "address", value: address, action: "archive", mark_read: true, source: DIGEST_POLICY_SOURCE }]);
    expect(unsubscribed).toHaveLength(0);
    expect(renderDigestLinkPage(result)).toContain(`Rule created for ${address}, watch-only`);
    expect(renderDigestLinkPage(result)).toContain("flext.dev/admin/senders");
  });

  test("file never writes over an existing rule, whatever its action or autonomy", async () => {
    const upserts: UpsertPolicyInput[] = [];
    const by_address = new Map([[address, policy({ action: "file", autonomy: "auto" })]]);
    const result = await applyDigestLink(
      { token: token("file"), now },
      dependencies({
        upserts,
        loadPolicyIndex: async () => ({ by_address, by_domain: new Map(), never_touch: [], suppressed: new Set() }),
      }),
    );

    expect(result).toEqual({
      kind: "rule_exists",
      address,
      rule: { scope: "address", value: address, action: "file", autonomy: "auto", suspended: false },
    });
    expect(upserts).toHaveLength(0);
    expect(renderDigestLinkPage(result)).toContain("already has a rule");
    expect(renderDigestLinkPage(result)).toContain("It is a file rule, switched on.");
    expect(renderDigestLinkPage(result)).not.toContain("but suspended");
  });

  test("an existing rule's page says suspended when it is, watch-only when it is shadow, with the right article", async () => {
    const cases: Array<{ rule: PolicyRow; phrase: string }> = [
      {
        rule: policy({ action: "archive", autonomy: "auto", suspended_at: now }),
        phrase: "It is an archive rule, switched on but suspended.",
      },
      { rule: policy({ action: "archive", autonomy: "shadow" }), phrase: "It is an archive rule, watch-only." },
      { rule: policy({ action: "file", autonomy: "shadow", suspended_at: now }), phrase: "It is a file rule, watch-only." },
    ];
    for (const { rule, phrase } of cases) {
      const upserts: UpsertPolicyInput[] = [];
      const result = await applyDigestLink(
        { token: token("file"), now },
        dependencies({
          upserts,
          loadPolicyIndex: async () => ({
            by_address: new Map([[address, rule]]),
            by_domain: new Map(),
            never_touch: [],
            suppressed: new Set(),
          }),
        }),
      );

      expect(result.kind).toBe("rule_exists");
      expect(upserts).toHaveLength(0);
      expect(renderDigestLinkPage(result)).toContain(phrase);
    }
  });

  test("file refuses under a live domain rule, which the address rule would outrank", async () => {
    const upserts: UpsertPolicyInput[] = [];
    const by_domain = new Map([["sender.example", policy({ scope: "domain", value: "sender.example", autonomy: "auto" })]]);
    const result = await applyDigestLink(
      { token: token("file"), now },
      dependencies({
        upserts,
        loadPolicyIndex: async () => ({ by_address: new Map(), by_domain, never_touch: [], suppressed: new Set() }),
      }),
    );

    expect(result).toEqual({
      kind: "rule_exists",
      address,
      rule: { scope: "domain", value: "sender.example", action: "archive", autonomy: "auto", suspended: false },
    });
    expect(upserts).toHaveLength(0);
    expect(renderDigestLinkPage(result)).toContain(`sender.example already has a rule that covers ${address}`);
    expect(renderDigestLinkPage(result)).toContain("It is an archive rule, switched on.");
  });

  test("file goes ahead under a watch-only or suspended domain rule", async () => {
    for (const domain_rule of [
      policy({ scope: "domain", value: "sender.example", autonomy: "shadow" }),
      policy({ scope: "domain", value: "sender.example", autonomy: "auto", suspended_at: now }),
    ]) {
      const upserts: UpsertPolicyInput[] = [];
      const by_domain = new Map([["sender.example", domain_rule]]);
      const result = await applyDigestLink(
        { token: token("file"), now },
        dependencies({
          upserts,
          loadPolicyIndex: async () => ({ by_address: new Map(), by_domain, never_touch: [], suppressed: new Set() }),
        }),
      );

      expect(result).toEqual({ kind: "filed", address });
      expect(upserts).toHaveLength(1);
    }
  });

  test("unsubscribe runs the bulk button for the one address and reports the archive count", async () => {
    const unsubscribed: string[] = [];
    const result = await applyDigestLink({ token: token("unsubscribe"), now }, dependencies({ unsubscribed }));

    expect(unsubscribed).toEqual([address]);
    expect(result.kind).toBe("unsubscribed");
    const page = renderDigestLinkPage(result);
    expect(page).toContain(`Unsubscribed from ${address}`);
    expect(page).toContain("Request sent, archived 12 emails, 3 more on the next tick.");
  });

  test("unsubscribe that outlives the wait answers still running and keeps working", async () => {
    let finished = false;
    const result = await applyDigestLink(
      { token: token("unsubscribe"), now },
      dependencies({
        wait_ms: 5,
        unsubscribe: async () => {
          await new Promise((resolve) => setTimeout(resolve, 30));
          finished = true;
          return bulk_result;
        },
      }),
    );

    expect(result).toEqual({ kind: "unsubscribing", address });
    expect(finished).toBe(false);
    expect(renderDigestLinkPage(result)).toContain("Still running");
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(finished).toBe(true);
  });

  test("a throwing step is a failed page at 500 with the message", async () => {
    const result = await applyDigestLink(
      { token: token("unsubscribe"), now },
      dependencies({
        unsubscribe: async () => {
          throw new Error("imap: connection refused");
        },
      }),
    );

    expect(result).toEqual({ kind: "failed", address, error: "imap: connection refused" });
    expect(digestLinkStatus(result)).toBe(500);
    expect(renderDigestLinkPage(result)).toContain("imap: connection refused");
  });

  test("no em dash on any page", async () => {
    const pages = [
      await applyDigestLink({ token: token("file"), now }, dependencies({})),
      await applyDigestLink({ token: token("unsubscribe"), now }, dependencies({})),
      await applyDigestLink({ token: "x", now }, dependencies({})),
      await applyDigestLink({ token: token("file"), now }, dependencies({ secret: undefined })),
      await applyDigestLink(
        { token: token("file"), now },
        dependencies({
          loadPolicyIndex: async () => ({
            by_address: new Map([[address, policy({ suspended_at: now })]]),
            by_domain: new Map(),
            never_touch: [],
            suppressed: new Set(),
          }),
        }),
      ),
    ].map(renderDigestLinkPage);

    for (const page of pages) {
      expect(page).not.toContain("—");
    }
  });
});
