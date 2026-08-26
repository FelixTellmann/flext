// What a message is MADE OF, derived from BODYSTRUCTURE — the server's description of the MIME tree.
//
// This does not breach §1.3's "bodies are never fetched or persisted". BODYSTRUCTURE transfers part
// types, encodings and sizes, and none of the content, on the same round trip the sync already makes for
// envelope and headers. What ends up in the database is two booleans.
//
// Pure and provider-shaped: it takes the normalized node below, never an imapflow object, so the rules it
// encodes are testable from fixtures with no mail server and no library in the way.

// Deliberately narrower than imapflow's MessageStructureObject. Everything omitted — part numbers,
// encodings, sizes, MD5s, embedded envelopes — is either content-adjacent or of no use to a question
// about what kind of message this is, and a wider type would invite a future caller to reach for it.
export type MessagePart = {
  type: string;
  disposition: string | null;
  filename: string | null;
  child_parts: MessagePart[];
};

export const CALENDAR_CONTENT_TYPE = "text/calendar";

// The calendar payload wears more than one hat. The invitation itself is `text/calendar`, but the copy
// attached for the recipient's mail client is commonly `application/ics`, and some senders ship it as
// `application/octet-stream` identified only by the filename. All three are the same object as far as
// "did a person attach a document to this" is concerned.
const CALENDAR_ATTACHMENT_TYPES = ["text/calendar", "application/ics", "text/x-vcalendar"] as const;

function isCalendarPayload(node: MessagePart): boolean {
  const type = node.type.toLowerCase();
  if (CALENDAR_ATTACHMENT_TYPES.some((candidate) => type.startsWith(candidate))) {
    return true;
  }
  return node.filename?.toLowerCase().endsWith(".ics") ?? false;
}

function walk(part: MessagePart, visit: (node: MessagePart) => boolean): boolean {
  if (visit(part)) {
    return true;
  }
  return part.child_parts.some((child) => walk(child, visit));
}

// True when ANY part anywhere in the tree is text/calendar. The recursion is the point: a Google invite
// nests it two levels down inside multipart/mixed > multipart/alternative, so a check that only looked at
// the top level or its direct children would miss every real invitation while passing a hand-made fixture.
export function isCalendarMessage(structure: MessagePart | null): boolean | null {
  if (structure === null) {
    return null;
  }
  return walk(structure, (node) => node.type.toLowerCase().startsWith(CALENDAR_CONTENT_TYPE));
}

// A part someone deliberately attached, as opposed to one the mail client built to carry the message.
//
// This replaces the old test, which was `Content-Type` starting "multipart/mixed" — true of every calendar
// invitation, because the .ics rides as an attached part. §5.3's human_attachment guard reads this to mean
// "a real person sent me a document", and on 2026-08-26 it was firing on ~263 automated meeting
// invitations. The calendar part is excluded explicitly rather than by luck: an .ics IS dispositioned as
// an attachment, so without this it would still read as one.
export function hasHumanAttachment(structure: MessagePart | null): boolean {
  if (structure === null) {
    return false;
  }
  return walk(structure, (node) => {
    // Every shape the calendar payload takes, not just text/calendar: the .ics attached for the
    // recipient's client is usually application/ics, which is what made the first version of this
    // function report a Google invitation as carrying a human attachment.
    if (isCalendarPayload(node)) {
      return false;
    }
    if (node.disposition?.toLowerCase() === "attachment") {
      return true;
    }
    // Some senders omit Content-Disposition entirely and identify the file by a name parameter alone.
    // Inline images in an HTML signature carry `inline`, so they are not caught by this.
    return node.disposition === null && node.filename !== null;
  });
}
