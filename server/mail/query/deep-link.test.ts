import { describe, expect, test } from "bun:test";
import { buildMessageLocation } from "@server/mail/query/deep-link";

describe("buildMessageLocation", () => {
  test("converts a 64-bit thread id without losing precision", () => {
    const location = buildMessageLocation({
      flavor: "gmail",
      account_index: 2,
      gm_thrid: "1839203948573920184",
      folder: "[Gmail]/All Mail",
      message_id: null,
    });
    expect(location).toEqual({ kind: "gmail", url: "https://mail.google.com/mail/u/2/#all/19862a3f283e8bb8" });
  });

  test("defaults a missing account index to 0", () => {
    const location = buildMessageLocation({ flavor: "gmail", account_index: null, gm_thrid: "255", folder: "x", message_id: null });
    expect(location).toEqual({ kind: "gmail", url: "https://mail.google.com/mail/u/0/#all/ff" });
  });

  test("falls back to folder and Message-ID for generic IMAP", () => {
    const location = buildMessageLocation({
      flavor: "generic",
      account_index: null,
      gm_thrid: null,
      folder: "INBOX.Finances - Ref",
      message_id: "<abc@example.com>",
    });
    expect(location).toEqual({ kind: "generic", folder: "INBOX.Finances - Ref", message_id: "<abc@example.com>" });
  });
});
