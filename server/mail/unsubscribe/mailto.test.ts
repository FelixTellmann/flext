import { describe, expect, test } from "bun:test";
import type { SendMailInput } from "@server/mail/send/smtp";
import type { MailtoDependencies } from "@server/mail/unsubscribe/mailto";
import { parseMailto, performMailtoUnsubscribe, pickMailtoTarget, unsubscribeMailtoSender } from "@server/mail/unsubscribe/mailto";

const now = new Date("2026-09-07T05:00:00.000Z");

function capturingSend(sent: SendMailInput[], rejected: string[] = []): MailtoDependencies["send"] {
  return async (input) => {
    sent.push(input);
    return { message_id: "<id@test>", accepted: [input.to], rejected };
  };
}

describe("parseMailto", () => {
  test("address only gets the default subject and body", () => {
    expect(parseMailto("mailto:leave@list.example")).toEqual({ to: "leave@list.example", subject: "unsubscribe", body: "unsubscribe" });
  });

  test("subject from the query, body defaulted", () => {
    expect(parseMailto("mailto:leave@list.example?subject=unsubscribe%20abc123")).toEqual({
      to: "leave@list.example",
      subject: "unsubscribe abc123",
      body: "unsubscribe",
    });
  });

  test("body from the query, subject defaulted, header names case-insensitive", () => {
    expect(parseMailto("mailto:leave@list.example?Body=stop%20sending")).toEqual({
      to: "leave@list.example",
      subject: "unsubscribe",
      body: "stop sending",
    });
  });

  test("percent-encoding is decoded and a plus stays a plus", () => {
    expect(parseMailto("mailto:un%2Bsub@list.example?subject=Unsubscribe%3A%20%22news%22&body=a%2Bb%0Aline2")).toEqual({
      to: "un+sub@list.example",
      subject: 'Unsubscribe: "news"',
      body: "a+b\nline2",
    });
  });

  test("only the first recipient is written to, the path before any to field", () => {
    expect(parseMailto("mailto:one@list.example,two@list.example?to=three@list.example")?.to).toBe("one@list.example");
    expect(parseMailto("mailto:?to=one@list.example,two@list.example")?.to).toBe("one@list.example");
    expect(parseMailto("mailto:one@list.example?to=not-an-address")?.to).toBe("one@list.example");
  });

  test("not a mailto, or no recipient, or a recipient that is not an address", () => {
    expect(parseMailto("https://list.example/unsubscribe")).toBeNull();
    expect(parseMailto("mailto:?subject=unsubscribe")).toBeNull();
    expect(parseMailto("mailto:not-an-address")).toBeNull();
  });

  test("a malformed percent sequence is left as written rather than thrown", () => {
    expect(parseMailto("mailto:leave@list.example?subject=100%")?.subject).toBe("100%");
  });
});

describe("performMailtoUnsubscribe", () => {
  test("sends the parsed request through the injected sender", async () => {
    const sent: SendMailInput[] = [];
    const outcome = await performMailtoUnsubscribe({
      mailto: "mailto:leave@list.example?subject=unsubscribe%20x",
      send: capturingSend(sent),
    });

    expect(outcome).toEqual({ status: "sent", error: null });
    expect(sent).toEqual([{ to: "leave@list.example", subject: "unsubscribe x", text: "unsubscribe" }]);
  });

  test("a sender that throws is failed with the message, nothing rethrown", async () => {
    const outcome = await performMailtoUnsubscribe({
      mailto: "mailto:leave@list.example",
      send: async () => {
        throw new Error("smtp mail.tellmann.co.za:465 failed to send to leave@list.example: timeout");
      },
    });

    expect(outcome.status).toBe("failed");
    expect(outcome.error).toContain("timeout");
  });

  test("a rejected recipient is failed even though nothing threw", async () => {
    const outcome = await performMailtoUnsubscribe({
      mailto: "mailto:leave@list.example",
      send: capturingSend([], ["leave@list.example"]),
    });

    expect(outcome).toEqual({ status: "failed", error: "smtp rejected leave@list.example" });
  });

  test("an unusable URL is failed without calling the sender", async () => {
    const sent: SendMailInput[] = [];
    const outcome = await performMailtoUnsubscribe({ mailto: "mailto:", send: capturingSend(sent) });

    expect(outcome.status).toBe("failed");
    expect(sent).toHaveLength(0);
  });
});

describe("pickMailtoTarget", () => {
  test("the first row with a mailto wins, http-only rows are passed over", () => {
    expect(
      pickMailtoTarget([
        { mailbox_id: "m1", list_unsubscribe: "<https://list.example/u>" },
        { mailbox_id: "m2", list_unsubscribe: "<https://list.example/u>, <mailto:leave@list.example>" },
      ]),
    ).toEqual({ mailbox_id: "m2", mailto: "mailto:leave@list.example" });
    expect(pickMailtoTarget([{ mailbox_id: "m1", list_unsubscribe: "<https://list.example/u>" }])).toBeNull();
  });
});

describe("unsubscribeMailtoSender", () => {
  test("sends and records a sent attempt with the mailbox that supplied the header", async () => {
    const sent: SendMailInput[] = [];
    const recorded: Parameters<MailtoDependencies["record"]>[0][] = [];
    const attempt = await unsubscribeMailtoSender(
      { from_address: "News@Sender.Example", now },
      {
        send: capturingSend(sent),
        loadSources: async () => [{ mailbox_id: "m2", list_unsubscribe: "<mailto:leave@list.example?subject=unsubscribe>" }],
        record: async (input) => {
          recorded.push(input);
          return {
            method: input.method,
            status: input.status,
            response_code: input.response_code,
            error: input.error,
            attempted_at: input.attempted_at,
          };
        },
      },
    );

    expect(sent).toHaveLength(1);
    expect(recorded).toEqual([
      {
        sender_address: "News@Sender.Example",
        mailbox_id: "m2",
        method: "mailto",
        status: "sent",
        response_code: null,
        error: null,
        attempted_at: now,
      },
    ]);
    expect(attempt.status).toBe("sent");
  });

  test("no mailto anywhere records skipped and sends nothing", async () => {
    const sent: SendMailInput[] = [];
    const attempt = await unsubscribeMailtoSender(
      { from_address: "news@sender.example", now },
      {
        send: capturingSend(sent),
        loadSources: async () => [{ mailbox_id: "m1", list_unsubscribe: "<https://list.example/u>" }],
        record: async (input) => ({
          method: input.method,
          status: input.status,
          response_code: input.response_code,
          error: input.error,
          attempted_at: input.attempted_at,
        }),
      },
    );

    expect(sent).toHaveLength(0);
    expect(attempt).toMatchObject({ method: "mailto", status: "skipped" });
    expect(attempt.error).toContain("no message from this sender carries a mailto");
  });
});
