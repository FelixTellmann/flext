import { db } from "@server/db/drizzle";
import { neverTouchRule, senderPolicy, senderSuppression } from "@server/db/schema";
import type { NeverTouchRuleInput, NeverTouchRuleKind } from "@server/mail/classify/guards";
import type { PolicyAction, PolicyScope } from "@server/mail/classify/rules";
import { POLICY_ACTIONS } from "@server/mail/classify/rules";
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

const upsert_policy_schema = z.object({
  scope: z.enum(["address", "domain"]),
  value: z.string().min(1).max(320),
  // §5.4/§8: a policy must never carry `purge`, the irreversible sweep action reserved for the separate
  // Phase 8 job (§1.7). POLICY_ACTIONS is the same allowlist rules.ts enforces on read; this is the write
  // side of that defence, and it must reject a bad value here rather than let it reach a stored row.
  action: z.enum(POLICY_ACTIONS),
  client: z.string().max(191).nullable().default(null),
  topic: z.string().max(191).nullable().default(null),
  autonomy: z
    .enum(["shadow", "auto"])
    .default("shadow")
    // §8: every policy is born in shadow, without exception, until Phase 4 gives the executor something
    // to promote into. A caller asking for "auto" made a mistake that must surface, not be silently
    // downgraded to "shadow" — hence a rejecting refine rather than a coercing default.
    .refine(
      (value): value is "shadow" => value === "shadow",
      (value) => ({
        message: `policy autonomy must be "shadow" in this phase; every policy is born in shadow (§8) — got "${value}"`,
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

export async function upsertPolicy(input: UpsertPolicyInput): Promise<PolicyRow> {
  const parsed = upsert_policy_schema.parse(input);
  const now = new Date();

  await db
    .insert(senderPolicy)
    .values({
      scope: parsed.scope,
      value: parsed.value,
      action: parsed.action,
      client: parsed.client,
      topic: parsed.topic,
      autonomy: parsed.autonomy,
      source: parsed.source,
      suspended_at: parsed.suspended_at,
      suspension_reason: parsed.suspension_reason,
      updatedAt: now,
    })
    .onDuplicateKeyUpdate({
      set: {
        action: parsed.action,
        client: parsed.client,
        topic: parsed.topic,
        autonomy: parsed.autonomy,
        source: parsed.source,
        suspended_at: parsed.suspended_at,
        suspension_reason: parsed.suspension_reason,
        updatedAt: now,
      },
    });

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
