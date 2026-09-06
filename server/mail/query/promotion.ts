import { db } from "@server/db/drizzle";
import { action, message, senderPolicy } from "@server/db/schema";
import { SHADOW_STATUS } from "@server/mail/actions/promote";
import type { PolicyScope } from "@server/mail/classify/rules";
import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";

// One row of the review sheet: a policy that has been deciding in the background and has never been
// allowed to act, together with the evidence needed to judge it.
//
// This exists because promotion is gated on the operator having REVIEWED the policy's shadow record, and
// reviewing 113 policies one screen at a time is a gate nobody passes. Nothing here weakens that gate —
// it puts the same evidence in front of the operator in one place so the review can actually happen.
export type PromotionCandidate = {
  policy_id: string;
  scope: PolicyScope;
  value: string;
  policy_action: string;
  // Decisions this policy has made and never executed. The size of the change promoting it would cause.
  waiting: number;
  // Times a message this policy acted on was later opened or replied to. Non-zero means it has been wrong
  // before, in exactly the way §8's rescue detection exists to catch, and it should be read before it is
  // trusted rather than promoted because it happens to be near the top of the list.
  rescues: number;
  // A `keep_inbox` policy promoted to auto moves nothing — it is a statement that mail SHOULD stay put,
  // and since inbox-dwell §1.8 it is also the permanent pin against the settled sweep. Worth showing, but
  // it never belongs in a "turn on the big ones" batch, so the caller can tell them apart without
  // re-deriving the rule.
  moves_mail: boolean;
  sample_subjects: string[];
};

const SAMPLE_LIMIT = 5;

// Every policy the operator could promote right now: still at `shadow`, not suspended, with decisions
// waiting. Ordered by how much each would move, because promotion is a power law here — on 2026-08-26 ten
// of 113 policies covered half the backlog — and reviewing in that order means the first ten minutes are
// worth more than the next two hours.
export async function listPromotionCandidates(input: { limit: number }): Promise<PromotionCandidate[]> {
  const rows = await db
    .select({
      policy_id: senderPolicy.id,
      scope: senderPolicy.scope,
      value: senderPolicy.value,
      policy_action: senderPolicy.action,
      waiting: sql<number>`(
        SELECT COUNT(*) FROM Action a
        WHERE a.senderPolicyId = SenderPolicy.id AND a.status = ${SHADOW_STATUS}
      )`.as("waiting"),
      rescues: sql<number>`(
        SELECT COUNT(*) FROM Action a
        WHERE a.senderPolicyId = SenderPolicy.id AND a.rescuedAt IS NOT NULL
      )`.as("rescues"),
    })
    .from(senderPolicy)
    // SenderPolicy.id must be QUALIFIED inside both subqueries. Drizzle interpolates a column reference
    // unqualified, and a bare `id` there binds to Action's own id column — the correlation silently
    // becomes a.senderPolicyId = a.id, false for every row, and every policy reports a backlog of zero.
    .where(and(eq(senderPolicy.autonomy, "shadow"), isNull(senderPolicy.suspended_at)))
    .orderBy(desc(sql`waiting`))
    .limit(input.limit);

  const with_waiting = rows.filter((row) => Number(row.waiting) > 0);
  if (with_waiting.length === 0) {
    return [];
  }

  // One query per candidate rather than one for all of them: the alternative is a windowed join over
  // Action and Message for every policy at once, and `limit` is small by construction — this sheet is
  // read by a person, not a machine.
  const samples = await Promise.all(
    with_waiting.map(async (row) => {
      const subjects = await db
        .select({ subject: message.subject })
        .from(action)
        .innerJoin(message, eq(message.id, action.message_id))
        .where(and(eq(action.sender_policy_id, row.policy_id), eq(action.status, SHADOW_STATUS), isNotNull(message.subject)))
        .limit(SAMPLE_LIMIT);
      return subjects.map((entry) => entry.subject ?? "").filter((subject) => subject.length > 0);
    }),
  );

  return with_waiting.map((row, index) => ({
    policy_id: row.policy_id,
    scope: row.scope as PolicyScope,
    value: row.value,
    policy_action: row.policy_action,
    waiting: Number(row.waiting),
    rescues: Number(row.rescues),
    moves_mail: row.policy_action !== "keep_inbox",
    sample_subjects: samples[index] ?? [],
  }));
}
