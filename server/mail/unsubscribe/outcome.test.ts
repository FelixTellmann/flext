import { describe, expect, test } from "bun:test";
import { dedupeAddresses, pickOneClickTarget, summarizeSenderArchive } from "@server/mail/unsubscribe/outcome";

describe("pickOneClickTarget", () => {
  test("takes the newest message that carries the header and an http link", () => {
    const target = pickOneClickTarget([
      { mailbox_id: "m1", list_unsubscribe: "<mailto:off@example.com>", list_unsubscribe_post: "List-Unsubscribe=One-Click" },
      { mailbox_id: "m2", list_unsubscribe: "<https://example.com/out/2>", list_unsubscribe_post: "List-Unsubscribe=One-Click" },
      { mailbox_id: "m3", list_unsubscribe: "<https://example.com/out/3>", list_unsubscribe_post: "List-Unsubscribe=One-Click" },
    ]);

    expect(target).toEqual({ mailbox_id: "m2", url: "https://example.com/out/2" });
  });

  test("a link without the header is not a target — the POST would be a GET-shaped page ignoring a body", () => {
    expect(
      pickOneClickTarget([{ mailbox_id: "m1", list_unsubscribe: "<https://example.com/out>", list_unsubscribe_post: null }]),
    ).toBeNull();
  });

  test("nothing to pick from", () => {
    expect(pickOneClickTarget([])).toBeNull();
  });
});

describe("summarizeSenderArchive", () => {
  test("archived is what applied; failed is every executed row that did not", () => {
    const summary = summarizeSenderArchive({
      counts: { pending: 3, waiting: 4, retried: 2, refused: 1 },
      pending_action_ids: ["a", "b", "c"],
      statuses: new Map([
        ["a", "applied"],
        ["b", "failed"],
        ["c", "pending"],
      ]),
    });

    expect(summary).toEqual({ archived: 1, failed: 2, waiting: 4, retried: 2, refused: 1 });
  });

  test("a sender with nothing to execute reports zeros and its waiting/refused counts", () => {
    const summary = summarizeSenderArchive({
      counts: { pending: 0, waiting: 0, retried: 0, refused: 2 },
      pending_action_ids: [],
      statuses: new Map(),
    });

    expect(summary).toEqual({ archived: 0, failed: 0, waiting: 0, retried: 0, refused: 2 });
  });
});

describe("dedupeAddresses", () => {
  test("collapses case and whitespace variants, keeps the first spelling, drops blanks", () => {
    expect(dedupeAddresses(["News@Example.com", " news@example.com", "", "other@example.com"])).toEqual([
      "News@Example.com",
      "other@example.com",
    ]);
  });
});
