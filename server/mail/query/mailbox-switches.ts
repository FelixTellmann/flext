import { db } from "@server/db/drizzle";
import { mailbox } from "@server/db/schema";
import type { PolicyAutonomy } from "@server/mail/query/policies";
import { and, eq, ne } from "drizzle-orm";

// docs/decisions/2026-09-06-scheduled-source-autonomy-per-mailbox.md: the three scheduled sources that
// carry no policy id each get a switch per mailbox. Named after the Mailbox columns rather than the
// DecisionSource spellings (sweep_settled, sweep_declined) because this module writes columns.
export const SOURCE_SWITCHES = ["first_contact", "settled_sweep", "declined_sweep"] as const;
export type SourceSwitch = (typeof SOURCE_SWITCHES)[number];

// The two suspension pairs an operator can clear. `dwell` covers both sweeps: 1.11 suspends the mailbox's
// sweeping, not one sweep.
export const MAILBOX_SUSPENSIONS = ["first_contact", "dwell"] as const;
export type MailboxSuspension = (typeof MAILBOX_SUSPENSIONS)[number];

type SourceAutonomyColumns = Partial<
  Pick<
    typeof mailbox.$inferInsert,
    | "first_contact_autonomy"
    | "first_contact_autonomy_set_at"
    | "settled_sweep_autonomy"
    | "settled_sweep_autonomy_set_at"
    | "declined_sweep_autonomy"
    | "declined_sweep_autonomy_set_at"
    | "updatedAt"
  >
>;

// The SET clause for one switch. set-at is `now` on the way to auto and null on the way back: first
// contact's promotion cutoff is that timestamp (eligibleScheduledSources refuses auto with none), and a
// stale one left behind by a shadow -> auto -> shadow -> auto cycle would promote the rows that arrived
// while the switch was off. A JS Date, never sql`NOW()`: drizzle.ts sets no session timezone, and the
// promotion compares Message.internalDate against this value in JS.
export function sourceAutonomyColumns(source: SourceSwitch, autonomy: PolicyAutonomy, now: Date): SourceAutonomyColumns {
  const set_at = autonomy === "auto" ? now : null;
  if (source === "first_contact") {
    return { first_contact_autonomy: autonomy, first_contact_autonomy_set_at: set_at, updatedAt: now };
  }
  if (source === "settled_sweep") {
    return { settled_sweep_autonomy: autonomy, settled_sweep_autonomy_set_at: set_at, updatedAt: now };
  }
  return { declined_sweep_autonomy: autonomy, declined_sweep_autonomy_set_at: set_at, updatedAt: now };
}

type SuspensionClearColumns = Partial<
  Pick<
    typeof mailbox.$inferInsert,
    "first_contact_suspended_at" | "first_contact_suspension_reason" | "dwell_suspended_at" | "dwell_suspension_reason" | "updatedAt"
  >
>;

// The operator-only inverse of rescue detection's two mailbox suspensions (server/mail/rescue/journal.ts).
// Unconditional, like clearPolicySuspension: no precondition can make it unsafe. Autonomy is untouched —
// clearing a suspension is neither a promotion nor a demotion.
export function suspensionClearColumns(which: MailboxSuspension, now: Date): SuspensionClearColumns {
  if (which === "first_contact") {
    return { first_contact_suspended_at: null, first_contact_suspension_reason: null, updatedAt: now };
  }
  return { dwell_suspended_at: null, dwell_suspension_reason: null, updatedAt: now };
}

// The autonomy column a switch writes, so a same-value call can be refused in SQL.
export function sourceAutonomyColumn(source: SourceSwitch) {
  if (source === "first_contact") {
    return mailbox.first_contact_autonomy;
  }
  if (source === "settled_sweep") {
    return mailbox.settled_sweep_autonomy;
  }
  return mailbox.declined_sweep_autonomy;
}

// Guarded on the current value: a second "auto" on a switch already at auto must not re-stamp set-at,
// because for first contact that timestamp is the promotion cutoff and moving it forward would strand
// every proposal that arrived in between. A same-value call is a no-op.
export async function setSourceAutonomy(input: {
  mailbox_id: string;
  source: SourceSwitch;
  autonomy: PolicyAutonomy;
  now: Date;
}): Promise<void> {
  await db
    .update(mailbox)
    .set(sourceAutonomyColumns(input.source, input.autonomy, input.now))
    .where(and(eq(mailbox.id, input.mailbox_id), ne(sourceAutonomyColumn(input.source), input.autonomy)));
}

export async function clearMailboxSuspension(input: { mailbox_id: string; which: MailboxSuspension; now: Date }): Promise<void> {
  await db.update(mailbox).set(suspensionClearColumns(input.which, input.now)).where(eq(mailbox.id, input.mailbox_id));
}
