import { db } from "@server/db/drizzle";
import { action, mailbox, message } from "@server/db/schema";
import type { DecisionSource } from "@server/mail/classify/rules";
import type { MessageLocation } from "@server/mail/query/deep-link";
import { buildMessageLocation } from "@server/mail/query/deep-link";
import type { SQL } from "drizzle-orm";
import { and, desc, eq, inArray, sql } from "drizzle-orm";

const SAMPLE_LIMIT = 20;

// §8's promotion gates ask "what would this rule have destroyed?", not merely "how many rows matched" —
// auto_trash is the one PolicyAction that destroys, so it alone carries the destructive weight. purge is
// listed for completeness even though decide() (rules.ts) can never emit it.
const DESTRUCTIVE_KINDS = ["auto_trash", "purge"] as const;
const ORGANISATIONAL_KINDS = ["archive", "file"] as const;

type ShadowCountRow = { kind: string; source: string; count: number };

export type ShadowSampleMessage = {
  message_id: string;
  kind: string;
  source: DecisionSource;
  subject: string | null;
  from_address: string | null;
  internal_date: string;
  location: MessageLocation;
};

export type ShadowReport = {
  run_id: string | null;
  examined: number;
  by_kind: Record<string, number>;
  by_source: Record<string, number>;
  destructive_count: number;
  organisational_count: number;
  retained_count: number;
  destructive_sample: ShadowSampleMessage[];
  sample: ShadowSampleMessage[];
};

function emptyReport(): ShadowReport {
  return {
    run_id: null,
    examined: 0,
    by_kind: {},
    by_source: {},
    destructive_count: 0,
    organisational_count: 0,
    retained_count: 0,
    destructive_sample: [],
    sample: [],
  };
}

async function latestRunId(): Promise<string | null> {
  const [row] = await db
    .select({ run_id: action.run_id })
    .from(action)
    .where(eq(action.status, "shadow"))
    .orderBy(desc(action.decided_at), desc(action.id))
    .limit(1);
  return row?.run_id ?? null;
}

async function loadCounts(where: SQL): Promise<ShadowCountRow[]> {
  const rows = await db
    .select({ kind: action.kind, source: action.source, count: sql<number>`COUNT(*)` })
    .from(action)
    .where(where)
    .groupBy(action.kind, action.source);
  return rows.map((row) => ({ kind: row.kind, source: row.source, count: Number(row.count) }));
}

function classifyCounts(
  rows: ShadowCountRow[],
): Pick<ShadowReport, "examined" | "by_kind" | "by_source" | "destructive_count" | "organisational_count" | "retained_count"> {
  const by_kind: Record<string, number> = {};
  const by_source: Record<string, number> = {};
  let examined = 0;
  let destructive_count = 0;
  let organisational_count = 0;
  let retained_count = 0;

  for (const row of rows) {
    by_kind[row.kind] = (by_kind[row.kind] ?? 0) + row.count;
    by_source[row.source] = (by_source[row.source] ?? 0) + row.count;
    examined += row.count;

    if ((DESTRUCTIVE_KINDS as readonly string[]).includes(row.kind)) {
      destructive_count += row.count;
    } else if ((ORGANISATIONAL_KINDS as readonly string[]).includes(row.kind)) {
      organisational_count += row.count;
    } else {
      retained_count += row.count;
    }
  }

  return { examined, by_kind, by_source, destructive_count, organisational_count, retained_count };
}

async function loadSample(where: SQL, limit: number): Promise<ShadowSampleMessage[]> {
  const rows = await db
    .select({
      message_id: action.message_id,
      kind: action.kind,
      source: action.source,
      subject: message.subject,
      from_address: message.from_address,
      internal_date: message.internal_date,
      folder: message.folder,
      flavor: mailbox.flavor,
      account_index: mailbox.account_index,
      gm_thrid: message.gm_thrid,
      header_message_id: message.message_id,
    })
    .from(action)
    .innerJoin(message, eq(message.id, action.message_id))
    .innerJoin(mailbox, eq(mailbox.id, message.mailbox_id))
    .where(where)
    .orderBy(desc(action.decided_at))
    .limit(limit);

  return rows.map((row) => ({
    message_id: row.message_id,
    kind: row.kind,
    source: row.source as DecisionSource,
    subject: row.subject,
    from_address: row.from_address,
    internal_date: row.internal_date.toISOString(),
    location: buildMessageLocation({
      flavor: row.flavor,
      account_index: row.account_index,
      gm_thrid: row.gm_thrid,
      folder: row.folder,
      message_id: row.header_message_id,
    }),
  }));
}

async function buildReport(where: SQL): Promise<Omit<ShadowReport, "run_id">> {
  const [count_rows, sample, destructive_sample] = await Promise.all([
    loadCounts(where),
    loadSample(where, SAMPLE_LIMIT),
    loadSample(and(where, inArray(action.kind, DESTRUCTIVE_KINDS)) as SQL, SAMPLE_LIMIT),
  ]);

  return { ...classifyCounts(count_rows), sample, destructive_sample };
}

export async function getShadowReport(input: { policy_id: string }): Promise<ShadowReport> {
  const run_id = await latestRunId();
  if (run_id === null) {
    return emptyReport();
  }

  const where = and(eq(action.run_id, run_id), eq(action.sender_policy_id, input.policy_id)) as SQL;
  return { run_id, ...(await buildReport(where)) };
}

export async function getShadowSummary(): Promise<ShadowReport> {
  const run_id = await latestRunId();
  if (run_id === null) {
    return emptyReport();
  }

  const where = eq(action.run_id, run_id);
  return { run_id, ...(await buildReport(where)) };
}
