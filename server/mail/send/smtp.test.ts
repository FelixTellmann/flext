import { expect, test } from "bun:test";
import type { MailboxConnection } from "@server/mail/mailbox";
import type Mail from "nodemailer/lib/mailer";
import type { SendMailDependencies, TransportLike } from "./smtp";
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

test("every SMTP timeout is under Bun's 10 s idle-socket close, because the digest awaits the send", () => {
  const options = buildTransportOptions(pinned_connection);

  expect(options.connectionTimeout).toBe(3_000);
  expect(options.greetingTimeout).toBe(3_000);
  expect(options.socketTimeout).toBe(5_000);
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

function fakeTransport(overrides: Partial<TransportLike> = {}): TransportLike & { sent: Mail.Options[]; closed: number } {
  const transport = {
    sent: [] as Mail.Options[],
    closed: 0,
    sendMail: async (options: Mail.Options) => {
      transport.sent.push(options);
      return { messageId: "<id@tellmann.co.za>", accepted: ["a@example.com", { name: "B", address: "b@example.com" }], rejected: [] };
    },
    close: () => {
      transport.closed += 1;
    },
    ...overrides,
  };
  return transport;
}

test("sendMail surfaces a loader failure without touching the network", async () => {
  const transport = fakeTransport();
  const dependencies: SendMailDependencies = {
    loadSender: () => Promise.reject(new Error("no sender row")),
    createTransport: () => transport,
  };

  await expect(sendMail({ to: "a@example.com", subject: "s", text: "t" }, dependencies)).rejects.toThrow("no sender row");
  expect(transport.sent).toHaveLength(0);
});

test("sendMail builds the transport from the sender row, sends the envelope, flattens addresses and closes", async () => {
  const transport = fakeTransport();
  const transport_options: Parameters<SendMailDependencies["createTransport"]>[0][] = [];
  const dependencies: SendMailDependencies = {
    loadSender: async () => pinned_connection,
    createTransport: (options) => {
      transport_options.push(options);
      return transport;
    },
  };

  const result = await sendMail({ to: "a@example.com, b@example.com", subject: "s", text: "t" }, dependencies);

  expect(result).toEqual({ message_id: "<id@tellmann.co.za>", accepted: ["a@example.com", "b@example.com"], rejected: [] });
  expect(transport_options).toHaveLength(1);
  expect(transport_options[0].host).toBe("mail.tellmann.co.za");
  expect(transport.sent).toEqual([
    { from: SENDER_ADDRESS, to: "a@example.com, b@example.com", subject: "s", text: "t", html: undefined, headers: undefined },
  ]);
  expect(transport.closed).toBe(1);
});

test("sendMail wraps a transport failure with the host and recipient, and still closes", async () => {
  const transport = fakeTransport({
    sendMail: async () => {
      throw new Error("421 try later");
    },
  });
  const dependencies: SendMailDependencies = { loadSender: async () => pinned_connection, createTransport: () => transport };

  await expect(sendMail({ to: "a@example.com", subject: "s", text: "t" }, dependencies)).rejects.toThrow(
    "smtp mail.tellmann.co.za:465 failed to send to a@example.com: 421 try later",
  );
  expect(transport.closed).toBe(1);
});
