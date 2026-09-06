import { createFileRoute, useRouter } from "@tanstack/react-router";
import clsx from "clsx";
import { type FC, useState } from "react";
import { orpc } from "~/integrations/orpc";
import type { BannerTone, OutcomeBanner } from "./-outcome-banner";
import { Banner, banner_style, toFailureBanner } from "./-outcome-banner";
import { ActionButton, accent_button, Panel, secondary_button } from "./-ui";

type Candidate = Awaited<ReturnType<typeof orpc.mail.listUnsubscribeCandidates>>[number];
type BulkResult = Awaited<ReturnType<typeof orpc.mail.unsubscribeBulk>>;
type SenderOutcome = BulkResult["senders"][number];
type LastAttempt = NonNullable<Candidate["last_attempt"]>;

const CANDIDATE_LIMIT = 60;
// Mirrors the procedure's own max on `senders`; a bigger tick set is sent in two presses.
const BULK_LIMIT = 50;

const focus_ring = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info";
const checkbox_input = clsx("h-4 w-4 rounded border-gray-300 text-accent dark:border-dark-border dark:bg-dark-bg", focus_ring);
const accent_button_focus = clsx(accent_button, focus_ring);
const secondary_button_focus = clsx(secondary_button, focus_ring);

function candidateKey(candidate: Pick<Candidate, "mailbox_label" | "from_address">): string {
  return `${candidate.mailbox_label}:${candidate.from_address}`;
}

const attempt_tone: Record<LastAttempt["status"], BannerTone> = {
  sent: "success",
  failed: "danger",
  skipped: "info",
};

function attemptLabel(attempt: LastAttempt): string {
  if (attempt.status === "skipped") {
    return "skipped";
  }
  return attempt.response_code === null
    ? `${attempt.status} · ${attempt.error ?? "no response"}`
    : `${attempt.status} ${attempt.response_code}`;
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

// Every rule in this system hides mail. Archive moves it, file moves it, even trash only moves it.
// Unsubscribing is the only action that reduces the volume rather than relocating it.
const Unsubscribe: FC = () => {
  const candidates = Route.useLoaderData();
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<OutcomeBanner | null>(null);
  const [result, setResult] = useState<BulkResult | null>(null);

  const one_click = candidates.filter((candidate) => candidate.one_click);
  const link_only = candidates.filter((candidate) => !candidate.one_click && candidate.target.http !== null);
  const mailto_only = candidates.filter((candidate) => candidate.target.http === null);
  const reachable = one_click.reduce((sum, candidate) => sum + candidate.in_inbox, 0);

  const selected_senders = one_click.filter((candidate) => selected.has(candidateKey(candidate)));
  const distinct_addresses = new Set(selected_senders.map((candidate) => candidate.from_address.toLowerCase())).size;
  const all_one_click_selected = one_click.length > 0 && one_click.every((candidate) => selected.has(candidateKey(candidate)));

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
        senders: selected_senders
          .slice(0, BULK_LIMIT)
          .map((candidate) => ({ from_address: candidate.from_address, mailbox_label: candidate.mailbox_label })),
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

  return (
    <div className="flex flex-col gap-6">
      <Panel title="Stop mail arriving">
        <p className="mb-2 text-sm text-zinc-600 dark:text-dark-text">
          Senders who offer a way off their list, busiest first. Every rule elsewhere in here only hides mail; this is the one thing that
          stops it being sent.
        </p>
        <p className="text-sm text-zinc-600 dark:text-dark-text">
          Ticking senders and pressing the button sends each one-click unsubscribe from the server, creates an archive rule for the address
          switched on and marked read, and archives what is in the inbox now. A guard (flagged, under a day old, never-touch, a snoozed
          thread) keeps a message where it is and says so.
        </p>
      </Panel>

      <Panel title={`One click (${one_click.length} senders, ${reachable} still reaching an inbox)`}>
        {one_click.length === 0 && <p className="text-sm text-zinc-600 dark:text-dark-text">Nothing accepts a one-click unsubscribe.</p>}
        {one_click.length > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-zinc-600 dark:text-dark-text">
              <input
                checked={all_one_click_selected}
                className={checkbox_input}
                disabled={busy}
                onChange={() => setSelected(all_one_click_selected ? new Set() : new Set(one_click.map(candidateKey)))}
                type="checkbox"
              />
              Select all one-click
            </label>
            <ActionButton
              busy={busy}
              disabled={busy || distinct_addresses === 0}
              label={`Unsubscribe and archive ${distinct_addresses} sender${distinct_addresses === 1 ? "" : "s"}`}
              onClick={() => void runBulk()}
              variant={accent_button_focus}
            />
            {distinct_addresses > BULK_LIMIT && (
              <span className="text-xs text-zinc-500 dark:text-dark-text">
                The first {BULK_LIMIT} go in this press; tick the rest afterwards.
              </span>
            )}
          </div>
        )}
        {banner !== null && <Banner banner={banner} className="mb-3" />}
        {result !== null && <BulkOutcome result={result} />}
        <ul className="flex flex-col gap-1">
          {one_click.map((candidate) => (
            <Row
              busy={busy}
              candidate={candidate}
              key={candidateKey(candidate)}
              onToggle={() => toggle(candidateKey(candidate))}
              selected={selected.has(candidateKey(candidate))}
            />
          ))}
        </ul>
      </Panel>

      {link_only.length > 0 && (
        <Panel title={`Link only (${link_only.length})`}>
          <p className="mb-2 text-sm text-zinc-600 dark:text-dark-text">
            These offer a link but not the one-click header, so the server cannot press it for you: a POST to a page that never promised RFC
            8058 is a form nobody reads. Open the link yourself; a rule from the sender screen handles what has already arrived.
          </p>
          <ul className="flex flex-col gap-1">
            {link_only.map((candidate) => (
              <Row busy={busy} candidate={candidate} key={candidateKey(candidate)} onToggle={null} selected={false} />
            ))}
          </ul>
        </Panel>
      )}

      {mailto_only.length > 0 && (
        <Panel title={`Reply-to-unsubscribe only (${mailto_only.length})`}>
          <p className="mb-2 text-sm text-zinc-600 dark:text-dark-text">
            These offer no link, only an address to email. Phase 7 sends those from felix@tellmann.co.za through the same button; until
            then, copy the address into your mail client if you want off the list.
          </p>
          <ul className="flex flex-col gap-1">
            {mailto_only.map((candidate) => (
              <li className="text-sm" key={candidateKey(candidate)}>
                <span className="text-zinc-900 dark:text-dark-headings">{candidate.from_address}</span>{" "}
                <span className="text-zinc-500 dark:text-dark-text">
                  {candidate.in_inbox} in inbox — <code>{candidate.target.mailto}</code>
                </span>
                {candidate.last_attempt !== null && <AttemptChip attempt={candidate.last_attempt} />}
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
};

const AttemptChip: FC<{ attempt: LastAttempt }> = ({ attempt }) => (
  <span
    className={clsx("ml-2 inline-block shrink-0 rounded border px-2 py-0.5 text-xs", banner_style[attempt_tone[attempt.status]])}
    title={`${attempt.method} · ${new Date(attempt.attempted_at).toLocaleString()}${attempt.error === null ? "" : ` · ${attempt.error}`}`}
  >
    {attemptLabel(attempt)}
  </span>
);

const BulkOutcome: FC<{ result: BulkResult }> = ({ result }) => (
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
);

const Row: FC<{ busy: boolean; candidate: Candidate; onToggle: (() => void) | null; selected: boolean }> = ({
  busy,
  candidate,
  onToggle,
  selected,
}) => (
  <li className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-zinc-100 border-b py-2 last:border-0 dark:border-dark-border">
    {onToggle !== null && <input checked={selected} className={checkbox_input} disabled={busy} onChange={onToggle} type="checkbox" />}
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
    <a className={clsx(secondary_button_focus, "shrink-0")} href={candidate.target.http ?? "#"} rel="noreferrer noopener" target="_blank">
      Open link
    </a>
  </li>
);

export const Route = createFileRoute("/admin/unsubscribe")({
  loader: () => orpc.mail.listUnsubscribeCandidates({ limit: CANDIDATE_LIMIT }),
  component: Unsubscribe,
});
