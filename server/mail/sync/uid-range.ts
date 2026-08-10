export function buildUidRange(last_seen_uid: number): string {
  return `${last_seen_uid + 1}:*`;
}

export function dropStaleUids<T extends { uid: number }>(items: T[], last_seen_uid: number): T[] {
  // RFC 3501 range semantics: when <last_seen_uid + 1> is past the highest UID present, the server still
  // returns the highest-UID message. Without this filter the newest message is reprocessed on all 96 runs
  // a day (§4.2).
  return items.filter((item) => item.uid > last_seen_uid);
}

export function highestUid(items: Array<{ uid: number }>, fallback: number): number {
  return items.reduce((highest, item) => (item.uid > highest ? item.uid : highest), fallback);
}

export function batchUidRanges(input: { uid_next: number; batch_size: number }): string[] {
  const ranges: string[] = [];
  const highest = input.uid_next - 1;
  for (let start = 1; start <= highest; start += input.batch_size) {
    const end = Math.min(start + input.batch_size - 1, highest);
    ranges.push(`${start}:${end}`);
  }
  return ranges;
}
