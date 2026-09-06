import { db } from "@server/db/drizzle";
import { action, message } from "@server/db/schema";
import type { ActionJournal, ExecuteActionsInput, ExecuteActionsResult } from "@server/mail/actions/executor";
import { APPLIED_STATUS, PENDING_STATUS } from "@server/mail/actions/executor";
import { EXECUTABLE_ACTION_KINDS, QUARANTINE_KIND } from "@server/mail/actions/kinds";
import { JUNK_FOLDER_SOURCE } from "@server/mail/classify/rules";
import { classifyMailboxError } from "@server/mail/errors";
import type { FolderInfo, MailboxProvider } from "@server/mail/providers/types";
import type { PolicyIndex } from "@server/mail/query/policies";
import { loadPolicyIndex } from "@server/mail/query/policies";
import type { MailboxFlavor } from "@server/mail/types";
import { and, asc, eq, inArray, isNull, notExists, sql } from "drizzle-orm";

// The host's spam verdict, carried into a folder we own (docs/decisions/2026-09-06-spam-junk-to-quarantine.md).
// xneelo diverts what its filter catches into a Junk folder it purges on an undocumented schedule; every
// incremental sync moves whatever sits there into Quarantine, marked read, so the verdict is kept and the
// mail is not. Generic mailboxes only: Gmail's spam is a label on a folder the sync never walks.

// The wire form of RFC 6154's junk attribute. Servers that advertise it need no name match; xneelo does
// not, so the names below are the fallback.
export const JUNK_FOLDER_SPECIAL_USE = "\\Junk";

// Matched against the LAST segment of a folder path, lowercased, so "INBOX.Junk" under a "." namespace
// root matches and "INBOX.Junkyard" does not. `spambucket` is xneelo's own spelling.
export const JUNK_FOLDER_NAMES = ["junk", "spam", "spambucket"] as const;

// Its own run id rather than SCHEDULED_RUN_ID, because Action's unique key is (messageId, kind, runId)
// and the scheduled classify pass walks Junk too: a first contact sitting there already carries a
// `quarantine` shadow row under the scheduled id, and this stage's row must coexist with it rather than
// overwrite it. A constant rather than a fresh UUID so a retry of a failed row lands on the same row.
export const JUNK_FOLDER_RUN_ID = "junk-folder" as const;

export function isJunkFolder(folder: FolderInfo): boolean {
  if (folder.special_use === JUNK_FOLDER_SPECIAL_USE) {
    return true;
  }
  const segments = folder.delimiter.length === 0 ? [folder.path] : folder.path.split(folder.delimiter);
  const last_segment = (segments[segments.length - 1] ?? folder.path).toLowerCase();
  return JUNK_FOLDER_NAMES.some((name) => name === last_segment);
}

export function selectJunkFolders(folders: FolderInfo[]): string[] {
  return folders.filter((folder) => folder.selectable && isJunkFolder(folder)).map((folder) => folder.path);
}

export type JunkCandidate = {
  id: string;
  folder: string;
  from_address: string | null;
  from_domain: string | null;
  is_flagged: boolean;
};

// `keep_inbox`: the operator has vouched for the sender, and a whitelisted false positive is left for
// them to rescue in xneelo rather than moved a second time. `flagged`: the flag guard is absolute
// everywhere else in the system, and a flag the operator set on a message in Junk is the same claim.
export type JunkVerdict = "move" | "keep_inbox" | "flagged";

// Address over domain, the same precedence matchPolicy (classify/rules.ts) resolves: an address policy
// that names the sender is the operator's most specific word, and a domain-wide keep_inbox under it does
// not override it. Suspension is ignored on purpose — it says a policy's ACTION went wrong once, not that
// the operator withdrew the whitelist.
export function junkVerdictFor(candidate: JunkCandidate, policy_index: Pick<PolicyIndex, "by_address" | "by_domain">): JunkVerdict {
  if (candidate.is_flagged) {
    return "flagged";
  }
  const address_policy = policy_index.by_address.get((candidate.from_address ?? "").toLowerCase());
  const winning_policy = address_policy ?? policy_index.by_domain.get((candidate.from_domain ?? "").toLowerCase());
  if (winning_policy?.action === "keep_inbox") {
    return "keep_inbox";
  }
  return "move";
}

// Exported unexecuted so junk.test.ts can read its SQL without a connection, the same way
// shadow/run.test.ts reads messageBatchQuery. Oldest first: the purge takes the oldest mail first, so a
// batch that cannot cover the folder saves what is nearest to being lost.
export function junkCandidateQuery(input: { mailbox_id: string; junk_folders: string[]; batch_size: number }) {
  if (input.junk_folders.length === 0) {
    throw new Error("junkCandidateQuery needs at least one junk folder; the caller skips the stage when the server has none.");
  }
  return db
    .select({
      id: message.id,
      folder: message.folder,
      from_address: message.from_address,
      from_domain: message.from_domain,
      is_flagged: message.is_flagged,
    })
    .from(message)
    .where(
      and(
        eq(message.mailbox_id, input.mailbox_id),
        isNull(message.disappeared_at),
        inArray(message.folder, input.junk_folders),
        // Any executable kind, not only quarantine: the classify-and-execute stage runs before this one and
        // walks Junk too, so an `auto` policy may already have moved the message out — the row still says
        // INBOX.Junk until the next fetch, and a quarantine journaled now would fail on a UID that is gone.
        // `applied` and `pending` only: a failed or deferred row is retried.
        notExists(
          db
            .select({ moved: sql`1` })
            .from(action)
            .where(
              and(
                eq(action.message_id, message.id),
                inArray(action.kind, [...EXECUTABLE_ACTION_KINDS]),
                inArray(action.status, [APPLIED_STATUS, PENDING_STATUS]),
              ),
            ),
        ),
      ),
    )
    .orderBy(asc(message.internal_date), asc(message.id))
    .limit(input.batch_size);
}

// Behind a port for the same reason ActionJournal and RescuePort are: every DATABASE_URL points at the
// same production MySQL, so a test that reached the real implementation would journal and execute
// quarantines against live mail.
export type JunkQuarantinePort = {
  loadCandidates: (input: { mailbox_id: string; junk_folders: string[]; batch_size: number }) => Promise<JunkCandidate[]>;
  loadPolicyIndex: () => Promise<Pick<PolicyIndex, "by_address" | "by_domain">>;
  // Writes one `pending` quarantine row per message under JUNK_FOLDER_RUN_ID and returns the ids now
  // pending for exactly those messages — the executor's entire input, so a row the operator approved by
  // hand can never ride along.
  journalPendingQuarantines: (input: { mailbox_id: string; message_ids: string[]; now: Date }) => Promise<string[]>;
};

export type JunkQuarantinePassInput = {
  mailbox_id: string;
  flavor: MailboxFlavor;
  hierarchy_delimiter: string;
  junk_folders: string[];
  // The executor's batch, and a cap on one run's moves exactly as it is for the classify pass.
  batch_size: number;
  provider: MailboxProvider;
  journal: ActionJournal;
  port: JunkQuarantinePort;
  executePendingActions: (input: ExecuteActionsInput) => Promise<ExecuteActionsResult>;
};

// Not through decide() and not shadow-first, the one exception to the shadow rule: the host already
// judged the message, the destination is a folder we own and never purge, and a shadow row waiting for
// promotion could outlive the mail it describes. Failures become a note on the run summary, never a
// thrown error, for the same reason every other stage's do: fetching mail is the sync's job.
export async function runJunkQuarantinePassForMailbox(input: JunkQuarantinePassInput): Promise<string | null> {
  if (input.flavor !== "generic" || input.junk_folders.length === 0) {
    return null;
  }

  try {
    const candidates = await input.port.loadCandidates({
      mailbox_id: input.mailbox_id,
      junk_folders: input.junk_folders,
      batch_size: input.batch_size,
    });
    if (candidates.length === 0) {
      return null;
    }

    const policy_index = await input.port.loadPolicyIndex();
    const message_ids: string[] = [];
    let kept = 0;
    let flagged = 0;
    for (const candidate of candidates) {
      const verdict = junkVerdictFor(candidate, policy_index);
      if (verdict === "move") {
        message_ids.push(candidate.id);
      }
      if (verdict === "keep_inbox") {
        kept += 1;
      }
      if (verdict === "flagged") {
        flagged += 1;
      }
    }

    let moved = 0;
    let failed = 0;
    let deferred = 0;
    if (message_ids.length > 0) {
      const action_ids = await input.port.journalPendingQuarantines({ mailbox_id: input.mailbox_id, message_ids, now: new Date() });
      const executed = await input.executePendingActions({
        mailbox_id: input.mailbox_id,
        flavor: input.flavor,
        provider: input.provider,
        journal: input.journal,
        batch_size: input.batch_size,
        hierarchy_delimiter: input.hierarchy_delimiter,
        action_ids,
      });
      moved = executed.applied;
      failed = executed.failed;
      deferred = executed.deferred;
    }

    const parts = [`junk: examined ${candidates.length}, moved ${moved}, failed ${failed}`];
    if (deferred > 0) {
      parts.push(`deferred ${deferred}`);
    }
    if (flagged > 0) {
      parts.push(`left ${flagged} flagged in place`);
    }
    if (kept > 0) {
      parts.push(`kept ${kept} by policy`);
    }
    return parts.join(", ");
  } catch (error) {
    const failure = classifyMailboxError(error);
    return `junk quarantine failed: ${failure.kind}: ${failure.message}`;
  }
}

async function journalPendingQuarantines(input: { mailbox_id: string; message_ids: string[]; now: Date }): Promise<string[]> {
  // The only duplicate this can meet is a row THIS stage wrote earlier for the same message — failed or
  // deferred, since the candidate query excludes applied and pending — and re-opening it is the retry.
  // Its from_state_json stays: the executor's recordFromState keeps the first capture, which is the state
  // to restore whether or not the earlier attempt got as far as the mailbox.
  await db
    .insert(action)
    .values(
      input.message_ids.map((message_id) => ({
        id: crypto.randomUUID(),
        message_id,
        sender_policy_id: null,
        mailbox_id: input.mailbox_id,
        kind: QUARANTINE_KIND,
        source: JUNK_FOLDER_SOURCE,
        status: PENDING_STATUS,
        run_id: JUNK_FOLDER_RUN_ID,
        decided_at: input.now,
        updatedAt: input.now,
      })),
    )
    .onDuplicateKeyUpdate({
      set: {
        status: PENDING_STATUS,
        error: null,
        decided_at: input.now,
        updatedAt: input.now,
      },
    });

  // Read back rather than returned: Action.id defaults server-side and $returningId reports nothing for
  // a SQL default (see runMailboxSync), and a duplicate keeps its existing id, not the one generated above.
  const rows = await db
    .select({ id: action.id })
    .from(action)
    .where(
      and(
        eq(action.mailbox_id, input.mailbox_id),
        eq(action.run_id, JUNK_FOLDER_RUN_ID),
        eq(action.kind, QUARANTINE_KIND),
        eq(action.status, PENDING_STATUS),
        inArray(action.message_id, input.message_ids),
      ),
    );
  return rows.map((row) => row.id);
}

export function createDatabaseJunkQuarantinePort(): JunkQuarantinePort {
  return {
    loadCandidates: async (input) => junkCandidateQuery(input),
    loadPolicyIndex,
    journalPendingQuarantines,
  };
}
