import { useRouter } from "@tanstack/react-router";
import clsx from "clsx";
import { type FC, useState } from "react";
import { orpc } from "~/integrations/orpc";
import type { BannerTone, OutcomeBanner } from "./-outcome-banner";
import { Banner, banner_style, toFailureBanner } from "./-outcome-banner";
import { ActionButton, accent_button } from "./-ui";

// The tickable half of /admin/unsubscribe, for the review page. unsubscribe.tsx keeps its own copy of the
// list and the outcome wording: it was under concurrent edit when this was written (phase 7's mailto
// group), so the two are duplicated rather than shared for now — the decision register for phase 8b
// names the follow-up. Anything changed in one belongs in the other.

type Candidate = Awaited<ReturnType<typeof orpc.mail.listUnsubscribeCandidates>>[number];
type BulkResult = Awaited<ReturnType<typeof orpc.mail.unsubscribeBulk>>;
type SenderOutcome = BulkResult["senders"][number];

// Mirrors the procedure's own max on `senders`; a bigger tick set is sent in two presses.
const BULK_LIMIT = 50;

const focus_ring = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info";
const checkbox_input = clsx("h-4 w-4 rounded border-gray-300 text-accent dark:border-dark-border dark:bg-dark-bg", focus_ring);

function candidateKey(candidate: Pick<Candidate, "mailbox_label" | "from_address">): string {
  return `${candidate.mailbox_label}:${candidate.from_address}`;
}

// A one-click POST, or a mailto the server emails. A plain link is neither, and stays on the full page.
export function isTickable(candidate: Pick<Candidate, "one_click" | "target">): boolean {
  return candidate.one_click || candidate.target.http === null;
}

const policy_wording: Record<SenderOutcome["policy"], string> = {
  created: "rule created at auto",
  promoted: "rule promoted to auto",
  left: "existing rule left as it was",
};

function senderTone(outcome: SenderOutcome): BannerTone {
  if (outcome.errors.length > 0 || outcome.failed > 0 || outcome.attempt?.status === "failed") {
    return "danger";
  }
  if (outcome.attempt?.status === "skipped" || outcome.policy === "left" || outcome.refused > 0) {
    return "warning";
  }
  return "success";
}

function attemptLabel(attempt: NonNullable<SenderOutcome["attempt"]>): string {
  if (attempt.status === "skipped") {
    return "skipped";
  }
  const method = attempt.method === "mailto" ? "email" : "one-click";
  if (attempt.status === "sent") {
    return `${method} sent`;
  }
  return `${method} ${attempt.status} · ${attempt.error ?? "no response"}`;
}

function senderLine(outcome: SenderOutcome): string {
  const attempt = outcome.attempt === null ? "unsubscribe not recorded" : `unsubscribe ${attemptLabel(outcome.attempt)}`;
  const counts = [`${outcome.archived} archived`];
  if (outcome.failed > 0) {
    counts.push(`${outcome.failed} failed`);
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

export const UnsubscribePicker: FC<{ candidates: Candidate[] }> = ({ candidates }) => {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<OutcomeBanner | null>(null);
  const [result, setResult] = useState<BulkResult | null>(null);

  const tickable = candidates.filter(isTickable);

  // Rows are keyed by (mailbox, address), so one address ticked in two mailboxes is one sender: the
  // count and what the press sends both come from this one deduped list.
  const selected_addresses = tickable
    .filter((candidate) => selected.has(candidateKey(candidate)))
    .map((candidate) => candidate.from_address)
    .filter((address, index, addresses) => addresses.findIndex((other) => other.toLowerCase() === address.toLowerCase()) === index);
  const distinct_addresses = selected_addresses.length;
  const all_selected = tickable.length > 0 && tickable.every((candidate) => selected.has(candidateKey(candidate)));

  const toggle = (key: string) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const runBulk = async () => {
    setBusy(true);
    setResult(null);
    setBanner({
      text: `Unsubscribing ${distinct_addresses} sender${distinct_addresses === 1 ? "" : "s"} — sending, writing rules, archiving…`,
      tone: "info",
    });
    try {
      const outcome = await orpc.mail.unsubscribeBulk({
        senders: selected_addresses.slice(0, BULK_LIMIT).map((from_address) => ({ from_address })),
      });
      setResult(outcome);
      const archived = outcome.senders.reduce((sum, sender) => sum + sender.archived, 0);
      const sent = outcome.senders.filter((sender) => sender.attempt?.status === "sent").length;
      setBanner({
        text: `${sent} of ${outcome.senders.length} unsubscribe request${outcome.senders.length === 1 ? "" : "s"} accepted; ${archived} message${archived === 1 ? "" : "s"} archived${outcome.more_waiting ? "; the rest waits for the next tick" : ""}.`,
        tone: outcome.mailbox_errors.length > 0 ? "warning" : "success",
      });
      setSelected(new Set());
      await router.invalidate();
    } catch (error) {
      setBanner(toFailureBanner("Unsubscribe failed", error));
    } finally {
      setBusy(false);
    }
  };

  if (tickable.length === 0) {
    return <p className="text-sm text-zinc-600 dark:text-dark-text">Nobody is offering a way off their list right now.</p>;
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-zinc-600 dark:text-dark-text">
          <input
            checked={all_selected}
            className={checkbox_input}
            disabled={busy}
            onChange={() => setSelected(all_selected ? new Set() : new Set(tickable.map(candidateKey)))}
            type="checkbox"
          />
          Select all
        </label>
        <ActionButton
          busy={busy}
          disabled={busy || distinct_addresses === 0}
          label={`Unsubscribe and archive ${distinct_addresses} sender${distinct_addresses === 1 ? "" : "s"}`}
          onClick={() => void runBulk()}
          variant={clsx(accent_button, focus_ring)}
        />
        {distinct_addresses > BULK_LIMIT && (
          <span className="text-xs text-zinc-500 dark:text-dark-text">
            The first {BULK_LIMIT} go in this press; tick the rest afterwards.
          </span>
        )}
      </div>
      {banner !== null && <Banner banner={banner} className="mb-3" />}
      {result !== null && (
        <ul className="mb-3 flex flex-col gap-1">
          {result.senders.map((outcome) => (
            <li className={clsx("rounded border p-2 text-sm", banner_style[senderTone(outcome)])} key={outcome.from_address}>
              {senderLine(outcome)}
            </li>
          ))}
          {result.mailbox_errors.map((entry) => (
            <li className={clsx("rounded border p-2 text-sm", banner_style.warning)} key={entry.label}>
              {entry.label}: {entry.error}
            </li>
          ))}
        </ul>
      )}
      <ul className="flex flex-col gap-1">
        {tickable.map((candidate) => (
          <li
            className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-zinc-100 border-b py-2 last:border-0 dark:border-dark-border"
            key={candidateKey(candidate)}
          >
            <input
              checked={selected.has(candidateKey(candidate))}
              className={checkbox_input}
              disabled={busy}
              onChange={() => toggle(candidateKey(candidate))}
              type="checkbox"
            />
            <span className="w-16 shrink-0 text-right font-medium tabular-nums">{candidate.in_inbox}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-zinc-900 dark:text-dark-headings">{candidate.from_address}</span>
              {candidate.sample_subject !== null && (
                <span className="block truncate text-xs text-zinc-500 dark:text-dark-text">{candidate.sample_subject}</span>
              )}
            </span>
            <span className="shrink-0 text-xs text-zinc-500 dark:text-dark-text">
              {candidate.one_click ? "one-click" : "by email"} · {candidate.total} total · {candidate.mailbox_label}
            </span>
            {candidate.has_policy && (
              <span className="shrink-0 rounded bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-dark-bg dark:text-dark-text">
                rule exists
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
};
