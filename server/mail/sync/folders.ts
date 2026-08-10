import type { FolderInfo } from "@server/mail/providers/types";
import type { MailboxFlavor } from "@server/mail/types";
import { GMAIL_CANONICAL_FOLDER } from "@server/mail/types";

export function selectSyncFolders(input: { flavor: MailboxFlavor; folders: FolderInfo[] }): string[] {
  if (input.flavor === "gmail") {
    // Per-label folders are never walked: the same message appears in INBOX, the label folder and All Mail
    // with three different UIDs, which would triple every sender count downstream (§4.1).
    return [GMAIL_CANONICAL_FOLDER];
  }
  return input.folders.filter((folder) => folder.selectable).map((folder) => folder.path);
}

export function selectSentFolders(folders: FolderInfo[]): string[] {
  return folders.filter((folder) => folder.selectable && folder.special_use === "\\Sent").map((folder) => folder.path);
}
