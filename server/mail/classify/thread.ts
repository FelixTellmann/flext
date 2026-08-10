export function deriveThreadKey(input: {
  gm_thrid: string | null;
  references: string | null;
  in_reply_to: string | null;
  message_id: string | null;
}): string | null {
  if (input.gm_thrid !== null) {
    return input.gm_thrid;
  }
  const root_reference = (input.references ?? "").match(/<[^<>]+>/)?.[0] ?? null;
  return root_reference ?? input.in_reply_to ?? input.message_id;
}
