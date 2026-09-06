import { describe, expect, test } from "bun:test";
import { decodeEncodedWords, parseListUnsubscribe } from "@server/mail/unsubscribe/parse";

describe("parseListUnsubscribe", () => {
  test("takes the https link when the sender offers one", () => {
    const target = parseListUnsubscribe("<https://wakatime.com/billing/unsubscribe/9a35>");

    expect(target.http).toBe("https://wakatime.com/billing/unsubscribe/9a35");
    expect(target.mailto).toBeNull();
  });

  test("keeps both when both are offered, and they stay distinguishable", () => {
    // 175 of a 600-message sample carry both. The caller prefers http; the mailto is kept rather than
    // dropped so a sender offering only that route is still visible as unsubscribable.
    const target = parseListUnsubscribe("<mailto:unsub@example.com>, <https://example.com/out>");

    expect(target.http).toBe("https://example.com/out");
    expect(target.mailto).toBe("mailto:unsub@example.com");
  });

  test("decodes an RFC 2047 header, which a quarter of them are", () => {
    // Verbatim shape from felix@tellmann.co.za. A parser that ignored these would report ~24% of the
    // operator's newsletters as having no way to unsubscribe.
    const raw = "=?us-ascii?Q?=3Chttps=3A=2F=2Fwww=2Efoundersintech=2Ecom=2Fout=3E?=";

    expect(parseListUnsubscribe(raw).http).toBe("https://www.foundersintech.com/out");
  });

  test("reassembles a URL split across two encoded words", () => {
    // Folding is exactly why a long URL gets split, and RFC 2047 §6.2 says the whitespace between two
    // encoded words is not part of the text — joining without stripping it produces a broken link.
    const raw = "=?us-ascii?Q?=3Chttps=3A=2F=2Fexample=2Ecom=2Funsub?= =?us-ascii?Q?=2Fabc123=3E?=";

    expect(parseListUnsubscribe(raw).http).toBe("https://example.com/unsub/abc123");
  });

  test("decodes base64 encoded words too", () => {
    const encoded = Buffer.from("<https://example.com/bye>", "utf8").toString("base64");

    expect(parseListUnsubscribe(`=?utf-8?B?${encoded}?=`).http).toBe("https://example.com/bye");
  });

  test("an underscore inside an unencoded URL is left alone", () => {
    // RFC 2047's underscore-is-a-space rule applies INSIDE an encoded word only. Applying it to the whole
    // header would corrupt every link with an underscore in its path.
    expect(parseListUnsubscribe("<https://example.com/a_b_c>").http).toBe("https://example.com/a_b_c");
  });

  test("a bare URL with no angle brackets is still read", () => {
    expect(parseListUnsubscribe("https://example.com/out").http).toBe("https://example.com/out");
  });

  test("mailto-only is reported as mailto, never promoted to a link", () => {
    const target = parseListUnsubscribe("<mailto:unsub+abc@example.com>");

    expect(target.http).toBeNull();
    expect(target.mailto).toBe("mailto:unsub+abc@example.com");
  });

  test("nothing usable is nulls, not a throw", () => {
    expect(parseListUnsubscribe(null)).toEqual({ http: null, mailto: null });
    expect(parseListUnsubscribe("   ")).toEqual({ http: null, mailto: null });
    expect(parseListUnsubscribe("List-Unsubscribe: broken")).toEqual({ http: null, mailto: null });
  });

  test("a malformed encoded word survives as itself rather than vanishing", () => {
    const raw = "=?utf-8?B?!!!not-base64!!!?=";

    expect(() => decodeEncodedWords(raw)).not.toThrow();
  });
});
