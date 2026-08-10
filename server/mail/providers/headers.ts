import type { HeaderMap } from "@server/mail/providers/types";

export const HEADER_FIELDS = [
  "From",
  "To",
  "Cc",
  "Subject",
  "Date",
  "Message-ID",
  "References",
  "In-Reply-To",
  "List-Id",
  "List-Unsubscribe",
  "Precedence",
  "Auto-Submitted",
  "Return-Path",
  "Content-Type",
  "Delivered-To",
  "X-Original-To",
  "Authentication-Results",
] as const;

// The exact IMAP data item imapflow renders for `headers: [...]`. PEEK is mandatory and is why Phase 1 can
// read every message without touching a mailbox: a bare BODY[] fetch sets \Seen on everything it reads
// (§4.2). Surfaced by the connection test so the read-only contract is visible in the admin UI.
export const HEADER_FETCH_SPEC = `BODY.PEEK[HEADER.FIELDS (${HEADER_FIELDS.join(" ").toUpperCase()})]`;

export function parseHeaderBlock(raw: Buffer | undefined): HeaderMap {
  const headers: HeaderMap = {};
  if (raw === undefined) {
    return headers;
  }

  const unfolded: string[] = [];
  for (const line of raw.toString("utf8").split(/\r?\n/)) {
    if (line.length === 0) {
      continue;
    }
    if (/^[ \t]/.test(line) && unfolded.length > 0) {
      unfolded[unfolded.length - 1] = `${unfolded[unfolded.length - 1]} ${line.trim()}`;
      continue;
    }
    unfolded.push(line);
  }

  for (const line of unfolded) {
    const separator = line.indexOf(":");
    if (separator < 1) {
      continue;
    }
    const name = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    const existing = headers[name];
    if (existing !== undefined) {
      existing.push(value);
      continue;
    }
    headers[name] = [value];
  }

  return headers;
}

export function headerValues(headers: HeaderMap, name: string): string[] {
  return headers[name.toLowerCase()] ?? [];
}

export function headerValue(headers: HeaderMap, name: string): string | null {
  return headerValues(headers, name)[0] ?? null;
}

export function extractAddresses(value: string): string[] {
  const angled = value.match(/<([^<>]+)>/g);
  if (angled !== null) {
    return angled.map((entry) => entry.slice(1, -1).trim().toLowerCase());
  }
  return value
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.includes("@"));
}
