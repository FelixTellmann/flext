import type { ActionStateSnapshot } from "@server/mail/actions/state";
import { parseActionState } from "@server/mail/actions/state";

// Where an action's message lives NOW, which is not always the row the action names.
//
// `Message` carries two unique keys: (mailboxId, folder, uidValidity, uid) and (mailboxId, gmMsgid).
//   - On Gmail, archiving drops the \Inbox label. The message stays in [Gmail]/All Mail with a stable
//     UID and gmMsgid, so the sync UPDATES the same row and Action.messageId still addresses it.
//   - On generic IMAP, archiving is a folder move. The new (folder, uid) matches no existing row, so the
//     sync INSERTS a new one and reconciliation stamps disappearedAt on the old. Action.messageId now
//     points at a dead row whose openedAt can never change again.
//
// A detector that joined on Action.messageId would therefore work on the three Gmail mailboxes and be
// permanently silent on felix@tellmann.co.za, which holds two thirds of the mail. It would look correct.
//
// to_state_json records the destination the SERVER confirmed — folder, uid and uidValidity, captured
// from COPYUID precisely so a moved message stays addressable (§7.2). That is the address to use. The
// messageId fallback is for the un-moved case, where to_state_json is absent or the mutation was a label
// edit that left the row where it was.
export type MessageAddress = { by: "address"; folder: string; uid: number; uid_validity: string } | { by: "row"; message_id: string };

export function messageAddressForAction(input: { message_id: string; to_state_json: string | null }): MessageAddress {
  const to_state: ActionStateSnapshot | null = parseActionState(input.to_state_json);
  if (to_state === null) {
    return { by: "row", message_id: input.message_id };
  }
  return { by: "address", folder: to_state.folder, uid: to_state.uid, uid_validity: to_state.uid_validity };
}
