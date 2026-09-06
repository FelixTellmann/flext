import { describe, expect, test } from "bun:test";
import { verifyDigestLink } from "@server/mail/digest/links";
import type { DigestSender } from "@server/mail/digest/query";
import type { DigestSendDependencies } from "@server/mail/digest/send";
import { sendDigest } from "@server/mail/digest/send";
import type { SendMailInput } from "@server/mail/send/smtp";

const SECRET = "0123456789abcdef0123456789abcdef";
const now = new Date("2026-09-07T05:00:00.000Z");

const sender: DigestSender = {
  from_address: "news@sender.example",
  from_domain: "sender.example",
  mailbox_labels: ["Tellmann"],
  unopened: 12,
  oldest: new Date("2026-07-03T09:00:00.000Z"),
  newest: new Date("2026-09-01T09:00:00.000Z"),
  rule: null,
  one_click: true,
  mailto: false,
};

function dependencies(senders: DigestSender[], sent: SendMailInput[], rejected: string[] = []): DigestSendDependencies {
  return {
    listSenders: async () => senders,
    send: async (input) => {
      sent.push(input);
      return { message_id: "<id@test>", accepted: [input.to], rejected };
    },
    secret: SECRET,
    origin: "https://flext.dev",
  };
}

describe("sendDigest", () => {
  test("sends one email to the operator with signed links for each sender", async () => {
    const sent: SendMailInput[] = [];
    const result = await sendDigest({ now }, dependencies([sender], sent));

    expect(result).toEqual({ sent: true, senders: 1 });
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("felix@tellmann.co.za");
    expect(sent[0].subject).toContain("1 sender");
    expect(sent[0].text).toContain("news@sender.example");

    const tokens = [...sent[0].text.matchAll(/token=([^\s&]+)/g)].map((match) => decodeURIComponent(match[1]));
    expect(tokens).toHaveLength(2);
    expect(tokens.map((token) => verifyDigestLink(token, { secret: SECRET, now }))).toEqual([
      { ok: true, payload: { action: "unsubscribe", address: "news@sender.example", expires_at: "2026-09-21T05:00:00.000Z" } },
      { ok: true, payload: { action: "file", address: "news@sender.example", expires_at: "2026-09-21T05:00:00.000Z" } },
    ]);
  });

  test("an empty list sends nothing", async () => {
    const sent: SendMailInput[] = [];

    expect(await sendDigest({ now }, dependencies([], sent))).toEqual({ sent: false, senders: 0 });
    expect(sent).toHaveLength(0);
  });

  test("no secret is an error before anything is queried", async () => {
    const sent: SendMailInput[] = [];

    await expect(sendDigest({ now }, { ...dependencies([sender], sent), secret: undefined })).rejects.toThrow("SCRIPT_SECRET");
    expect(sent).toHaveLength(0);
  });

  test("a rejected recipient is an error, not a sent: true", async () => {
    await expect(sendDigest({ now }, dependencies([sender], [], ["felix@tellmann.co.za"]))).rejects.toThrow("rejected");
  });
});
