import type { orpc } from "~/integrations/orpc";
import type { BannerTone } from "./-outcome-banner";

// The unsubscribe picker's pure parts: which candidates can be ticked, and the wording and tone of what
// a press did per sender. Kept out of -unsubscribe-picker.tsx so -unsubscribe-outcome.test.ts can check
// them without importing the orpc client (and through it the server router). The import above is
// type-only and is erased at build.

export type UnsubscribeCandidate = Awaited<ReturnType<typeof orpc.mail.listUnsubscribeCandidates>>[number];
export type UnsubscribeBulkResult = Awaited<ReturnType<typeof orpc.mail.unsubscribeBulk>>;
export type UnsubscribeSenderOutcome = UnsubscribeBulkResult["senders"][number];
// The same record whether it came back from the press or was read off the candidate row.
export type UnsubscribeAttempt = NonNullable<UnsubscribeCandidate["last_attempt"]>;

export function candidateKey(candidate: Pick<UnsubscribeCandidate, "mailbox_label" | "from_address">): string {
  return `${candidate.mailbox_label}:${candidate.from_address}`;
}

// A one-click POST, or a mailto the server emails. A plain link is neither, and stays on the full page.
export function isTickable(candidate: Pick<UnsubscribeCandidate, "one_click" | "target">): boolean {
  return candidate.one_click || candidate.target.http === null;
}

export const attempt_tone: Record<UnsubscribeAttempt["status"], BannerTone> = {
  sent: "success",
  failed: "danger",
  skipped: "info",
};

export function attemptLabel(attempt: Pick<UnsubscribeAttempt, "method" | "status" | "response_code" | "error">): string {
  if (attempt.status === "skipped") {
    return "skipped";
  }
  if (attempt.method === "mailto") {
    return attempt.status === "sent" ? "email sent" : `email ${attempt.status} · ${attempt.error ?? "no response"}`;
  }
  return attempt.response_code === null
    ? `one-click ${attempt.status} · ${attempt.error ?? "no response"}`
    : `one-click ${attempt.status} ${attempt.response_code}`;
}

export const policy_wording: Record<UnsubscribeSenderOutcome["policy"], string> = {
  created: "rule created at auto",
  promoted: "rule promoted to auto",
  left: "existing rule left as it was",
};

export function senderTone(outcome: UnsubscribeSenderOutcome): BannerTone {
  if (outcome.errors.length > 0 || outcome.failed > 0 || outcome.attempt?.status === "failed") {
    return "danger";
  }
  if (outcome.attempt?.status === "skipped" || outcome.policy === "left" || outcome.refused > 0) {
    return "warning";
  }
  return "success";
}

export function senderLine(outcome: UnsubscribeSenderOutcome): string {
  const attempt = outcome.attempt === null ? "unsubscribe not recorded" : `unsubscribe ${attemptLabel(outcome.attempt)}`;
  const counts = [`${outcome.archived} archived`];
  if (outcome.failed > 0) {
    counts.push(`${outcome.failed} failed`);
  }
  if (outcome.retried > 0) {
    counts.push(`${outcome.retried} retried from an earlier press`);
  }
  if (outcome.refused > 0) {
    counts.push(`${outcome.refused} kept by a guard`);
  }
  if (outcome.waiting > 0) {
    counts.push(`${outcome.waiting} waiting for the next tick`);
  }
  const errors = outcome.errors.length === 0 ? "" : ` — ${outcome.errors.join("; ")}`;
  return `${outcome.from_address}: ${attempt}; ${policy_wording[outcome.policy]}; ${counts.join(", ")}${errors}`;
}
