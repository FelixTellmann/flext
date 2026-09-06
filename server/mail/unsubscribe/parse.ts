// Reading List-Unsubscribe (RFC 2369) off a stored header, including the ones that arrive RFC 2047
// encoded — 144 of a 600-message sample, which is enough that a parser ignoring them would call a quarter
// of the operator's newsletters un-unsubscribable.
//
// Pure. No network, no IO. Nothing here unsubscribes from anything; it turns a header into a link a human
// can click.

export type UnsubscribeTarget = {
  // An https URL, when the sender offered one. Preferred over mailto every time: the http route is one
  // request from the server (one-click.ts) or one link in a browser, while the mailto route means sending
  // mail through server/mail/send, which phase 7 wires up.
  http: string | null;
  mailto: string | null;
};

const ENCODED_WORD = /=\?([^?]+)\?([QqBb])\?([^?]*)\?=/g;

// RFC 2047 §4.2: underscore is a space, and =XX is a hex byte. Applied per encoded-word rather than to
// the whole header, because an unencoded segment may legitimately contain an underscore inside a URL.
function decodeQuoted(text: string): string {
  return text.replace(/_/g, " ").replace(/=([0-9A-Fa-f]{2})/g, (_match, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
}

function decodeBase64(text: string): string {
  try {
    return Buffer.from(text, "base64").toString("utf8");
  } catch {
    // A malformed word is left as it stands. Better a header that still shows its raw form than one that
    // silently loses the only link it carried.
    return text;
  }
}

// Encoded-words may be split across several, and RFC 2047 §6.2 says whitespace BETWEEN two of them is not
// part of the text — folding a long URL is exactly why it would be split, so joining without stripping
// that whitespace reassembles a broken link.
export function decodeEncodedWords(raw: string): string {
  const collapsed = raw.replace(/\?=\s+=\?/g, "?==?");
  return collapsed.replace(ENCODED_WORD, (_match, _charset: string, encoding: string, text: string) =>
    encoding.toUpperCase() === "B" ? decodeBase64(text) : decodeQuoted(text),
  );
}

// RFC 2369: one or more URIs, each in angle brackets, comma separated. Senders violate this in every
// direction — missing brackets, stray whitespace, a trailing comma — so this reads what is there rather
// than rejecting what is malformed.
export function parseListUnsubscribe(raw: string | null): UnsubscribeTarget {
  if (raw === null || raw.trim().length === 0) {
    return { http: null, mailto: null };
  }

  const decoded = decodeEncodedWords(raw);
  const bracketed = [...decoded.matchAll(/<([^>]+)>/g)].map((match) => match[1].trim());
  // A header with no brackets at all still often carries a bare URL, which is worth having.
  const candidates = bracketed.length > 0 ? bracketed : decoded.split(",").map((part) => part.trim());

  const http = candidates.find((value) => /^https?:\/\//i.test(value)) ?? null;
  const mailto = candidates.find((value) => /^mailto:/i.test(value)) ?? null;

  return { http, mailto };
}

// RFC 8058 §3.1: the header value a sender publishes when its List-Unsubscribe URL accepts a POST with
// this exact body. Also the body one-click.ts sends, so the two cannot drift apart.
export const ONE_CLICK_POST_VALUE = "List-Unsubscribe=One-Click";

// Case-insensitive and whitespace-tolerant: the RFC fixes the spelling, senders do not, and a value that
// differs only in case is still a sender that accepts the POST. Anything else is not, and a POST to a
// URL that never promised one-click behaviour is a GET-shaped unsubscribe page ignoring a body at best.
export function isOneClick(list_unsubscribe_post: string | null): boolean {
  if (list_unsubscribe_post === null) {
    return false;
  }
  return list_unsubscribe_post.replace(/\s+/g, "").toLowerCase() === ONE_CLICK_POST_VALUE.toLowerCase();
}
