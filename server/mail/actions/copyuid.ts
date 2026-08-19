// RFC 4315 §3: a batched UID MOVE (or COPY, under UIDPLUS) issued against a UID *set* returns exactly one
// COPYUID response code carrying the source set and the destination set as they arrived on the wire, not
// one code per message. The two sets are guaranteed to enumerate the same messages in the same order, so
// pairing element N of one with element N of the other is the only thing that recovers which message landed
// at which destination UID. Sorting either set, or expanding out of the order the server sent, breaks that
// pairing silently — the executor would then journal a plausible-looking but wrong destination UID, and undo
// would later mutate a message the operator never touched.

// The two uid-set captures stop at whitespace or the response code's closing "]", but otherwise accept any
// character, not just digits/colons/commas: a malformed set (a stray letter, say) must fail inside
// expandUidSet with a token-level message, not be swallowed here as "no COPYUID code found", which would
// point at the wrong bug.
const COPYUID_PATTERN = /COPYUID\s+(\d+)\s+([^\s\]]+)\s+([^\s\]]+)/i;
const UID_TOKEN_PATTERN = /^(\d+)(?::(\d+))?$/;

export type ParsedCopyUid = {
  uidvalidity: number;
  source_set: number[];
  destination_set: number[];
};

export type UidPair = {
  source_uid: number;
  destination_uid: number;
};

function expandUidSet(raw: string): number[] {
  if (raw.length === 0) {
    return [];
  }

  const uids: number[] = [];
  for (const token of raw.split(",")) {
    const match = UID_TOKEN_PATTERN.exec(token);
    if (match === null) {
      throw new Error(`"${token}" in uid-set "${raw}" is not a UID or a UID range (RFC 3501 uid-set)`);
    }

    const [, start_raw, end_raw] = match as unknown as [string, string, string | undefined];
    const start = Number(start_raw);
    if (end_raw === undefined) {
      uids.push(start);
      continue;
    }

    // A range is expanded step by step rather than sorted into ascending order first: RFC 3501 does not
    // require start <= end, and preserving whichever direction the server sent is what keeps this token's
    // contribution aligned with the same-length range on the other side of the COPYUID pair.
    const end = Number(end_raw);
    const step = end >= start ? 1 : -1;
    for (let uid = start; step > 0 ? uid <= end : uid >= end; uid += step) {
      uids.push(uid);
    }
  }
  return uids;
}

export function parseCopyUid(response: string): ParsedCopyUid {
  const match = COPYUID_PATTERN.exec(response);
  if (match === null) {
    throw new Error(
      `no COPYUID response code found in "${response}". RFC 4315 requires one on every successful UIDPLUS MOVE/COPY; without it the destination UID is unknowable and undo has nothing to record.`,
    );
  }

  const [, uidvalidity_raw, source_raw, destination_raw] = match as unknown as [string, string, string, string];
  return {
    uidvalidity: Number(uidvalidity_raw),
    source_set: expandUidSet(source_raw),
    destination_set: expandUidSet(destination_raw),
  };
}

export function zipCopyUid(source_set: number[], destination_set: number[]): UidPair[] {
  if (source_set.length !== destination_set.length) {
    throw new Error(
      `COPYUID source set has ${source_set.length} UID(s) but the destination set has ${destination_set.length}. Zipping mismatched sets would pair a source UID with the wrong destination and leave undo holding an address that does not exist, so this is a hard error rather than a truncated zip.`,
    );
  }

  return source_set.map((source_uid, index) => ({ source_uid, destination_uid: destination_set[index] }));
}
