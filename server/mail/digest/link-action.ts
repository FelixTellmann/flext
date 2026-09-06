import { serverEnv } from "@server/env";
import { SITE_ORIGIN, verifyDigestLink } from "@server/mail/digest/links";
import type { PolicyIndex, PolicyRow, UpsertPolicyInput } from "@server/mail/query/policies";
import { loadPolicyIndex, upsertPolicy } from "@server/mail/query/policies";
import type { UnsubscribeBulkResult } from "@server/mail/unsubscribe/bulk";
import { unsubscribeBulk } from "@server/mail/unsubscribe/bulk";

// What a tapped digest link does, and the page it answers with. Two actions, both idempotent: File
// creates a watch-only archive rule and never touches an existing rule; Unsubscribe is the bulk button
// for one sender (docs/decisions/2026-09-06-unsubscribe-button-and-digest-links.md).

// The rules the File link creates carry their own source, as the button's do (bulk.ts), so
// /admin/senders can tell "tapped in the digest" from "assigned on the sender table".
export const DIGEST_POLICY_SOURCE = "digest";

// server/orpc/mail.ts's MAX_ACTION_BATCH_SIZE, which it does not export: the executor's per-mailbox cap
// per press. The tick picks up anything past it.
export const DIGEST_PENDING_CAP = 200;

// Bun closes a request socket silent for 10 s (see src/routes/api/mail-sync.ts), and one-click.ts alone
// may spend that long on the sender's endpoint before the IMAP archive starts. The handler waits this
// long for the outcome, then answers with "still running" and lets the work finish behind the response.
export const DIGEST_LINK_WAIT_MS = 6_000;

export type DigestLinkResult =
  | { kind: "expired" }
  | { kind: "invalid" }
  | { kind: "filed"; address: string }
  | { kind: "rule_exists"; address: string; rule: { action: string; autonomy: string } }
  | { kind: "unsubscribed"; address: string; result: UnsubscribeBulkResult }
  | { kind: "unsubscribing"; address: string }
  | { kind: "failed"; address: string; error: string };

export type DigestLinkDependencies = {
  secret: string | undefined;
  loadPolicyIndex: () => Promise<PolicyIndex>;
  upsertPolicy: (input: UpsertPolicyInput) => Promise<PolicyRow>;
  unsubscribe: (from_address: string) => Promise<UnsubscribeBulkResult>;
  wait_ms: number;
};

function liveDependencies(): DigestLinkDependencies {
  return {
    secret: serverEnv().SCRIPT_SECRET,
    loadPolicyIndex,
    upsertPolicy,
    unsubscribe: (from_address) => unsubscribeBulk({ from_addresses: [from_address], pending_cap: DIGEST_PENDING_CAP }),
    wait_ms: DIGEST_LINK_WAIT_MS,
  };
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// upsertPolicy writes autonomy "shadow" on every call (query/policies.ts, demotion-on-edit), and a link
// stays valid for 14 days during which the button or the unsubscribe link may have promoted the same
// sender. So an existing rule of any shape is left exactly as it is, and the page says so.
async function fileSender(address: string, dependencies: DigestLinkDependencies): Promise<DigestLinkResult> {
  const index = await dependencies.loadPolicyIndex();
  const existing = index.by_address.get(address.toLowerCase());
  if (existing !== undefined) {
    return { kind: "rule_exists", address, rule: { action: existing.action, autonomy: existing.autonomy } };
  }

  await dependencies.upsertPolicy({ scope: "address", value: address, action: "archive", mark_read: true, source: DIGEST_POLICY_SOURCE });
  return { kind: "filed", address };
}

async function unsubscribeSender(address: string, dependencies: DigestLinkDependencies): Promise<DigestLinkResult> {
  const work: Promise<DigestLinkResult> = dependencies
    .unsubscribe(address)
    .then((result): DigestLinkResult => ({ kind: "unsubscribed", address, result }))
    .catch((error: unknown): DigestLinkResult => {
      console.error(`[digest-link] unsubscribe ${address} failed`, error);
      return { kind: "failed", address, error: describeError(error) };
    });

  let timer: ReturnType<typeof setTimeout> | null = null;
  const deadline = new Promise<DigestLinkResult>((resolve) => {
    timer = setTimeout(() => resolve({ kind: "unsubscribing", address }), dependencies.wait_ms);
  });

  try {
    return await Promise.race([work, deadline]);
  } finally {
    if (timer !== null) {
      clearTimeout(timer);
    }
  }
}

export async function applyDigestLink(
  input: { token: string; now: Date },
  dependencies: DigestLinkDependencies = liveDependencies(),
): Promise<DigestLinkResult> {
  if (dependencies.secret === undefined) {
    return { kind: "invalid" };
  }

  const verification = verifyDigestLink(input.token, { secret: dependencies.secret, now: input.now });
  if (!verification.ok) {
    return verification.reason === "expired" ? { kind: "expired" } : { kind: "invalid" };
  }

  const { action, address } = verification.payload;
  try {
    if (action === "file") {
      return await fileSender(address, dependencies);
    }
    return await unsubscribeSender(address, dependencies);
  } catch (error) {
    console.error(`[digest-link] ${action} ${address} failed`, error);
    return { kind: "failed", address, error: describeError(error) };
  }
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

const ADMIN_SENDERS_URL = `${SITE_ORIGIN}/admin/senders`;
const ADMIN_UNSUBSCRIBE_URL = `${SITE_ORIGIN}/admin/unsubscribe`;

export function describeDigestLinkResult(result: DigestLinkResult): { title: string; detail: string } {
  switch (result.kind) {
    case "expired":
      return { title: "This link has expired", detail: `Open ${ADMIN_UNSUBSCRIBE_URL} to unsubscribe or file from the full list.` };
    case "invalid":
      return { title: "This link is not valid", detail: `Open ${ADMIN_UNSUBSCRIBE_URL} to unsubscribe or file from the full list.` };
    case "filed":
      return {
        title: `Rule created for ${result.address}, watch-only`,
        detail: `Its mail keeps arriving until you switch the rule on at ${ADMIN_SENDERS_URL}.`,
      };
    case "rule_exists":
      return {
        title: `${result.address} already has a rule`,
        detail: `It is a ${result.rule.action} rule, ${result.rule.autonomy === "auto" ? "switched on" : "watch-only"}. Nothing was changed; manage it at ${ADMIN_SENDERS_URL}.`,
      };
    case "unsubscribing":
      return {
        title: `Unsubscribing from ${result.address}`,
        detail: `Still running. The outcome appears at ${ADMIN_UNSUBSCRIBE_URL} in a minute.`,
      };
    case "failed":
      return {
        title: `Unsubscribe from ${result.address} failed`,
        detail: `${result.error}. The list at ${ADMIN_UNSUBSCRIBE_URL} shows what was recorded.`,
      };
    case "unsubscribed": {
      const sender = result.result.senders[0];
      const request =
        sender?.attempt === null || sender?.attempt === undefined
          ? "no request was sent"
          : `request ${sender.attempt.status}${sender.attempt.error === null ? "" : ` (${sender.attempt.error})`}`;
      const archived =
        sender === undefined
          ? ""
          : `, archived ${plural(sender.archived, "email")}${sender.waiting > 0 ? `, ${sender.waiting} more on the next tick` : ""}`;
      const errors = [...(sender?.errors ?? []), ...result.result.mailbox_errors.map((entry) => `${entry.label}: ${entry.error}`)];
      return {
        title: `Unsubscribed from ${result.address}`,
        detail: `${request[0].toUpperCase()}${request.slice(1)}${archived}.${errors.length > 0 ? ` Problems: ${errors.join("; ")}.` : ""} Details at ${ADMIN_UNSUBSCRIBE_URL}.`,
      };
    }
  }
}

export function digestLinkStatus(result: DigestLinkResult): number {
  // An expired link is the expected end of a link's life, not an error (register: phase 7 digest links).
  if (result.kind === "invalid") {
    return 400;
  }
  if (result.kind === "failed") {
    return 500;
  }
  return 200;
}

export function renderDigestLinkPage(result: DigestLinkResult): string {
  const { title, detail } = describeDigestLinkResult(result);
  return [
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
    `<title>${escapeHtml(title)}</title></head>`,
    '<body style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.5;color:#111827;max-width:560px;margin:48px auto;padding:0 16px">',
    `<h1 style="font-size:20px;margin:0 0 12px">${escapeHtml(title)}</h1>`,
    `<p style="margin:0;color:#4b5563">${escapeHtml(detail)}</p>`,
    "</body></html>",
  ].join("");
}
