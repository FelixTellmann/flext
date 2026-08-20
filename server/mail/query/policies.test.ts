import { describe, expect, test } from "bun:test";
import { upsert_policy_schema, upsertPolicy } from "@server/mail/query/policies";

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
