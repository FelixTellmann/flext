import type { DigestLinks } from "@server/mail/digest/links";
import { SITE_ORIGIN } from "@server/mail/digest/links";
import type { DigestSender } from "@server/mail/digest/query";
import { DIGEST_UNOPENED_DAYS } from "@server/mail/digest/query";

// The Monday email. One row per sender, two taps per row, nothing else to read. Outbound mail follows
// the operator's writing rule: no em dashes anywhere in it.

export type DigestRow = DigestSender & { links: DigestLinks };

export type RenderedDigest = { subject: string; text: string; html: string };

const ADMIN_SENDERS_URL = `${SITE_ORIGIN}/admin/senders`;
const ADMIN_UNSUBSCRIBE_URL = `${SITE_ORIGIN}/admin/unsubscribe`;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Spelled by hand rather than toLocaleDateString: ICU builds disagree on "Sep" versus "Sept", and the
// same digest should read the same wherever it is rendered.
export function formatDigestDate(date: Date): string {
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function joinLabels(labels: string[]): string {
  if (labels.length <= 1) {
    return labels.join("");
  }
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

function describeRule(rule: DigestSender["rule"]): string | null {
  if (rule === null) {
    return null;
  }
  if (rule.suspended) {
    return `Has a suspended ${rule.action} rule.`;
  }
  return `Has a watch-only ${rule.action} rule.`;
}

function describeRow(row: DigestRow): string {
  const parts = [`${plural(row.unopened, "unopened email")} since ${formatDigestDate(row.oldest)}`];
  if (row.mailbox_labels.length > 0) {
    parts.push(`in ${joinLabels(row.mailbox_labels)}`);
  }
  const sentence = `${parts.join(", ")}.`;
  const rule = describeRule(row.rule);
  return rule === null ? sentence : `${sentence} ${rule}`;
}

// A sender that offers neither route gets File only: the button refuses those too (register: phase 6
// which senders the button offers), and a link that records "skipped" is not an unsubscribe.
export function offersUnsubscribe(row: DigestSender): boolean {
  return row.one_click || row.mailto;
}

function renderText(input: { rows: DigestRow[]; expires_on: string }): string {
  const lines: string[] = [
    `${plural(input.rows.length, "sender")} still reaching your inbox with nothing opened for ${DIGEST_UNOPENED_DAYS} days or more, most mail first.`,
    "",
  ];

  for (const row of input.rows) {
    lines.push(row.from_address, `  ${describeRow(row)}`);
    if (offersUnsubscribe(row)) {
      lines.push(`  Unsubscribe: ${row.links.unsubscribe}`);
    }
    lines.push(`  File: ${row.links.file}`, "");
  }

  lines.push(
    "Unsubscribe sends the request to the sender, creates an archive rule and archives what is in the inbox now, marked read.",
    `File creates a watch-only archive rule; switch it on at ${ADMIN_SENDERS_URL}.`,
    `These links work until ${input.expires_on}. The full list is at ${ADMIN_UNSUBSCRIBE_URL}.`,
  );

  return lines.join("\n");
}

function renderHtmlRow(row: DigestRow): string {
  const unsubscribe = offersUnsubscribe(row)
    ? `<a href="${escapeHtml(row.links.unsubscribe)}" style="display:inline-block;padding:6px 12px;margin-right:8px;background:#1f2937;color:#ffffff;text-decoration:none;border-radius:4px">Unsubscribe</a>`
    : "";
  const file = `<a href="${escapeHtml(row.links.file)}" style="display:inline-block;padding:6px 12px;background:#e5e7eb;color:#111827;text-decoration:none;border-radius:4px">File</a>`;
  return [
    '<tr><td style="padding:12px 0;border-top:1px solid #e5e7eb">',
    `<div style="font-weight:600">${escapeHtml(row.from_address)}</div>`,
    `<div style="color:#4b5563;margin:2px 0 8px">${escapeHtml(describeRow(row))}</div>`,
    `<div>${unsubscribe}${file}</div>`,
    "</td></tr>",
  ].join("");
}

function renderHtml(input: { rows: DigestRow[]; expires_on: string }): string {
  return [
    '<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.4;color:#111827;max-width:640px;margin:0 auto;padding:16px">',
    `<p>${escapeHtml(plural(input.rows.length, "sender"))} still reaching your inbox with nothing opened for ${DIGEST_UNOPENED_DAYS} days or more, most mail first.</p>`,
    '<table style="width:100%;border-collapse:collapse">',
    ...input.rows.map(renderHtmlRow),
    "</table>",
    '<p style="color:#4b5563;font-size:13px;margin-top:24px">Unsubscribe sends the request to the sender, creates an archive rule and archives what is in the inbox now, marked read. ',
    `File creates a watch-only archive rule; switch it on at <a href="${ADMIN_SENDERS_URL}">${ADMIN_SENDERS_URL}</a>. `,
    `These links work until ${escapeHtml(input.expires_on)}. The full list is at <a href="${ADMIN_UNSUBSCRIBE_URL}">${ADMIN_UNSUBSCRIBE_URL}</a>.</p>`,
    "</body></html>",
  ].join("");
}

export function renderDigest(input: { rows: DigestRow[]; now: Date; expires_at: Date }): RenderedDigest {
  const expires_on = formatDigestDate(input.expires_at);
  return {
    subject: `Mail digest ${formatDigestDate(input.now)}: ${plural(input.rows.length, "sender")} unread for ${DIGEST_UNOPENED_DAYS} days`,
    text: renderText({ rows: input.rows, expires_on }),
    html: renderHtml({ rows: input.rows, expires_on }),
  };
}
