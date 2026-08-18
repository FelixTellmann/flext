export type MessageLocation = { kind: "gmail"; url: string } | { kind: "generic"; folder: string; message_id: string | null };

export function buildMessageLocation(input: {
  flavor: string;
  account_index: number | null;
  gm_thrid: string | null;
  folder: string;
  message_id: string | null;
}): MessageLocation {
  if (input.flavor !== "gmail" || input.gm_thrid === null) {
    return { kind: "generic", folder: input.folder, message_id: input.message_id };
  }

  // X-GM-THRID is a decimal 64-bit integer and the URL fragment expects hex; it exceeds
  // Number.MAX_SAFE_INTEGER, so BigInt is required — parseInt rounds and links to the wrong thread.
  const thread_hex = BigInt(input.gm_thrid).toString(16);
  return { kind: "gmail", url: `https://mail.google.com/mail/u/${input.account_index ?? 0}/#all/${thread_hex}` };
}
