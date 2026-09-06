import { describe, expect, test } from "bun:test";
import { supersedeSiblingsUpdate } from "@server/mail/actions/journal";

// journal.ts is the drizzle-backed port and every DATABASE_URL points at the same production MySQL, so
// its statements are inspected, never executed — the same discipline run.test.ts applies to the shadow
// writer. What is pinned here is the shape a fixture cannot reach: which rows the supersede stamp may touch.
describe("markApplied's supersede statement", () => {
  const now = new Date("2026-09-06T12:00:00.000Z");
  const { sql, params } = supersedeSiblingsUpdate({ action_id: "action-applied", message_id: "message-1" }, now).toSQL();

  test("writes superseded and updatedAt, nothing else", () => {
    const set_clause = sql.split(" set ")[1]?.split(" where ")[0] ?? "";
    expect(set_clause.split(", ").sort()).toEqual(["`status` = ?", "`updatedAt` = ?"]);
    expect(params).toContain("superseded");
  });

  test("is scoped to the applied row's message, to rows still at shadow, and never to the applied row itself", () => {
    expect(sql).toContain("`Action`.`messageId` = ?");
    expect(sql).toContain("`Action`.`status` = ?");
    expect(sql).toContain("`Action`.`id` <> ?");
    expect(params.slice(-3)).toEqual(["message-1", "shadow", "action-applied"]);
  });
});

// The two promotion loaders and the tick's counts all read `status = 'shadow'`, so a superseded row can
// never be promoted. Pinned on the source rather than trusted: dropping one predicate is a one-line edit
// that no fixture would notice.
describe("what a superseded row can never reach", () => {
  test("both shadow loaders filter on SHADOW_STATUS", async () => {
    const source = await Bun.file(`${import.meta.dir}/journal.ts`).text();
    const by_policy = source.split("async function loadShadowActionsByPolicy(")[1]?.split("async function ")[0] ?? "";
    const by_source = source.split("async function loadShadowActionsBySource(")[1]?.split("async function ")[0] ?? "";

    expect(by_policy).toContain("eq(action.status, SHADOW_STATUS)");
    expect(by_source).toContain("eq(action.status, SHADOW_STATUS)");
  });
});
