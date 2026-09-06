import { expect, test } from "bun:test";
import type { MessageIdentity } from "@server/mail/providers/types";
import type { RekeyOccupant, RekeyRow } from "./rekey";
import { planRekey } from "./rekey";

function identity(uid: number, message_id: string): MessageIdentity {
  return { uid, gm_msgid: null, message_id };
}

function row(id: string, stable_key: string | null): RekeyRow {
  return { id, stable_key };
}

function occupant(id: string, uid: number, stable_key: string | null, vanished = true): RekeyOccupant {
  return { id, uid, stable_key, vanished };
}

test("rows are moved to the UID that carries their stable key; the rest disappear", () => {
  const plan = planRekey({
    rows: [row("a", "<a>"), row("b", "<b>"), row("c", "<c>"), row("no-key", null)],
    identities: [identity(10, "<a>"), identity(11, "<b>"), identity(12, "<unknown>")],
    occupants: [],
    gmail: false,
  });

  expect(plan.moves).toEqual([
    { row_id: "a", uid: 10 },
    { row_id: "b", uid: 11 },
  ]);
  expect(plan.resurrected).toEqual([]);
  expect(plan.disappeared).toEqual(["c", "no-key"]);
});

test("a validity the server hands back: the vanished row at the target key is resurrected, the copy retired", () => {
  // felix@tellmann.co.za, 2026-09-06: row `old-40233` was marked vanished by the earlier re-key onto the
  // rebuilt validity, and `new-587` was written under that validity. The server then reverted to the
  // original validity with UID 40233 in place.
  const plan = planRekey({
    rows: [row("new-587", "<link>"), row("new-900", "<other>")],
    identities: [identity(40233, "<link>"), identity(50000, "<other>")],
    occupants: [occupant("old-40233", 40233, "<link>")],
    gmail: false,
  });

  expect(plan.moves).toEqual([{ row_id: "new-900", uid: 50000 }]);
  expect(plan.resurrected).toEqual(["old-40233"]);
  expect(plan.disappeared).toEqual(["new-587"]);
});

test("a live occupant with the same key is left alone and the copy still retires", () => {
  const plan = planRekey({
    rows: [row("copy", "<m>")],
    identities: [identity(7, "<m>")],
    occupants: [occupant("original", 7, "<m>", false)],
    gmail: false,
  });

  expect(plan.moves).toEqual([]);
  expect(plan.resurrected).toEqual([]);
  expect(plan.disappeared).toEqual(["copy"]);
});

test("an occupant holding a different message at that UID is neither moved onto nor revived", () => {
  const plan = planRekey({
    rows: [row("r", "<m>")],
    identities: [identity(7, "<m>")],
    occupants: [occupant("stale", 7, "<something-else>")],
    gmail: false,
  });

  expect(plan.moves).toEqual([]);
  expect(plan.resurrected).toEqual([]);
  expect(plan.disappeared).toEqual(["r"]);
});

test("a message listed twice by the server lands at its last UID, and an occupied earlier UID is revived", () => {
  // The same Message-ID at 40233 and 40234 on the server; 40233's old row was marked vanished.
  const plan = planRekey({
    rows: [row("r", "<dup>")],
    identities: [identity(40233, "<dup>"), identity(40234, "<dup>")],
    occupants: [occupant("old-40233", 40233, "<dup>")],
    gmail: false,
  });

  expect(plan.moves).toEqual([{ row_id: "r", uid: 40234 }]);
  expect(plan.resurrected).toEqual(["old-40233"]);
  expect(plan.disappeared).toEqual([]);
});

test("a second pass after an interrupted re-key finds nothing left to move and throws nothing", () => {
  // Rows already relocated by the first pass are occupants now, matched to the same identities.
  const plan = planRekey({
    rows: [],
    identities: [identity(10, "<a>"), identity(11, "<b>")],
    occupants: [occupant("a", 10, "<a>", false), occupant("b", 11, "<b>", false)],
    gmail: false,
  });

  expect(plan).toEqual({ moves: [], resurrected: [], disappeared: [] });
});

test("gmail keys on X-GM-MSGID, not Message-ID", () => {
  const plan = planRekey({
    rows: [row("g", "gm-1")],
    identities: [{ uid: 3, gm_msgid: "gm-1", message_id: "<ignored>" }],
    occupants: [],
    gmail: true,
  });

  expect(plan.moves).toEqual([{ row_id: "g", uid: 3 }]);
});
