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

const bulk_result: UnsubscribeBulkResult = {
  senders: [
    {
      from_address: address,
      attempt: { method: "http", status: "sent", response_code: 200, error: null, attempted_at: now },
      policy: "created",
      errors: [],
      archived: 12,
      failed: 0,
      waiting: 3,
      refused: 0,
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
  test("expired renders a plain page at 200, bad tokens 400, no secret is invalid", async () => {
    const expired = await applyDigestLink({ token: token("file", "2026-09-01T00:00:00.000Z"), now }, dependencies({}));
    expect(expired).toEqual({ kind: "expired" });
    expect(digestLinkStatus(expired)).toBe(200);
    expect(renderDigestLinkPage(expired)).toContain("This link has expired");
    expect(renderDigestLinkPage(expired)).toContain("flext.dev/admin/unsubscribe");

    const invalid = await applyDigestLink({ token: "nope", now }, dependencies({}));
    expect(invalid).toEqual({ kind: "invalid" });
    expect(digestLinkStatus(invalid)).toBe(400);

    expect(await applyDigestLink({ token: token("file"), now }, dependencies({ secret: undefined }))).toEqual({ kind: "invalid" });
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

    expect(result).toEqual({ kind: "rule_exists", address, rule: { action: "file", autonomy: "auto" } });
    expect(upserts).toHaveLength(0);
    expect(renderDigestLinkPage(result)).toContain("already has a rule");
    expect(renderDigestLinkPage(result)).toContain("switched on");
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
    ].map(renderDigestLinkPage);

    for (const page of pages) {
      expect(page).not.toContain("—");
    }
  });
});
