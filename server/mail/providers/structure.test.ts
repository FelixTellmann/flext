import { describe, expect, test } from "bun:test";
import type { MessagePart } from "@server/mail/providers/structure";
import { hasHumanAttachment, isCalendarMessage } from "@server/mail/providers/structure";

function part(type: string, overrides: Partial<MessagePart> = {}): MessagePart {
  return { type, disposition: null, filename: null, child_parts: [], ...overrides };
}

// The shape Google Calendar actually sends: the calendar part is two levels down, and the .ics rides
// alongside it as an attachment.
const google_invite = part("multipart/mixed", {
  child_parts: [
    part("multipart/alternative", {
      child_parts: [part("text/plain"), part("text/html"), part("text/calendar")],
    }),
    part("application/ics", { disposition: "attachment", filename: "invite.ics" }),
  ],
});

const email_with_pdf = part("multipart/mixed", {
  child_parts: [part("text/plain"), part("application/pdf", { disposition: "attachment", filename: "invoice.pdf" })],
});

describe("isCalendarMessage", () => {
  test("finds a calendar part nested two levels down", () => {
    // A check that looked only at the top level, or only at direct children, would pass a hand-made
    // fixture and miss every real invitation. This is the case that pins the recursion.
    expect(isCalendarMessage(google_invite)).toBe(true);
  });

  test("an ordinary email with an attachment is not calendar mail", () => {
    expect(isCalendarMessage(email_with_pdf)).toBe(false);
  });

  test("a plain text message is not calendar mail", () => {
    expect(isCalendarMessage(part("text/plain"))).toBe(false);
  });

  test("no structure observed is null, never false", () => {
    // §1.3's tri-state. ~50,000 rows predate this and must not assert they are definitely not calendar
    // mail — the system has never looked.
    expect(isCalendarMessage(null)).toBeNull();
  });

  test("the content type is matched by prefix, so parameters do not break it", () => {
    expect(isCalendarMessage(part("text/calendar; method=REQUEST; charset=UTF-8"))).toBe(true);
  });
});

describe("hasHumanAttachment", () => {
  test("a real attachment counts", () => {
    expect(hasHumanAttachment(email_with_pdf)).toBe(true);
  });

  test("a calendar invitation does NOT, even though its .ics is dispositioned as an attachment", () => {
    // The whole point of the correction. The old test was `Content-Type starts multipart/mixed`, which is
    // true of this message, so §5.3's "a real person sent me a document" guard fired on meeting churn.
    expect(hasHumanAttachment(google_invite)).toBe(false);
  });

  test("an inline image in a signature is not an attachment", () => {
    const signed = part("multipart/related", {
      child_parts: [part("text/html"), part("image/png", { disposition: "inline", filename: "logo.png" })],
    });

    expect(hasHumanAttachment(signed)).toBe(false);
  });

  test("a filename with no disposition still counts, because some senders omit it", () => {
    const sloppy = part("multipart/mixed", {
      child_parts: [part("text/plain"), part("application/zip", { filename: "photos.zip" })],
    });

    expect(hasHumanAttachment(sloppy)).toBe(true);
  });

  test("no structure observed is false, not a crash", () => {
    expect(hasHumanAttachment(null)).toBe(false);
  });

  test("a plain message has none", () => {
    expect(hasHumanAttachment(part("text/plain"))).toBe(false);
  });
});
