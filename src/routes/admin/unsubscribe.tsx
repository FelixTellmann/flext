import { createFileRoute } from "@tanstack/react-router";
import clsx from "clsx";
import type { FC } from "react";
import { orpc } from "~/integrations/orpc";
import { Panel, secondary_button } from "./-ui";
import type { UnsubscribeCandidate } from "./-unsubscribe-outcome";
import { candidateKey, isTickable } from "./-unsubscribe-outcome";
import { AttemptChip, UnsubscribePicker } from "./-unsubscribe-picker";

const CANDIDATE_LIMIT = 60;

const focus_ring = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info";
const secondary_button_focus = clsx(secondary_button, focus_ring);

// Every rule in this system hides mail. Archive moves it, file moves it, even trash only moves it.
// Unsubscribing is the only action that reduces the volume rather than relocating it.
const Unsubscribe: FC = () => {
  const candidates = Route.useLoaderData();

  const tickable = candidates.filter(isTickable);
  const link_only = candidates.filter((candidate) => !isTickable(candidate));
  const reachable = tickable.reduce((sum, candidate) => sum + candidate.in_inbox, 0);

  return (
    <div className="flex flex-col gap-6">
      <Panel title="Stop mail arriving">
        <p className="mb-2 text-sm text-zinc-600 dark:text-dark-text">
          Senders who offer a way off their list, busiest first. Every rule elsewhere in here only hides mail; this is the one thing that
          stops it being sent.
        </p>
        <p className="text-sm text-zinc-600 dark:text-dark-text">
          Ticking senders and pressing the button sends each unsubscribe from the server (a one-click POST, or an email from
          felix@tellmann.co.za where the sender only offers an address), creates an archive rule for the address switched on and marked
          read, and archives what is in the inbox now. A guard (flagged, under a day old, never-touch, a snoozed thread) keeps a message
          where it is and says so.
        </p>
      </Panel>

      <Panel title={`One click or by email (${tickable.length} senders, ${reachable} still reaching an inbox)`}>
        <UnsubscribePicker candidates={candidates} />
      </Panel>

      {link_only.length > 0 && (
        <Panel title={`Link only (${link_only.length})`}>
          <p className="mb-2 text-sm text-zinc-600 dark:text-dark-text">
            These offer a link but not the one-click header, so the server cannot press it for you: a POST to a page that never promised RFC
            8058 is a form nobody reads. Open the link yourself; a rule from the sender screen handles what has already arrived.
          </p>
          <ul className="flex flex-col gap-1">
            {link_only.map((candidate) => (
              <LinkOnlyRow candidate={candidate} key={candidateKey(candidate)} />
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
};

const LinkOnlyRow: FC<{ candidate: UnsubscribeCandidate }> = ({ candidate }) => (
  <li className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-zinc-100 border-b py-2 last:border-0 dark:border-dark-border">
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
    {candidate.target.http !== null && (
      <a className={clsx(secondary_button_focus, "shrink-0")} href={candidate.target.http} rel="noreferrer noopener" target="_blank">
        Open link
      </a>
    )}
  </li>
);

export const Route = createFileRoute("/admin/unsubscribe")({
  loader: () => orpc.mail.listUnsubscribeCandidates({ limit: CANDIDATE_LIMIT }),
  component: Unsubscribe,
});
