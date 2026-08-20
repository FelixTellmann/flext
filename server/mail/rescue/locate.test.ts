import { describe, expect, test } from "bun:test";
import type { ActionStateSnapshot } from "@server/mail/actions/state";
import { serializeActionState } from "@server/mail/actions/state";
import { messageAddressForAction } from "@server/mail/rescue/locate";

const UID_VALIDITY = "38504";

function toStateJson(overrides: Partial<ActionStateSnapshot> = {}): string {
  const state: ActionStateSnapshot = {
    folder: "Archive",
    uid: 42,
    uid_validity: UID_VALIDITY,
    flags: [],
    labels: null,
    ...overrides,
  };
  return serializeActionState(state);
}

describe("messageAddressForAction", () => {
  test("a recorded move resolves to the recorded folder/uid/uidValidity", () => {
    const address = messageAddressForAction({
      message_id: "row-1",
      to_state_json: toStateJson({ folder: "Archive", uid: 91, uid_validity: UID_VALIDITY }),
    });
    expect(address).toEqual({ by: "address", folder: "Archive", uid: 91, uid_validity: UID_VALIDITY });
  });

  test("no to_state_json falls back to the row id", () => {
    const address = messageAddressForAction({ message_id: "row-2", to_state_json: null });
    expect(address).toEqual({ by: "row", message_id: "row-2" });
  });

  test("malformed to_state_json falls back rather than throwing", () => {
    const address = messageAddressForAction({ message_id: "row-3", to_state_json: "{not json" });
    expect(address).toEqual({ by: "row", message_id: "row-3" });
  });

  // The hazard this task exists for: on generic IMAP, archiving is a folder MOVE — the new (folder, uid)
  // matches no existing Message row, so a detector that fell back to the action's row id here would read a
  // dead row forever on felix@tellmann.co.za while looking correct on the three Gmail mailboxes.
  test("a generic-flavour archive whose to_state_json names a different folder returns the new address, not the row id", () => {
    const address = messageAddressForAction({
      message_id: "row-4",
      to_state_json: toStateJson({ folder: "Archive", uid: 517, uid_validity: UID_VALIDITY }),
    });
    expect(address).not.toEqual({ by: "row", message_id: "row-4" });
    expect(address).toEqual({ by: "address", folder: "Archive", uid: 517, uid_validity: UID_VALIDITY });
  });
});
