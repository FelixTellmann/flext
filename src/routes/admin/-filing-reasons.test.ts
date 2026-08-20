import { describe, expect, test } from "bun:test";
import { FILING_QUEUE_REASONS as SERVER_FILING_QUEUE_REASONS } from "@server/mail/filing/paths";
import {
  FILING_QUEUE_REASONS,
  FILING_REASON_INFO,
  filingReasonLabel,
  filingReasonOperatorAction,
  isFilingQueueReason,
} from "./-filing-reasons";

// The admin route carries its own copy of the reason tuple because filing/paths.ts is reached only through
// query/filing.ts, which holds the db handle (see -filing-reasons.ts). This is the only thing keeping the
// two spellings honest, and what it protects is the queue itself: a reason this file doesn't know renders
// as a blank row with no label and no instruction for what the operator can do about it.
describe("the filing queue reasons the route renders", () => {
  test("the reason list matches the server's, member for member", () => {
    expect([...FILING_QUEUE_REASONS].sort()).toEqual([...SERVER_FILING_QUEUE_REASONS].sort());
  });

  // Equal lists are not enough on their own: the row actually renders through filingReasonLabel and
  // filingReasonOperatorAction, so every reason the server can emit has to come back a real label through
  // the functions the screen calls, not just exist as a key someone forgot to fill in.
  test("every reason the server can emit has a label and an operator action", () => {
    for (const reason of SERVER_FILING_QUEUE_REASONS) {
      expect(FILING_REASON_INFO[reason]).toBeDefined();
      expect(filingReasonLabel(reason)).toBe(FILING_REASON_INFO[reason].label);
      expect(filingReasonOperatorAction(reason)).toBe(FILING_REASON_INFO[reason].operator_action);
      expect(isFilingQueueReason(reason)).toBe(true);
    }
  });

  // ambiguous_client is reachable in server/mail/filing/paths.ts's closed set but nothing currently
  // produces it — no thread-level client detection exists yet. It must still render, not be missing from
  // the local copy just because no live row exercises it.
  test("ambiguous_client renders even though nothing produces it yet", () => {
    expect(FILING_QUEUE_REASONS).toContain("ambiguous_client");
    expect(filingReasonLabel("ambiguous_client")).toBe("Thread spans two clients");
  });

  // The mutation check: drop one member from the LOCAL copy (as if an edit here fell out of sync with the
  // server's tuple) and confirm the pin test above would actually catch it, rather than passing regardless
  // of what either side contains. Without this, the equality assertion is decoration — it happens to pass
  // today, and nothing proves it would fail the day the two lists disagree.
  test("the pin actually bites: a local copy missing a server reason fails the equality check", () => {
    const mutated_local_copy = FILING_QUEUE_REASONS.filter((reason) => reason !== "dkim_unaligned");
    expect([...mutated_local_copy].sort()).not.toEqual([...SERVER_FILING_QUEUE_REASONS].sort());
  });

  test("an unrecognised reason falls back to the raw string and a manual-resolution note", () => {
    expect(isFilingQueueReason("something_a_later_phase_adds")).toBe(false);
    expect(filingReasonLabel("something_a_later_phase_adds")).toBe("something_a_later_phase_adds");
    expect(filingReasonOperatorAction("something_a_later_phase_adds")).toBe("Unrecognised reason — resolve manually.");
  });
});
