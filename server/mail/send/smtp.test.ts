import { expect, test } from "bun:test";
import type { MailboxConnection } from "@server/mail/mailbox";
import { buildEnvelope, buildTransportOptions, SENDER_ADDRESS, sendMail } from "./smtp";

const pinned_connection: MailboxConnection = {
  host: "mail.tellmann.co.za",
  port: 993,
  username: "felix@tellmann.co.za",
  password: "secret",
  flavor: "generic",
  tls_policy: "pinned",
  pinned_spki: ["pinned-hash="],
};

function readTls(options: ReturnType<typeof buildTransportOptions>) {
  return options.tls as (typeof options)["tls"] & { autoSelectFamily?: boolean };
}

test("transport options use implicit TLS on 465 regardless of the stored IMAP port", () => {
  const options = buildTransportOptions(pinned_connection);

  expect(options.host).toBe("mail.tellmann.co.za");
  expect(options.port).toBe(465);
  expect(options.secure).toBe(true);
  expect(options.auth).toEqual({ user: "felix@tellmann.co.za", pass: "secret" });
});

test("pinned policy carries the SPKI check, servername and the dual-stack workaround", () => {
  const tls = readTls(buildTransportOptions(pinned_connection));

  expect(tls?.rejectUnauthorized).toBe(true);
  expect(tls?.servername).toBe("mail.tellmann.co.za");
  expect(typeof tls?.checkServerIdentity).toBe("function");
  expect(tls?.autoSelectFamily).toBe(false);
});

test("strict policy keeps the default hostname check", () => {
  const tls = readTls(buildTransportOptions({ ...pinned_connection, tls_policy: "strict", pinned_spki: [] }));

  expect(tls?.rejectUnauthorized).toBe(true);
  expect(tls?.servername).toBe("mail.tellmann.co.za");
  expect(tls?.checkServerIdentity).toBeUndefined();
});

test("envelope is always from the sender address and passes headers through", () => {
  const headers = { "List-Unsubscribe": "<mailto:leave@example.com>" };
  const envelope = buildEnvelope({ to: "leave@example.com", subject: "unsubscribe", text: "unsubscribe", headers });

  expect(envelope.from).toBe(SENDER_ADDRESS);
  expect(envelope.to).toBe("leave@example.com");
  expect(envelope.subject).toBe("unsubscribe");
  expect(envelope.text).toBe("unsubscribe");
  expect(envelope.html).toBeUndefined();
  expect(envelope.headers).toBe(headers);
});

test("sendMail surfaces a loader failure without touching the network", async () => {
  const loadSender = () => Promise.reject(new Error("no sender row"));

  await expect(sendMail({ to: "a@example.com", subject: "s", text: "t" }, { loadSender })).rejects.toThrow("no sender row");
});
