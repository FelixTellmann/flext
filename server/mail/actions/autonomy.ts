import { db } from "@server/db/drizzle";
import { senderPolicy } from "@server/db/schema";
import type { ActionJournal } from "@server/mail/actions/executor";
import { promotePolicyActions } from "@server/mail/actions/promote";
import { and, eq, isNull } from "drizzle-orm";

// One policy eligible for autonomous promotion: autonomy `auto`, currently unsuspended. Nothing else about
// the policy matters here — promotion only needs the id to scope promotePolicyActions's read.
export type AutoPolicyRow = { sender_policy_id: string };

// Behind a port for the same reason ActionJournal and RescuePort are: a test that reached the real
// implementation would query production's live sender policies.
export type AutonomyPort = {
  loadAutoPolicies: () => Promise<AutoPolicyRow[]>;
};

export type PromoteAutoPoliciesInput = {
  mailbox_id: string;
  batch_size: number;
  port: AutonomyPort;
  journal: ActionJournal;
};

// The Task 7 step: for one mailbox, every shadow row whose sender policy sits at autonomy `auto` moves to
// `pending`. Returns exactly the ids it moved, and nothing else — that id list is the executor's entire
// input on the scheduled path (see run.ts's TASK 7 SEAM comment), and is what keeps a row an operator
// approved by hand from ever being picked up by a timer.
//
// The suspension check lives in `port.loadAutoPolicies` (a SQL `WHERE suspendedAt IS NULL`, see
// createDatabaseAutonomyPort below) rather than here. Rescue detection runs earlier in the same sync and
// may have just suspended a policy; that suspension must take effect in this run, not the next one, and a
// check performed in this function is a check a second caller of it could skip.
//
// Builds on promotePolicyActions for the actual shadow -> pending transition rather than issuing a second
// UPDATE: that function already owns the guarded move (WHERE status = 'shadow') plus the mailbox-ownership
// and batch-size checks. It reports only counts, not ids, so the shadow rows are read once here first —
// with the identical scope (mailbox, policy, batch size) promotePolicyActions itself reads with — purely
// to know which ids to hand back; the read that actually decides what moves, and the write itself, both
// stay inside promotePolicyActions.
export async function promoteAutoPolicies(input: PromoteAutoPoliciesInput): Promise<string[]> {
  const eligible_policies = await input.port.loadAutoPolicies();
  const promoted_action_ids: string[] = [];

  for (const policy of eligible_policies) {
    const rows = await input.journal.loadShadowActionsByPolicy({
      mailbox_id: input.mailbox_id,
      sender_policy_id: policy.sender_policy_id,
      batch_size: input.batch_size,
    });
    if (rows.length === 0) {
      continue;
    }

    await promotePolicyActions({
      sender_policy_id: policy.sender_policy_id,
      mailbox_id: input.mailbox_id,
      batch_size: input.batch_size,
      journal: input.journal,
    });

    promoted_action_ids.push(...rows.map((row) => row.action_id));
  }

  return promoted_action_ids;
}

// The suspension guard is right here, in the WHERE clause: `isNull(senderPolicy.suspended_at)` alongside
// `autonomy = 'auto'`. Nothing upstream of this query can substitute for it — a caller-side check is one a
// second caller can skip, which is exactly Requirement 3's failure mode.
export function createDatabaseAutonomyPort(): AutonomyPort {
  return {
    loadAutoPolicies: async () => {
      return db
        .select({ sender_policy_id: senderPolicy.id })
        .from(senderPolicy)
        .where(and(eq(senderPolicy.autonomy, "auto"), isNull(senderPolicy.suspended_at)));
    },
  };
}
