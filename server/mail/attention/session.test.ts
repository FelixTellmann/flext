import { describe, expect, test } from "bun:test";
import type { AttentionEvidence, EvidenceRun, OpenSession } from "@server/mail/attention/session";
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

function run(minutes: number, overrides: Partial<EvidenceRun> = {}): EvidenceRun {
  return { started_at: at(minutes), mailbox_id: "mailbox-1", seen_transitions: 0, flag_changes: 0, replies_sent: 0, ...overrides };
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
    const outcome = foldEvidence({ open: null, evidence: evidence({ seen_transitions: 3 }), window: [] });

    expect(outcome.kind).toBe("opened");
    expect(outcome.kind === "opened" && outcome.session.started_at).toEqual(NOON);
  });

  test("a quiet window opens nothing and disturbs nothing", () => {
    const outcome = foldEvidence({ open: null, evidence: evidence({ seen_transitions: 1 }), window: [] });

    expect(outcome.kind).toBe("ignored");
  });

  test("a second window inside the gap extends the same sitting", () => {
    // The case that stops one twenty-minute triage counting three times and burning the whole decline
    // budget in a single sitting.
    const outcome = foldEvidence({
      open: openSession(),
      evidence: evidence({ observed_at: at(20), seen_transitions: 2 }),
      window: [],
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
      window: [],
    });

    expect(outcome.kind).toBe("opened");
  });

  test("the gap is measured from the session's END, so a long sitting stays one session", () => {
    // Measuring from started_at would split any triage running longer than the gap into two, and count
    // one sitting twice against every unread message in the inbox.
    const long_running = openSession({ started_at: NOON, ended_at: at(150) });
    const outcome = foldEvidence({ open: long_running, evidence: evidence({ observed_at: at(200), seen_transitions: 2 }), window: [] });

    expect(outcome.kind).toBe("extended");
    expect(outcome.kind === "extended" && outcome.session.started_at).toEqual(NOON);
  });

  test("evidence from another mailbox joins the same session", () => {
    // Sessions are global (§1.3). He reads one unified list, so activity in Gmail and activity in xneelo
    // twenty minutes apart is one sitting, not two.
    const outcome = foldEvidence({
      open: openSession(),
      evidence: evidence({ observed_at: at(10), mailbox_id: "mailbox-2", seen_transitions: 2 }),
      window: [],
    });

    expect(outcome.kind === "extended" && outcome.session.evidence_mailbox_ids).toEqual(["mailbox-1", "mailbox-2"]);
  });

  test("a lone read inside the gap does not extend an open session when nothing else was witnessed in the window", () => {
    // The open session alone is not evidence; only pooled runs are. With an empty window this is the
    // pre-pooling case: one preview-pane transition, nothing to pool it with, ignored.
    const outcome = foldEvidence({ open: openSession(), evidence: evidence({ observed_at: at(10), seen_transitions: 1 }), window: [] });

    expect(outcome.kind).toBe("ignored");
  });

  test("a lone read inside the gap extends an open session when the window pools it past the threshold", () => {
    // The intended behaviour under pooling: the session's own runs are inside the two-hour window, so one
    // more read is someone still working, and the session grows by that one read only.
    const open = openSession({ started_at: NOON, ended_at: at(30), seen_transitions: 2, flag_changes: 1 });
    const outcome = foldEvidence({
      open,
      evidence: evidence({ observed_at: at(50), seen_transitions: 1 }),
      window: [run(0, { seen_transitions: 1 }), run(30, { seen_transitions: 1, flag_changes: 1 })],
    });

    expect(outcome.kind).toBe("extended");
    expect(outcome.kind === "extended" && outcome.session.ended_at).toEqual(at(50));
    expect(outcome.kind === "extended" && outcome.session.seen_transitions).toBe(3);
    expect(outcome.kind === "extended" && outcome.session.flag_changes).toBe(1);
  });
});

describe("foldEvidence pools the last two hours across mailboxes", () => {
  test("three single reads across three mailboxes inside two hours make one session that starts at the first read", () => {
    // The observed pattern: one to three reads an hour spread over four mailboxes, which judged one run
    // at a time never held two events and produced zero sessions in five days.
    const outcome = foldEvidence({
      open: null,
      evidence: evidence({ observed_at: at(90), mailbox_id: "mailbox-3", seen_transitions: 1 }),
      window: [run(0, { mailbox_id: "mailbox-1", seen_transitions: 1 }), run(45, { mailbox_id: "mailbox-2", seen_transitions: 1 })],
    });

    expect(outcome.kind).toBe("opened");
    expect(outcome.kind === "opened" && outcome.session.started_at).toEqual(NOON);
    expect(outcome.kind === "opened" && outcome.session.ended_at).toEqual(at(90));
    expect(outcome.kind === "opened" && outcome.session.seen_transitions).toBe(3);
    expect(outcome.kind === "opened" && outcome.session.evidence_mailbox_ids).toEqual(["mailbox-1", "mailbox-2", "mailbox-3"]);
  });

  test("one read alone makes none", () => {
    const outcome = foldEvidence({ open: null, evidence: evidence({ seen_transitions: 1 }), window: [run(-30), run(-15)] });

    expect(outcome.kind).toBe("ignored");
  });

  test("a read three hours after a lone earlier read makes none", () => {
    // The port hands over whatever it loaded; the window cut is the fold's own, so a stale row cannot
    // qualify a session however it got here.
    const outcome = foldEvidence({
      open: null,
      evidence: evidence({ observed_at: at(180), seen_transitions: 1 }),
      window: [run(0, { seen_transitions: 1 })],
    });

    expect(outcome.kind).toBe("ignored");
  });

  test("a reply alone opens a session", () => {
    const outcome = foldEvidence({ open: null, evidence: evidence({ replies_sent: 1 }), window: [] });

    expect(outcome.kind).toBe("opened");
    expect(outcome.kind === "opened" && outcome.session.replies_sent).toBe(1);
  });

  test("evidence inside the gap of an open session extends it without re-counting the window", () => {
    // The 12:00 and 12:45 reads were folded in when the session opened; a third read at 13:00 pools with
    // them to qualify, but adds only itself to the counters.
    const open = openSession({ started_at: NOON, ended_at: at(45), seen_transitions: 2, evidence_mailbox_ids: ["mailbox-1", "mailbox-2"] });
    const outcome = foldEvidence({
      open,
      evidence: evidence({ observed_at: at(60), mailbox_id: "mailbox-3", seen_transitions: 1 }),
      window: [run(0, { mailbox_id: "mailbox-1", seen_transitions: 1 }), run(45, { mailbox_id: "mailbox-2", seen_transitions: 1 })],
    });

    expect(outcome.kind).toBe("extended");
    expect(outcome.kind === "extended" && outcome.session.started_at).toEqual(NOON);
    expect(outcome.kind === "extended" && outcome.session.ended_at).toEqual(at(60));
    expect(outcome.kind === "extended" && outcome.session.seen_transitions).toBe(3);
    expect(outcome.kind === "extended" && outcome.session.evidence_mailbox_ids).toEqual(["mailbox-1", "mailbox-2", "mailbox-3"]);
  });

  test("a run that saw nothing itself is ignored however much the window holds", () => {
    // Otherwise every empty fifteen-minute run for two hours after a triage would slide the session's
    // end forward, and the gap would in practice be four hours.
    const open = openSession({ started_at: NOON, ended_at: at(45), seen_transitions: 2 });
    const outcome = foldEvidence({
      open,
      evidence: evidence({ observed_at: at(60) }),
      window: [run(0, { seen_transitions: 1 }), run(45, { seen_transitions: 1 })],
    });

    expect(outcome.kind).toBe("ignored");
  });
});
