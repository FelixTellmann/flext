import { db } from "@server/db/drizzle";
import { neverTouchRule, senderPolicy, senderSuppression } from "@server/db/schema";
import type { NeverTouchRuleInput, NeverTouchRuleKind } from "@server/mail/classify/guards";
import type { PolicyAction, PolicyScope } from "@server/mail/classify/rules";
import { POLICY_ACTIONS } from "@server/mail/classify/rules";
import { CLIENT_SEGMENT_RULE } from "@server/mail/filing/paths";
import type { SQL } from "drizzle-orm";
import { and, desc, eq, isNotNull, isNull, like, or } from "drizzle-orm";
import { z } from "zod";

export type PolicyAutonomy = "shadow" | "auto";

export type PolicyRow = {
  id: string;
  scope: PolicyScope;
  value: string;
  action: PolicyAction;
  client: string | null;
  topic: string | null;
  autonomy: PolicyAutonomy;
  // When the operator promoted this policy to `auto` (Task 8's `promotePolicyAutonomy`, the only writer of
  // this field besides a demotion, which leaves it untouched). Null on every policy that has never been
  // promoted, or that was promoted and then demoted — the promotion history stays on the row rather than
  // being erased by a demotion, which matters for §8.1's "measured from autonomyPromotedAt" if the same
  // policy is promoted again later.
  autonomy_promoted_at: Date | null;
  source: string;
  suspended_at: Date | null;
  suspension_reason: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type PolicyFilter = {
  scope: PolicyScope | "all";
  suspended: "all" | "active" | "suspended";
  search: string | null;
};

export type UpsertPolicyInput = {
  scope: PolicyScope;
  value: string;
  action: PolicyAction;
  client?: string | null;
  topic?: string | null;
  autonomy?: PolicyAutonomy;
  source: string;
  suspended_at?: Date | null;
  suspension_reason?: string | null;
};

export type NeverTouchRow = NeverTouchRuleInput & {
  id: string;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type UpsertNeverTouchRuleInput = {
  id?: string;
  kind: NeverTouchRuleKind;
  value: string;
  note?: string | null;
};

export type SuppressionRow = {
  id: string;
  sender_address: string;
  reason: string;
  createdAt: Date;
  updatedAt: Date;
};

export type AddSuppressionInput = {
  sender_address: string;
  reason: string;
};

export type PolicyIndex = {
  by_address: Map<string, PolicyRow>;
  by_domain: Map<string, PolicyRow>;
  never_touch: NeverTouchRuleInput[];
  suppressed: Set<string>;
};

// Exported so its own tests can pin behaviour without going through upsertPolicy's insert/select — every
// DATABASE_URL variant points at the same production senderPolicy table, and this schema's own parsing
// (see the "auto" refine and the demotion-on-edit default below) is what those tests need to exercise.
export const upsert_policy_schema = z.object({
  scope: z.enum(["address", "domain"]),
  value: z.string().min(1).max(320),
  // §5.4/§8: a policy must never carry `purge`, the irreversible sweep action reserved for the separate
  // Phase 8 job (§1.7). POLICY_ACTIONS is the same allowlist rules.ts enforces on read; this is the write
  // side of that defence, and it must reject a bad value here rather than let it reach a stored row.
  action: z.enum(POLICY_ACTIONS),
  client: z.string().max(191).refine(CLIENT_SEGMENT_RULE.test, { message: CLIENT_SEGMENT_RULE.message }).nullable().default(null),
  topic: z.string().max(191).nullable().default(null),
  autonomy: z
    .enum(["shadow", "auto"])
    // This default is also §8's demotion-on-edit, not a side effect of one: upsertPolicy carries no field
    // that preserves an existing row's autonomy, so any edit that does not explicitly re-assert "auto"
    // lands here and writes "shadow" over it, even if the row being edited was already promoted.
    // That is deliberate, for the same reason a rescue suspends a policy rather than merely logging it: a
    // promotion is trust in the rule AS THE SHADOW RECORD SHOWED IT. Editing the rule — its action,
    // client, scope — makes that record describe a rule that no longer runs, while the promotion it
    // justified would otherwise carry on unreviewed. Demoting says the changed rule has not yet earned
    // trust for its new shape. Do not "fix" this by threading the current autonomy through as a default —
    // that would let an edit silently keep unattended write access to a mailbox instead of asking the
    // operator to promote it again through the dedicated procedure (autonomy.ts's promotePolicyAutonomy).
    .default("shadow")
    // §8/§4.3: every policy is born in shadow, without exception, and this general-purpose write is never
    // the place autonomy is granted — promotePolicyAutonomy is, after §4.2's gates. A caller asking for
    // "auto" made a mistake that must surface, not be silently downgraded to "shadow" — hence a rejecting
    // refine rather than a coercing default.
    .refine(
      (value): value is "shadow" => value === "shadow",
      (value) => ({
        message: `policy autonomy must be "shadow" here; promotion is promotePolicyAutonomy's job, not an edit's (§8) — got "${value}"`,
      }),
    ),
  source: z.string().min(1).max(191),
  suspended_at: z.date().nullable().default(null),
  suspension_reason: z.string().nullable().default(null),
});

const upsert_never_touch_rule_schema = z.object({
  id: z.string().min(1).optional(),
  kind: z.enum(["address", "domain", "subject_pattern"]),
  value: z.string().min(1).max(512),
  note: z.string().nullable().default(null),
});

const add_suppression_schema = z.object({
  sender_address: z.string().min(1).max(320),
  reason: z.string().min(1),
});

function toPolicyRow(raw: typeof senderPolicy.$inferSelect): PolicyRow {
  return {
    id: raw.id,
    scope: raw.scope as PolicyScope,
    value: raw.value,
    action: raw.action as PolicyAction,
    client: raw.client,
    topic: raw.topic,
    autonomy: raw.autonomy as PolicyAutonomy,
    autonomy_promoted_at: raw.autonomy_promoted_at,
    source: raw.source,
    suspended_at: raw.suspended_at,
    suspension_reason: raw.suspension_reason,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

function toNeverTouchRow(raw: typeof neverTouchRule.$inferSelect): NeverTouchRow {
  return {
    id: raw.id,
    kind: raw.kind as NeverTouchRuleKind,
    value: raw.value,
    note: raw.note,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

function toSuppressionRow(raw: typeof senderSuppression.$inferSelect): SuppressionRow {
  return {
    id: raw.id,
    sender_address: raw.sender_address,
    reason: raw.reason,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

function buildPolicyWhere(filter: PolicyFilter): SQL | undefined {
  const conditions: SQL[] = [];

  if (filter.scope !== "all") {
    conditions.push(eq(senderPolicy.scope, filter.scope));
  }
  if (filter.suspended === "active") {
    conditions.push(isNull(senderPolicy.suspended_at));
  }
  if (filter.suspended === "suspended") {
    conditions.push(isNotNull(senderPolicy.suspended_at));
  }
  if (filter.search !== null && filter.search.length > 0) {
    const pattern = `%${filter.search}%`;
    conditions.push(or(like(senderPolicy.value, pattern), like(senderPolicy.client, pattern), like(senderPolicy.topic, pattern)) as SQL);
  }

  return conditions.length > 0 ? and(...conditions) : undefined;
}

export async function listPolicies(filter: PolicyFilter): Promise<PolicyRow[]> {
  const rows = await db.select().from(senderPolicy).where(buildPolicyWhere(filter)).orderBy(desc(senderPolicy.updatedAt));
  return rows.map(toPolicyRow);
}

// Every column an EDIT of an existing policy is allowed to overwrite. `suspended_at` and
// `suspension_reason` are absent, and adding them back is a data-loss edit — §3.4: an edit "does not
// un-suspend anything, ever". Both fields default to null on upsert_policy_schema and both UI callers
// (the sender screen's action buttons, including the BULK one) omit them, so a SET clause carrying them
// would write null over a live rescue suspension and destroy the reason text with it — turning a routine
// "mark these as archive" click into a silent re-arming of the rule that just got rescued.
// clearPolicySuspension below is the only path that may lift one, because lifting one is a deliberate
// operator act with the reason in front of them.
// Exported so policies.test.ts can pin the absence: this is the second SET clause in this codebase to
// quietly destroy state, and the first cost two review rounds in Phase 4.
export function policyEditColumns(parsed: z.infer<typeof upsert_policy_schema>, now: Date) {
  return {
    action: parsed.action,
    client: parsed.client,
    topic: parsed.topic,
    autonomy: parsed.autonomy,
    source: parsed.source,
    updatedAt: now,
  };
}

export async function upsertPolicy(input: UpsertPolicyInput): Promise<PolicyRow> {
  const parsed = upsert_policy_schema.parse(input);
  const now = new Date();

  await db
    .insert(senderPolicy)
    .values({
      scope: parsed.scope,
      value: parsed.value,
      // A row that does not exist yet has no suspension to preserve, so the INSERT half carries both
      // fields; the UPDATE half must not, which is what policyEditColumns above is for.
      suspended_at: parsed.suspended_at,
      suspension_reason: parsed.suspension_reason,
      ...policyEditColumns(parsed, now),
    })
    .onDuplicateKeyUpdate({ set: policyEditColumns(parsed, now) });

  const [row] = await db
    .select()
    .from(senderPolicy)
    .where(and(eq(senderPolicy.scope, parsed.scope), eq(senderPolicy.value, parsed.value)))
    .limit(1);

  if (row === undefined) {
    throw new Error(`upsertPolicy: row for ${parsed.scope}:${parsed.value} vanished immediately after write`);
  }

  return toPolicyRow(row);
}

export async function deletePolicy(id: string): Promise<void> {
  await db.delete(senderPolicy).where(eq(senderPolicy.id, id));
}

// Task 8's gate check needs the raw row (action, autonomy_promoted_at) before it can decide anything;
// this is that single read, kept here rather than duplicated in autonomy.ts because senderPolicy reads
// belong with the rest of this module's senderPolicy access.
export async function loadPolicyById(id: string): Promise<PolicyRow | null> {
  const [row] = await db.select().from(senderPolicy).where(eq(senderPolicy.id, id)).limit(1);
  return row === undefined ? null : toPolicyRow(row);
}

// The ONE write allowed to set autonomy to "auto" (§8, §4.3 of the Phase 6 design). upsertPolicy's Zod
// boundary rejects "auto" unconditionally and stays that way — this function is reached only after
// autonomy.ts's promotePolicyAutonomy has run its gate check, never from a general-purpose policy edit.
// autonomyPromotedAt is set in the same write as autonomy, per Task 8: it is both the audit trail for
// *when* this policy was trusted and the reference point §8.1's auto_trash gate measures a shadow cycle
// from.
export async function promotePolicyToAuto(input: { sender_policy_id: string; promoted_at: Date }): Promise<void> {
  await db
    .update(senderPolicy)
    .set({ autonomy: "auto", autonomy_promoted_at: input.promoted_at, updatedAt: new Date() })
    .where(eq(senderPolicy.id, input.sender_policy_id));
}

// Demotion is unconditional (§8 Task 8, Step 3): no gate, no precondition, and it can never fail — an
// UPDATE against a missing or already-shadow id simply affects zero rows. autonomyPromotedAt is left
// untouched deliberately: it stays the record of the last promotion rather than being erased, which is
// what lets a re-promotion decide whether it is really starting a fresh shadow cycle or continuing one.
// suspendedAt is likewise untouched — clearing a suspension is a separate, deliberate operator act (§3.4),
// not a side effect of demoting autonomy.
export async function demotePolicyToShadow(sender_policy_id: string): Promise<void> {
  await db.update(senderPolicy).set({ autonomy: "shadow", updatedAt: new Date() }).where(eq(senderPolicy.id, sender_policy_id));
}

// §9 Task 9 / §3.4: the operator-only inverse of a rescue's suspension (server/mail/rescue/journal.ts's
// suspendPolicy). "Only an operator clears a suspension" (§3.4) — nothing in this codebase does it
// automatically. Unconditional, like demotePolicyToShadow, and for the same reason: no precondition can
// make this call unsafe, so refusing it would only make the operator's own mailbox harder to manage.
// autonomy is left untouched, deliberately — clearing a suspension is not a promotion and not a demotion;
// a policy rescued while promoted to `auto` stays `auto` once cleared, mirroring how the rescue that
// suspended it never touched autonomy either.
export async function clearPolicySuspension(sender_policy_id: string): Promise<void> {
  await db
    .update(senderPolicy)
    .set({ suspended_at: null, suspension_reason: null, updatedAt: new Date() })
    .where(eq(senderPolicy.id, sender_policy_id));
}

export async function listNeverTouchRules(): Promise<NeverTouchRow[]> {
  const rows = await db.select().from(neverTouchRule).orderBy(desc(neverTouchRule.createdAt));
  return rows.map(toNeverTouchRow);
}

export async function upsertNeverTouchRule(input: UpsertNeverTouchRuleInput): Promise<NeverTouchRow> {
  const parsed = upsert_never_touch_rule_schema.parse(input);
  const id = parsed.id ?? crypto.randomUUID();
  const now = new Date();

  await db
    .insert(neverTouchRule)
    .values({ id, kind: parsed.kind, value: parsed.value, note: parsed.note, updatedAt: now })
    .onDuplicateKeyUpdate({ set: { kind: parsed.kind, value: parsed.value, note: parsed.note, updatedAt: now } });

  const [row] = await db.select().from(neverTouchRule).where(eq(neverTouchRule.id, id)).limit(1);

  if (row === undefined) {
    throw new Error(`upsertNeverTouchRule: row ${id} vanished immediately after write`);
  }

  return toNeverTouchRow(row);
}

export async function deleteNeverTouchRule(id: string): Promise<void> {
  await db.delete(neverTouchRule).where(eq(neverTouchRule.id, id));
}

export async function listSuppressions(): Promise<SuppressionRow[]> {
  const rows = await db.select().from(senderSuppression).orderBy(desc(senderSuppression.createdAt));
  return rows.map(toSuppressionRow);
}

export async function addSuppression(input: AddSuppressionInput): Promise<SuppressionRow> {
  const parsed = add_suppression_schema.parse(input);
  const id = crypto.randomUUID();
  const now = new Date();

  await db.insert(senderSuppression).values({ id, sender_address: parsed.sender_address, reason: parsed.reason, updatedAt: now });

  return { id, sender_address: parsed.sender_address, reason: parsed.reason, createdAt: now, updatedAt: now };
}

export async function loadPolicyIndex(): Promise<PolicyIndex> {
  const [policy_rows, never_touch_rows, suppression_rows] = await Promise.all([
    db.select().from(senderPolicy),
    db.select().from(neverTouchRule),
    db.select({ sender_address: senderSuppression.sender_address }).from(senderSuppression),
  ]);

  const by_address = new Map<string, PolicyRow>();
  const by_domain = new Map<string, PolicyRow>();

  for (const raw of policy_rows) {
    const row = toPolicyRow(raw);
    // suspended_at passes through untouched: rules.ts resolves a matched-but-suspended policy to
    // keep_inbox with source "suspended_policy" itself (§8). Filtering suspended rows out here would
    // make that policy invisible to matchPolicy() and fall through to a broader rule instead — the
    // exact bug that resolution was built to fix.
    const target_map = row.scope === "address" ? by_address : by_domain;
    target_map.set(row.value.toLowerCase(), row);
  }

  return {
    by_address,
    by_domain,
    never_touch: never_touch_rows.map(toNeverTouchRow),
    suppressed: new Set(suppression_rows.map((row) => row.sender_address.toLowerCase())),
  };
}
