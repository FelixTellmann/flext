import { describe, expect, test } from "bun:test";
import { policyEditColumns, upsert_policy_schema, upsertPolicy } from "@server/mail/query/policies";

// §8, §4.3: upsertPolicy has rejected autonomy "auto" at its Zod boundary since Phase 3, and Task 8 does
// NOT weaken that — promotion is a dedicated procedure (autonomy.ts's promotePolicyAutonomy), never a
// field on this general-purpose write. upsert_policy_schema.parse() throws synchronously, before any
// query, so this needs no database connection to prove.
describe("upsertPolicy (§8 boundary, unweakened by Task 8)", () => {
  test('rejects autonomy: "auto" — every policy is still born in shadow, and only promotePolicyAutonomy may change that', async () => {
    await expect(
      upsertPolicy({
        scope: "address",
        value: "someone@example.com",
        action: "archive",
        source: "test",
        autonomy: "auto",
      }),
    ).rejects.toThrow();
  });
});

// §4.2 of the Phase 6 design: a promotion is trust in the rule as its shadow record showed it, so editing
// the rule invalidates that record and the promotion it justified. This is deliberate, the same reasoning
// that makes a rescue suspend a policy rather than merely log it — NOT a bug to fix by threading the
// row's current autonomy through as a default. Proven at the schema upsertPolicy actually parses against
// (rather than through a real insert/select, which every DATABASE_URL variant would send to production):
// an edit that does not explicitly re-assert "auto" always parses to "shadow", which is exactly the value
// upsertPolicy's onDuplicateKeyUpdate then writes over whatever the row held before — including "auto".
describe("editing a policy demotes it (§4.2 — deliberate, not a default's side effect)", () => {
  test('an edit that omits autonomy always resolves to "shadow", even for a policy that was already promoted', () => {
    const parsed = upsert_policy_schema.parse({
      scope: "address",
      value: "someone@example.com",
      action: "archive",
      source: "test",
      // No `autonomy` field — exactly what a label/client/topic edit submits today. The schema's default
      // is what demotes the row; there is no path here that reads or preserves an existing "auto" value.
    });

    expect(parsed.autonomy).toBe("shadow");
  });
});

// §3.4, plainly: an edit "does not un-suspend anything, ever". upsertPolicy's onDuplicateKeyUpdate used
// to carry suspended_at and suspension_reason, both of which default to null on the schema and are
// omitted by both UI callers — including the sender screen's BULK action button. So assigning a policy
// wrote null over a live rescue suspension and destroyed the reason text, silently re-arming the rule the
// rescue had just stopped. The columns an edit may write are pinned here rather than inside the query
// builder because that is where the loss happened: a SET clause is easy to extend and impossible to see.
describe("editing a policy never clears a rescue suspension (§3.4)", () => {
  const parsed = upsert_policy_schema.parse({
    scope: "address",
    value: "someone@example.com",
    action: "archive",
    source: "test",
  });

  test("the edit's SET clause carries neither suspended_at nor suspension_reason", () => {
    const columns = Object.keys(policyEditColumns(parsed, new Date()));

    expect(columns).not.toContain("suspended_at");
    expect(columns).not.toContain("suspension_reason");
  });

  test("it still writes everything an edit is meant to change", () => {
    expect(Object.keys(policyEditColumns(parsed, new Date())).sort()).toEqual([
      "action",
      "autonomy",
      "client",
      "source",
      "topic",
      "updatedAt",
    ]);
  });

  test("the schema still defaults both suspension fields to null — the reason the SET clause was destructive", () => {
    expect(parsed.suspended_at).toBeNull();
    expect(parsed.suspension_reason).toBeNull();
  });
});
