import { describe, expect, test } from "bun:test";
import type { AttentionEvidence, OpenSession } from "@server/mail/attention/session";
import { foldEvidence, qualifiesAsAttention, SESSION_GAP_MS } from "@server/mail/attention/session";

const NOON = new Date("2026-08-26T12:00:00.000Z");

function evidence(overrides: Partial<AttentionEvidence> = {}): AttentionEvidence {
  return { observed_at: NOON, mailbox_id: "mailbox-1", seen_transitions: 0, flag_changes: 0, replies_sent: 0, ...overrides };
}

function openSession(overrides: Partial<OpenSession> = {}): OpenSession {
  return {
    id: "session-1",
    started_at: NOON,
    ended_at: NOON,
    seen_transitions: 2,
    flag_changes: 0,
    replies_sent: 0,
    evidence_mailbox_ids: ["mailbox-1"],
    ...overrides,
  };
}

function at(minutes: number): Date {
  return new Date(NOON.getTime() + minutes * 60_000);
}

describe("qualifiesAsAttention", () => {
  test("one lone seen-transition is not a triage session", () => {
    // A phone rendering a preview pane, or a notification tap. Counting it would let the clock advance
    // on mail the operator never actually looked at.
    expect(qualifiesAsAttention(evidence({ seen_transitions: 1 }))).toBe(false);
  });

  test("two events is someone working", () => {
    expect(qualifiesAsAttention(evidence({ seen_transitions: 2 }))).toBe(true);
  });

  test("mixed evidence counts together", () => {
    expect(qualifiesAsAttention(evidence({ seen_transitions: 1, flag_changes: 1 }))).toBe(true);
  });

  test("a single reply is enough on its own", () => {
    // Sending mail is unambiguously a person at a keyboard, and the one signal a preview pane cannot fake.
    expect(qualifiesAsAttention(evidence({ replies_sent: 1 }))).toBe(true);
  });

  test("no evidence at all is not a session", () => {
    expect(qualifiesAsAttention(evidence())).toBe(false);
  });
});

describe("foldEvidence", () => {
  test("opens a session when there is none", () => {
    const outcome = foldEvidence({ open: null, evidence: evidence({ seen_transitions: 3 }) });

    expect(outcome.kind).toBe("opened");
    expect(outcome.kind === "opened" && outcome.session.started_at).toEqual(NOON);
  });

  test("a quiet window opens nothing and disturbs nothing", () => {
    const outcome = foldEvidence({ open: null, evidence: evidence({ seen_transitions: 1 }) });

    expect(outcome.kind).toBe("ignored");
  });

  test("a second window inside the gap extends the same sitting", () => {
    // The case that stops one twenty-minute triage counting three times and burning the whole decline
    // budget in a single sitting.
    const outcome = foldEvidence({
      open: openSession(),
      evidence: evidence({ observed_at: at(20), seen_transitions: 2 }),
    });

    expect(outcome.kind).toBe("extended");
    expect(outcome.kind === "extended" && outcome.session.started_at).toEqual(NOON);
    expect(outcome.kind === "extended" && outcome.session.ended_at).toEqual(at(20));
    expect(outcome.kind === "extended" && outcome.session.seen_transitions).toBe(4);
  });

  test("a window past the gap starts a new sitting", () => {
    const outcome = foldEvidence({
      open: openSession(),
      evidence: evidence({ observed_at: at(SESSION_GAP_MS / 60_000 + 1), seen_transitions: 2 }),
    });

    expect(outcome.kind).toBe("opened");
  });

  test("the gap is measured from the session's END, so a long sitting stays one session", () => {
    // Measuring from started_at would split any triage running longer than the gap into two, and count
    // one sitting twice against every unread message in the inbox.
    const long_running = openSession({ started_at: NOON, ended_at: at(150) });
    const outcome = foldEvidence({ open: long_running, evidence: evidence({ observed_at: at(200), seen_transitions: 2 }) });

    expect(outcome.kind).toBe("extended");
    expect(outcome.kind === "extended" && outcome.session.started_at).toEqual(NOON);
  });

  test("evidence from another mailbox joins the same session", () => {
    // Sessions are global (§1.3). He reads one unified list, so activity in Gmail and activity in xneelo
    // twenty minutes apart is one sitting, not two.
    const outcome = foldEvidence({
      open: openSession(),
      evidence: evidence({ observed_at: at(10), mailbox_id: "mailbox-2", seen_transitions: 2 }),
    });

    expect(outcome.kind === "extended" && outcome.session.evidence_mailbox_ids).toEqual(["mailbox-1", "mailbox-2"]);
  });

  test("a non-qualifying window does not extend an open session either", () => {
    // Otherwise a stray preview-pane transition would keep a session alive indefinitely, and a session
    // that never ends is a session that never counts a second time.
    const outcome = foldEvidence({ open: openSession(), evidence: evidence({ observed_at: at(10), seen_transitions: 1 }) });

    expect(outcome.kind).toBe("ignored");
  });
});
