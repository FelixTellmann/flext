import { describe, expect, test } from "bun:test";
import type { SendMailInput } from "@server/mail/send/smtp";
import type { UnsubscribeRequestDependencies } from "@server/mail/unsubscribe/bulk";
import { attemptUnsubscribe } from "@server/mail/unsubscribe/bulk";

const now = new Date("2026-09-07T05:00:00.000Z");

type Recorded = Parameters<UnsubscribeRequestDependencies["record"]>[0];

type Harness = {
  dependencies: UnsubscribeRequestDependencies;
  sent: SendMailInput[];
  posted: string[];
  recorded: Recorded[];
};

function harness(input: {
  one_click: Awaited<ReturnType<UnsubscribeRequestDependencies["loadOneClickSources"]>>;
  mailto: Awaited<ReturnType<UnsubscribeRequestDependencies["loadMailtoSources"]>>;
}): Harness {
  const sent: SendMailInput[] = [];
  const posted: string[] = [];
  const recorded: Recorded[] = [];
  return {
    sent,
    posted,
    recorded,
    dependencies: {
      loadOneClickSources: async () => input.one_click,
      loadMailtoSources: async () => input.mailto,
      performOneClick: async ({ url }) => {
        posted.push(url);
        return { status: "sent", response_code: 200, error: null };
      },
      send: async (mail) => {
        sent.push(mail);
        return { message_id: "<id@test>", accepted: [mail.to], rejected: [] };
      },
      record: async (row) => {
        recorded.push(row);
        return {
          method: row.method,
          status: row.status,
          response_code: row.response_code,
          error: row.error,
          attempted_at: row.attempted_at,
        };
      },
    },
  };
}

describe("attemptUnsubscribe", () => {
  test("a mailto-only sender is emailed and recorded as a mailto attempt", async () => {
    const { dependencies, sent, posted, recorded } = harness({
      one_click: [],
      mailto: [{ mailbox_id: "m2", list_unsubscribe: "<mailto:leave@list.example?subject=unsubscribe>" }],
    });

    const attempt = await attemptUnsubscribe("News@Sender.Example", now, dependencies);

    expect(posted).toHaveLength(0);
    expect(sent).toEqual([{ to: "leave@list.example", subject: "unsubscribe", text: "unsubscribe" }]);
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
    expect(attempt).toMatchObject({ method: "mailto", status: "sent" });
  });

  test("http wins over mailto when the sender offers both", async () => {
    const { dependencies, sent, posted, recorded } = harness({
      one_click: [
        {
          mailbox_id: "m1",
          list_unsubscribe: "<mailto:leave@list.example>, <https://list.example/one-click>",
          list_unsubscribe_post: "List-Unsubscribe=One-Click",
        },
      ],
      mailto: [{ mailbox_id: "m1", list_unsubscribe: "<mailto:leave@list.example>, <https://list.example/one-click>" }],
    });

    const attempt = await attemptUnsubscribe("news@sender.example", now, dependencies);

    expect(posted).toEqual(["https://list.example/one-click"]);
    expect(sent).toHaveLength(0);
    expect(recorded).toHaveLength(1);
    expect(attempt).toMatchObject({ method: "http", status: "sent", response_code: 200 });
  });

  test("a link without the one-click header and no mailto is skipped, nothing sent", async () => {
    const { dependencies, sent, posted, recorded } = harness({
      one_click: [],
      mailto: [{ mailbox_id: "m1", list_unsubscribe: "<https://list.example/unsubscribe>" }],
    });

    const attempt = await attemptUnsubscribe("news@sender.example", now, dependencies);

    expect(posted).toHaveLength(0);
    expect(sent).toHaveLength(0);
    expect(recorded).toHaveLength(1);
    expect(attempt).toMatchObject({ method: "http", status: "skipped" });
    expect(attempt.error).toContain("none carries a mailto target");
  });
});
