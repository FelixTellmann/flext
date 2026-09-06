import { describe, expect, test } from "bun:test";
import type { DigestRow } from "@server/mail/digest/render";
import { formatDigestDate, offersUnsubscribe, renderDigest } from "@server/mail/digest/render";

const now = new Date("2026-09-07T05:00:00.000Z");
const expires_at = new Date("2026-09-21T05:00:00.000Z");

const one_click_row: DigestRow = {
  from_address: "news@sender.example",
  from_domain: "sender.example",
  mailbox_labels: ["Tellmann", "Gmail"],
  unopened: 12,
  oldest: new Date("2026-07-03T09:00:00.000Z"),
  newest: new Date("2026-09-01T09:00:00.000Z"),
  rule: null,
  one_click: true,
  mailto: false,
  links: { unsubscribe: "https://flext.dev/api/digest-link?token=UNSUB.1", file: "https://flext.dev/api/digest-link?token=FILE.1" },
};

const headerless_row: DigestRow = {
  ...one_click_row,
  from_address: "alerts@<other>.example",
  from_domain: "other.example",
  mailbox_labels: ["Gmail"],
  unopened: 1,
  rule: { action: "archive", autonomy: "shadow", suspended: false },
  one_click: false,
  mailto: false,
  links: { unsubscribe: "https://flext.dev/api/digest-link?token=UNSUB.2", file: "https://flext.dev/api/digest-link?token=FILE.2" },
};

describe("renderDigest", () => {
  const rendered = renderDigest({ rows: [one_click_row, headerless_row], now, expires_at });

  test("subject carries the date and the count", () => {
    expect(rendered.subject).toBe("Mail digest 7 Sep 2026: 2 senders unread for 30 days");
  });

  test("text has the address, the count, the oldest date, the labels and both links", () => {
    expect(rendered.text).toContain("news@sender.example");
    expect(rendered.text).toContain("12 unopened emails since 3 Jul 2026, in Tellmann and Gmail.");
    expect(rendered.text).toContain("Unsubscribe: https://flext.dev/api/digest-link?token=UNSUB.1");
    expect(rendered.text).toContain("File: https://flext.dev/api/digest-link?token=FILE.1");
    expect(rendered.text).toContain("work until 21 Sep 2026");
  });

  test("a sender with no unsubscribe route gets File only, and its rule is named", () => {
    expect(rendered.text).toContain("1 unopened email since 3 Jul 2026, in Gmail. Has a watch-only archive rule.");
    expect(rendered.text).not.toContain("token=UNSUB.2");
    expect(rendered.text).toContain("token=FILE.2");
    expect(offersUnsubscribe(headerless_row)).toBe(false);
    expect(offersUnsubscribe({ ...headerless_row, mailto: true })).toBe(true);
  });

  test("html escapes the address and carries both links as anchors", () => {
    expect(rendered.html).toContain("alerts@&lt;other&gt;.example");
    expect(rendered.html).not.toContain("alerts@<other>");
    expect(rendered.html).toContain('href="https://flext.dev/api/digest-link?token=UNSUB.1"');
    expect(rendered.html).toContain('href="https://flext.dev/api/digest-link?token=FILE.1"');
    expect(rendered.html).not.toContain("token=UNSUB.2");
  });

  test("no em dash anywhere in outbound mail", () => {
    expect(rendered.subject).not.toContain("—");
    expect(rendered.text).not.toContain("—");
    expect(rendered.html).not.toContain("—");
  });

  test("singular subject and a suspended rule", () => {
    const single = renderDigest({
      rows: [{ ...headerless_row, rule: { action: "trash", autonomy: "auto", suspended: true } }],
      now,
      expires_at,
    });

    expect(single.subject).toBe("Mail digest 7 Sep 2026: 1 sender unread for 30 days");
    expect(single.text).toContain("Has a suspended trash rule.");
  });
});

test("formatDigestDate is UTC and short-month", () => {
  expect(formatDigestDate(new Date("2026-01-31T23:30:00.000Z"))).toBe("31 Jan 2026");
});
