import { describe, expect, test } from "bun:test";
import {
  describeEvidence,
  describeLatestSession,
  formatDuration,
  formatMailboxList,
  formatRelative,
  formatSessionDay,
  formatTimeSpan,
} from "./-attention-sessions";

const now = "2026-09-06T14:00:00.000Z";

describe("formatRelative", () => {
  test("rounds down to the largest whole unit and pluralises", () => {
    expect(formatRelative("2026-09-06T13:59:30.000Z", now)).toBe("just now");
    expect(formatRelative("2026-09-06T13:59:00.000Z", now)).toBe("1 minute ago");
    expect(formatRelative("2026-09-06T13:15:00.000Z", now)).toBe("45 minutes ago");
    expect(formatRelative("2026-09-06T11:30:00.000Z", now)).toBe("2 hours ago");
    expect(formatRelative("2026-09-03T12:00:00.000Z", now)).toBe("3 days ago");
  });

  test("a session stamped after the load instant reads as just now rather than a negative age", () => {
    expect(formatRelative("2026-09-06T14:00:05.000Z", now)).toBe("just now");
  });
});

describe("formatDuration", () => {
  test("a session opened by one run has no span and says so", () => {
    expect(formatDuration(now, now)).toBe("a single check");
  });

  test("minutes under an hour, hours and zero-padded minutes above it", () => {
    expect(formatDuration("2026-09-06T13:35:00.000Z", now)).toBe("25 min");
    expect(formatDuration("2026-09-06T12:55:00.000Z", now)).toBe("1 h 05 min");
  });
});

describe("the lead sentence", () => {
  test("reads as one plain-English line with pluralised evidence and the mailbox list", () => {
    const session = {
      started_at: "2026-09-06T11:10:00.000Z",
      ended_at: "2026-09-06T11:35:00.000Z",
      seen_transitions: 4,
      flag_changes: 1,
      replies_sent: 0,
      mailbox_labels: ["Gmail", "tellmann", "Work"],
    };
    expect(describeLatestSession(session, now)).toBe(
      "Last believed reading mail: 2 hours ago for 25 min, 4 reads, 1 flag change, 0 replies, in Gmail, tellmann and Work",
    );
    expect(describeEvidence({ ...session, seen_transitions: 1, replies_sent: 1 })).toBe("1 read, 1 flag change, 1 reply");
  });

  test("mailbox lists of zero, one and two", () => {
    expect(formatMailboxList([])).toBe("no mailbox recorded");
    expect(formatMailboxList(["Gmail"])).toBe("Gmail");
    expect(formatMailboxList(["Gmail", "Work"])).toBe("Gmail and Work");
  });
});

describe("absolute times", () => {
  test("render in the operator's zone, not UTC or the container's", () => {
    expect(formatSessionDay("2026-09-05T22:30:00.000Z")).toBe("Sun 6 Sep");
    expect(formatTimeSpan("2026-09-05T22:30:00.000Z", "2026-09-05T23:05:00.000Z")).toBe("00:30–01:05");
  });

  test("an instant session shows one time, not a span to itself", () => {
    expect(formatTimeSpan(now, now)).toBe("16:00");
  });
});
