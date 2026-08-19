import type { MailboxState } from "@server/mail/actions/kinds";
import type { FolderInfo, MailboxProvider } from "@server/mail/providers/types";
import { z } from "zod";

// §7.1 step 1 reads the mailbox, never our `Message` row. A row written by the last sync can be minutes
// stale — the message may have been read, starred, relabelled or moved by hand in a mail client since —
// and from_state_json is exactly what undo restores. Restoring a stale snapshot would silently revert a
// human's own edit, so the server is the source of truth here even though it costs a round trip.

const ARCHIVE_SPECIAL_USE = "\\Archive";
const TRASH_SPECIAL_USE = "\\Trash";

export type ActionFolders = {
  archive_folder: string | null;
  trash_folder: string | null;
};

// MailboxState (kinds.ts) is what round-trips through inverseOf; `uid` and `uid_validity` ride alongside
// because `Action` has no column to address a message by, and §7.2 requires COPYUID's destination address
// to land in to_state_json or a moved message is unaddressable until the next full sync.
export type ActionStateSnapshot = MailboxState & {
  uid: number;
  uid_validity: string;
};

const action_state_schema = z.object({
  folder: z.string().min(1),
  uid: z.number().int().positive(),
  uid_validity: z.string().min(1),
  flags: z.array(z.string()),
  labels: z.array(z.string()).nullable(),
});

// The guard `inverseOf` cannot make for itself: a blank folder in from_state_json becomes an undo that
// moves a message to "", and only this module can create that condition — every folder it writes comes
// from here. Enforced at capture and again at serialization so no other construction path can slip past.
function requireFolder(folder: string): string {
  if (folder.length === 0) {
    throw new Error(
      'a mailbox state was built with an empty folder. from_state_json is the address undo moves a message back to, so a blank folder would produce a move into "" — there is no recovery from that, hence the refusal here.',
    );
  }
  return folder;
}

function requireUid(uid: number): number {
  if (!Number.isInteger(uid) || uid < 1) {
    throw new Error(`a mailbox state was built with UID ${uid}. IMAP UIDs start at 1, and 0 in a sequence set addresses nothing.`);
  }
  return uid;
}

function findSpecialUse(folders: FolderInfo[], special_use: string): string | null {
  const match = folders.find((folder) => folder.selectable && folder.special_use === special_use && folder.path.length > 0);
  return match?.path ?? null;
}

// Ruling 2: targets come from the server's SPECIAL-USE attributes, following the precedent set by
// selectSentFolders in server/mail/sync/folders.ts. A missing attribute yields null rather than a guessed
// name — planFor turns that null into a hard refusal, which is the point.
export async function resolveActionFolders(provider: MailboxProvider): Promise<ActionFolders> {
  const folders = await provider.listFolders();
  return {
    archive_folder: findSpecialUse(folders, ARCHIVE_SPECIAL_USE),
    trash_folder: findSpecialUse(folders, TRASH_SPECIAL_USE),
  };
}

function formatUidSet(uids: number[]): string {
  return [...new Set(uids)].sort((left, right) => left - right).join(",");
}

// Returns only what the server actually reported. A requested UID absent from the result is absent from
// the map, and the caller must treat that as "this message is not there any more" rather than capturing a
// state it never read — a fabricated from_state is worse than no action at all.
export async function captureFolderStates(input: {
  provider: MailboxProvider;
  folder: string;
  uids: number[];
}): Promise<Map<number, ActionStateSnapshot>> {
  const folder = requireFolder(input.folder);
  const captured = new Map<number, ActionStateSnapshot>();
  if (input.uids.length === 0) {
    return captured;
  }
  for (const uid of input.uids) {
    requireUid(uid);
  }

  const status = await input.provider.openFolder(folder);
  // fetchHeaders is heavier than this needs — it carries envelope and header fields we discard — but it is
  // the only read that returns flags and Gmail labels together, and it runs once per batch rather than
  // once per message. Adding a flags-only method to the provider was not worth reopening imap.ts for.
  const fetched = await input.provider.fetchHeaders(folder, formatUidSet(input.uids));

  const requested = new Set(input.uids);
  for (const raw of fetched) {
    if (!requested.has(raw.uid)) {
      continue;
    }
    captured.set(raw.uid, {
      // The folder we opened, not the path the server echoed back: applyToState refuses a mutation whose
      // source folder differs from the state's, so a server spelling the same mailbox differently would
      // fail every row in the batch while naming the same place.
      folder,
      uid: raw.uid,
      uid_validity: status.uid_validity,
      flags: [...raw.flags],
      labels: raw.labels === null ? null : [...raw.labels],
    });
  }
  return captured;
}

// Keys in a fixed order and sets sorted, so an unchanged mailbox state serializes byte-identically run to
// run and the journal can be diffed rather than re-parsed to tell whether anything moved.
export function serializeActionState(state: ActionStateSnapshot): string {
  return JSON.stringify({
    folder: requireFolder(state.folder),
    uid: requireUid(state.uid),
    uid_validity: state.uid_validity,
    flags: [...new Set(state.flags)].sort(),
    labels: state.labels === null ? null : [...new Set(state.labels)].sort(),
  });
}

// Null for anything unusable — absent column, malformed JSON, a snapshot written before this shape
// existed. Undo has to be able to tell "no recorded pre-state" from "pre-state with no labels", and a
// throw here would take down a bulk undo over one bad row.
export function parseActionState(raw: string | null): ActionStateSnapshot | null {
  if (raw === null || raw.length === 0) {
    return null;
  }
  try {
    const parsed = action_state_schema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
