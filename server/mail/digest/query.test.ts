import { describe, expect, test } from "bun:test";
import type { DigestHeaderRow, DigestSenderRow } from "@server/mail/digest/query";
import { assembleDigestSenders } from "@server/mail/digest/query";
import type { PolicyIndex, PolicyRow } from "@server/mail/query/policies";

const policy = (overrides: Partial<PolicyRow>): PolicyRow => ({
  id: "p1",
  scope: "address",
  value: "news@sender.example",
  action: "archive",
  client: null,
  topic: null,
  mark_read: true,
  autonomy: "shadow",
  autonomy_promoted_at: null,
  source: "operator",
  suspended_at: null,
  suspension_reason: null,
  createdAt: new Date("2026-08-01T00:00:00.000Z"),
  updatedAt: new Date("2026-08-01T00:00:00.000Z"),
  ...overrides,
});

const empty_index: PolicyIndex = { by_address: new Map(), by_domain: new Map(), never_touch: [], suppressed: new Set() };

const rows: DigestSenderRow[] = [
  {
    from_address: "News@Sender.Example",
    from_domain: "sender.example",
    mailbox_labels: "Gmail|Tellmann",
    unopened: 12,
    oldest: new Date("2026-07-03T09:00:00.000Z"),
    newest: new Date("2026-09-01T09:00:00.000Z"),
  },
  {
    from_address: "alerts@other.example",
    from_domain: null,
    mailbox_labels: "Gmail",
    unopened: 3,
    oldest: new Date("2026-06-01T09:00:00.000Z"),
    newest: new Date("2026-08-01T09:00:00.000Z"),
  },
];

const headers: DigestHeaderRow[] = [
  {
    from_address: "news@sender.example",
    list_unsubscribe: "<https://sender.example/u?x=1>, <mailto:leave@sender.example>",
    list_unsubscribe_post: "List-Unsubscribe=One-Click",
  },
];

describe("assembleDigestSenders", () => {
  test("labels split, counts numeric, header parsed, missing header means neither route", () => {
    const [first, second] = assembleDigestSenders({ rows, headers, policy_index: empty_index });

    expect(first).toEqual({
      from_address: "News@Sender.Example",
      from_domain: "sender.example",
      mailbox_labels: ["Gmail", "Tellmann"],
      unopened: 12,
      oldest: new Date("2026-07-03T09:00:00.000Z"),
      newest: new Date("2026-09-01T09:00:00.000Z"),
      rule: null,
      one_click: true,
      mailto: true,
    });
    expect(second).toMatchObject({ from_domain: "", mailbox_labels: ["Gmail"], unopened: 3, rule: null, one_click: false, mailto: false });
  });

  test("an http target without the one-click header is not one_click", () => {
    const [first] = assembleDigestSenders({ rows, headers: [{ ...headers[0], list_unsubscribe_post: null }], policy_index: empty_index });

    expect(first.one_click).toBe(false);
    expect(first.mailto).toBe(true);
  });

  test("the rule comes from the address first, then the domain, with suspension carried", () => {
    const by_domain = new Map([
      ["sender.example", policy({ scope: "domain", value: "sender.example", action: "file", suspended_at: new Date() })],
    ]);
    const [via_domain] = assembleDigestSenders({ rows, headers, policy_index: { ...empty_index, by_domain } });
    expect(via_domain.rule).toEqual({ action: "file", autonomy: "shadow", suspended: true });

    const by_address = new Map([["news@sender.example", policy({})]]);
    const [via_address] = assembleDigestSenders({ rows, headers, policy_index: { ...empty_index, by_address, by_domain } });
    expect(via_address.rule).toEqual({ action: "archive", autonomy: "shadow", suspended: false });
  });
});
