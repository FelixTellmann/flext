import { LOGICAL_SEPARATOR } from "@server/mail/filing/paths";
import type { FolderInfo } from "@server/mail/providers/types";

const INBOX = "INBOX";

// Where a new user folder belongs on this server. On felix@tellmann.co.za every user folder lives under
// "INBOX." — INBOX.KidsLiving, INBOX.Finances - Ref, INBOX.Sent — so a folder rendered as
// "Clients.KidsLiving" would be created as a SIBLING of INBOX rather than inside it, which is a
// different mailbox from the one the operator's thirteen existing folders live in. On Gmail the folder
// list is "INBOX" and "[Gmail]/All Mail", which is not INBOX-rooted, and a new label belongs at the top
// level.
//
// Derived from the server's own LIST output rather than from the flavour: this is a namespace fact, and
// a generic IMAP server may be either shape. Returns null for "top level", which is a determination and
// not a failure — the caller only has to refuse when there is no folder list at all to reason from.
export function findNamespaceRoot(folders: FolderInfo[], delimiter: string): string | null {
  const selectable = folders.filter((folder) => folder.selectable && folder.path.length > 0);
  if (selectable.length === 0) {
    throw new Error(
      "the server returned no selectable folders, so there is no evidence for where a new folder belongs. Refusing rather than guessing a namespace: creating a filing folder in the wrong namespace puts mail somewhere the operator's mail client does not show it.",
    );
  }

  const prefix = `${INBOX}${delimiter}`;
  const all_inbox_rooted = selectable.every((folder) => folder.path === INBOX || folder.path.startsWith(prefix));
  return all_inbox_rooted ? INBOX : null;
}

// The logical path's separator is replaced by the server's delimiter, never the other way round. §6 calls
// this out and the live data confirms it: hardcoding "/" produces a literal folder named "Clients/Acme"
// on a dot-delimited server, and felix@tellmann.co.za is dot-delimited.
//
// A segment containing the server's own delimiter would inject hierarchy the logical path never asked
// for, so it is refused rather than escaped — there is no portable escape, and the fix belongs in the
// policy that named the segment.
export function renderFolderPath(input: { logical_path: string; delimiter: string; namespace_root: string | null }): string {
  if (input.delimiter.length === 0) {
    throw new Error(
      "the mailbox has no hierarchy delimiter, so a multi-segment logical path cannot be rendered. Mailbox.hierarchyDelimiter is populated at sync time from the LIST response; an empty one means the mailbox was never synced.",
    );
  }

  const segments = input.logical_path.split(LOGICAL_SEPARATOR).filter((segment) => segment.length > 0);
  if (segments.length === 0) {
    throw new Error(`the logical path "${input.logical_path}" has no segments, so there is no folder to render.`);
  }

  for (const segment of segments) {
    if (segment.includes(input.delimiter)) {
      throw new Error(
        `the path segment "${segment}" contains this server's hierarchy delimiter "${input.delimiter}", so rendering it would create folder levels the logical path never named. Rename the client or topic on the sender policy.`,
      );
    }
  }

  const rooted = input.namespace_root === null ? segments : [input.namespace_root, ...segments];
  return rooted.join(input.delimiter);
}
