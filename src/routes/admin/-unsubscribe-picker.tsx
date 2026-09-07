import { useRouter } from "@tanstack/react-router";
import clsx from "clsx";
import { type FC, useState } from "react";
import { orpc } from "~/integrations/orpc";
import type { OutcomeBanner } from "./-outcome-banner";
import { Banner, banner_style, toFailureBanner } from "./-outcome-banner";
import { ActionButton, accent_button } from "./-ui";
import type { UnsubscribeAttempt, UnsubscribeBulkResult, UnsubscribeCandidate } from "./-unsubscribe-outcome";
import { attempt_tone, attemptLabel, candidateKey, isTickable, senderLine, senderTone } from "./-unsubscribe-outcome";

// The tickable half of /admin/unsubscribe: the one implementation, rendered there and folded into the
// review page. The wording of what a press did lives in -unsubscribe-outcome.ts.

// Mirrors the procedure's own max on `senders`; a bigger tick set is sent in two presses.
const BULK_LIMIT = 50;

const focus_ring = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info";
const checkbox_input = clsx("h-4 w-4 rounded border-gray-300 text-accent dark:border-dark-border dark:bg-dark-bg", focus_ring);

export const AttemptChip: FC<{ attempt: UnsubscribeAttempt }> = ({ attempt }) => (
  <span
    className={clsx("ml-2 inline-block shrink-0 rounded border px-2 py-0.5 text-xs", banner_style[attempt_tone[attempt.status]])}
    title={`${attempt.method} · ${new Date(attempt.attempted_at).toLocaleString()}${attempt.error === null ? "" : ` · ${attempt.error}`}`}
  >
    {attemptLabel(attempt)}
  </span>
);

export const UnsubscribePicker: FC<{ candidates: UnsubscribeCandidate[] }> = ({ candidates }) => {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<OutcomeBanner | null>(null);
  const [result, setResult] = useState<UnsubscribeBulkResult | null>(null);

  const tickable = candidates.filter(isTickable);

  // Rows are keyed by (mailbox, address), so one address ticked in two mailboxes is one sender: the
  // count, the cap hint and what the press sends all come from this one deduped list.
  const selected_addresses = tickable
    .filter((candidate) => selected.has(candidateKey(candidate)))
    .map((candidate) => candidate.from_address)
    .filter((address, index, addresses) => addresses.findIndex((other) => other.toLowerCase() === address.toLowerCase()) === index);
  const distinct_addresses = selected_addresses.length;
  const all_selected = tickable.length > 0 && tickable.every((candidate) => selected.has(candidateKey(candidate)));
  const pressed_count = Math.min(distinct_addresses, BULK_LIMIT);

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
      text: `Unsubscribing ${pressed_count} sender${pressed_count === 1 ? "" : "s"} — sending, writing rules, archiving…`,
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
          label={`Unsubscribe and archive ${pressed_count} sender${pressed_count === 1 ? "" : "s"}`}
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
              {candidate.total} total · {candidate.mailbox_label}
            </span>
            {candidate.has_policy && (
              <span className="shrink-0 rounded bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-dark-bg dark:text-dark-text">
                rule exists
              </span>
            )}
            {candidate.last_attempt !== null && <AttemptChip attempt={candidate.last_attempt} />}
            <span
              className="shrink-0 rounded bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-dark-bg dark:text-dark-text"
              title={candidate.one_click ? undefined : (candidate.target.mailto ?? undefined)}
            >
              {candidate.one_click ? "one-click" : "by email"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
};
