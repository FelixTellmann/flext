import { createFileRoute } from "@tanstack/react-router";
import clsx from "clsx";
import type { FC } from "react";
import { orpc } from "~/integrations/orpc";
import { Panel, secondary_button } from "./-ui";

type Candidate = Awaited<ReturnType<typeof orpc.mail.listUnsubscribeCandidates>>[number];

const CANDIDATE_LIMIT = 60;

// Every rule in this system hides mail. Archive moves it, file moves it, even trash only moves it.
// Unsubscribing is the only action that reduces the volume rather than relocating it, and the data has
// been sitting on every message since Phase 1 with nothing reading it.
const Unsubscribe: FC = () => {
  const candidates = Route.useLoaderData();
  const with_link = candidates.filter((candidate) => candidate.target.http !== null);
  const mailto_only = candidates.filter((candidate) => candidate.target.http === null);
  const reachable = with_link.reduce((sum, candidate) => sum + candidate.in_inbox, 0);

  return (
    <div className="flex flex-col gap-6">
      <Panel title="Stop mail arriving">
        <p className="mb-2 text-sm text-zinc-600 dark:text-dark-text">
          Senders who offer a way off their list, busiest first. Every rule elsewhere in here only hides mail; this is the one thing that
          stops it being sent.
        </p>
        <p className="text-sm text-zinc-600 dark:text-dark-text">
          Opening a link is on you — nothing here clicks anything on your behalf. Unsubscribing and keeping a rule are not alternatives: the
          rule handles what has already arrived, and the link handles the rest.
        </p>
      </Panel>

      <Panel title={`One click away (${with_link.length} senders, ${reachable} still reaching an inbox)`}>
        {with_link.length === 0 && <p className="text-sm text-zinc-600 dark:text-dark-text">Nothing to unsubscribe from.</p>}
        <ul className="flex flex-col gap-1">
          {with_link.map((candidate) => (
            <Row candidate={candidate} key={`${candidate.mailbox_label}:${candidate.from_address}`} />
          ))}
        </ul>
      </Panel>

      {mailto_only.length > 0 && (
        <Panel title={`Reply-to-unsubscribe only (${mailto_only.length})`}>
          <p className="mb-2 text-sm text-zinc-600 dark:text-dark-text">
            These offer no link, only an address to email. That needs a message sent from your account, which this system has never done and
            is not about to start doing quietly. Copy the address into your mail client if you want off the list.
          </p>
          <ul className="flex flex-col gap-1">
            {mailto_only.map((candidate) => (
              <li className="text-sm" key={`${candidate.mailbox_label}:${candidate.from_address}`}>
                <span className="text-zinc-900 dark:text-dark-headings">{candidate.from_address}</span>{" "}
                <span className="text-zinc-500 dark:text-dark-text">
                  {candidate.in_inbox} in inbox — <code>{candidate.target.mailto}</code>
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
};

const Row: FC<{ candidate: Candidate }> = ({ candidate }) => (
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
    <a className={clsx(secondary_button, "shrink-0")} href={candidate.target.http ?? "#"} rel="noreferrer noopener" target="_blank">
      Unsubscribe
    </a>
  </li>
);

export const Route = createFileRoute("/admin/unsubscribe")({
  loader: () => orpc.mail.listUnsubscribeCandidates({ limit: CANDIDATE_LIMIT }),
  component: Unsubscribe,
});
