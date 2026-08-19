import { db } from "@server/db/drizzle";
import { threadState } from "@server/db/schema";
import type { ThreadStateValue } from "@server/mail/classify/rules";
import type { SuppressionRow } from "@server/mail/query/policies";
import { addSuppression } from "@server/mail/query/policies";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

export type ThreadStateRow = {
  id: string;
  mailbox_id: string;
  thread_key: string;
  state: ThreadStateValue;
  snoozed_until: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type DismissThreadResult = { thread: ThreadStateRow; suppression: SuppressionRow | null };

// thread_key is the queue's group key — COALESCE(Message.threadKey, Message.id) — so a message that
// carries no threadKey of its own is still addressable here, under its own id.
const thread_target_schema = z.object({
  mailbox_id: z.string().min(1).max(191),
  thread_key: z.string().min(1).max(512),
});

const snooze_thread_schema = thread_target_schema.extend({
  // A deadline already in the past is a caller bug, not an instant snooze: listNeedsAction returns a
  // thread the moment snoozedUntil passes, so such a row would suppress nothing and read as a mistake.
  until: z.date().refine((value) => value.getTime() > Date.now(), { message: "snooze deadline must be in the future" }),
});

const dismiss_thread_schema = thread_target_schema.extend({
  sender_address: z.string().max(320).nullable().default(null),
  reason: z.string().min(1),
});

function toThreadStateRow(raw: typeof threadState.$inferSelect): ThreadStateRow {
  return {
    id: raw.id,
    mailbox_id: raw.mailbox_id,
    thread_key: raw.thread_key,
    state: raw.state as ThreadStateValue,
    snoozed_until: raw.snoozed_until,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

async function setThreadState(input: {
  mailbox_id: string;
  thread_key: string;
  state: ThreadStateValue;
  snoozed_until: Date | null;
}): Promise<ThreadStateRow> {
  const now = new Date();

  await db
    .insert(threadState)
    .values({
      mailbox_id: input.mailbox_id,
      thread_key: input.thread_key,
      state: input.state,
      snoozed_until: input.snoozed_until,
      updatedAt: now,
    })
    .onDuplicateKeyUpdate({ set: { state: input.state, snoozed_until: input.snoozed_until, updatedAt: now } });

  const [row] = await db
    .select()
    .from(threadState)
    .where(and(eq(threadState.mailbox_id, input.mailbox_id), eq(threadState.thread_key, input.thread_key)))
    .limit(1);

  if (row === undefined) {
    throw new Error(`setThreadState: row for ${input.mailbox_id}:${input.thread_key} vanished immediately after write`);
  }

  return toThreadStateRow(row);
}

export async function snoozeThread(input: { mailbox_id: string; thread_key: string; until: Date }): Promise<ThreadStateRow> {
  const parsed = snooze_thread_schema.parse(input);
  return setThreadState({
    mailbox_id: parsed.mailbox_id,
    thread_key: parsed.thread_key,
    state: "snoozed",
    snoozed_until: parsed.until,
  });
}

// snoozed_until is cleared, not left behind: a done thread that still carried a past deadline would read
// as an expired snooze to anything that looks at the deadline before the state.
export async function markThreadDone(input: { mailbox_id: string; thread_key: string }): Promise<ThreadStateRow> {
  const parsed = thread_target_schema.parse(input);
  return setThreadState({ mailbox_id: parsed.mailbox_id, thread_key: parsed.thread_key, state: "done", snoozed_until: null });
}

// §1.9's growth path: a dismissal is the operator saying "this shouldn't be here", which is training
// signal about the sender and not only about this thread, so it writes a SenderSuppression row as well.
// Thread state is written first — if the suppression write then fails, the operator's local judgement has
// still landed, whereas the reverse order would suppress a sender globally off a thread action that never
// took effect. A dismissal carries no suppression only when the row has no sender address to blame.
export async function dismissThread(input: {
  mailbox_id: string;
  thread_key: string;
  sender_address: string | null;
  reason: string;
}): Promise<DismissThreadResult> {
  const parsed = dismiss_thread_schema.parse(input);

  const thread = await setThreadState({
    mailbox_id: parsed.mailbox_id,
    thread_key: parsed.thread_key,
    state: "dismissed",
    snoozed_until: null,
  });

  if (parsed.sender_address === null || parsed.sender_address.length === 0) {
    return { thread, suppression: null };
  }

  const suppression = await addSuppression({ sender_address: parsed.sender_address, reason: parsed.reason });

  return { thread, suppression };
}
