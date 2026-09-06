import { serverEnv } from "@server/env";
import { buildDigestLinks, DIGEST_LINK_TTL_MS, SITE_ORIGIN } from "@server/mail/digest/links";
import type { DigestSender } from "@server/mail/digest/query";
import { listDigestSenders } from "@server/mail/digest/query";
import { renderDigest } from "@server/mail/digest/render";
import { SENDER_ADDRESS, sendMail } from "@server/mail/send/smtp";
import type { SendLike } from "@server/mail/unsubscribe/mailto";

export type DigestSendDependencies = {
  listSenders: (input: { now: Date }) => Promise<DigestSender[]>;
  send: SendLike;
  secret: string | undefined;
  origin: string;
};

export type DigestSendResult = { sent: boolean; senders: number };

// Resolved per call, not at import: serverEnv() is lazy for the same reason every route reads it lazily.
function liveDependencies(): DigestSendDependencies {
  return { listSenders: listDigestSenders, send: sendMail, secret: serverEnv().SCRIPT_SECRET, origin: SITE_ORIGIN };
}

// An empty digest is not sent: "nothing is reaching you unread" is the absence of the Monday email, and
// a weekly message saying so would train the operator to ignore the ones that matter.
export async function sendDigest(
  input: { now: Date },
  dependencies: DigestSendDependencies = liveDependencies(),
): Promise<DigestSendResult> {
  if (dependencies.secret === undefined) {
    throw new Error("SCRIPT_SECRET is not configured, digest links cannot be signed");
  }
  const secret = dependencies.secret;

  const senders = await dependencies.listSenders({ now: input.now });
  if (senders.length === 0) {
    return { sent: false, senders: 0 };
  }

  const rows = senders.map((sender) => ({
    ...sender,
    links: buildDigestLinks({ address: sender.from_address, now: input.now, secret, origin: dependencies.origin }),
  }));
  const rendered = renderDigest({ rows, now: input.now, expires_at: new Date(input.now.getTime() + DIGEST_LINK_TTL_MS) });

  const result = await dependencies.send({ to: SENDER_ADDRESS, subject: rendered.subject, text: rendered.text, html: rendered.html });
  if (result.rejected.length > 0) {
    throw new Error(`smtp rejected the digest for ${result.rejected.join(", ")}`);
  }

  return { sent: true, senders: senders.length };
}
