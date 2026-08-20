import { describe, expect, test } from "bun:test";
import { upsertPolicy } from "@server/mail/query/policies";

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
