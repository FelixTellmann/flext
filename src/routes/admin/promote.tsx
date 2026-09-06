import { createFileRoute, useRouter } from "@tanstack/react-router";
import clsx from "clsx";
import { type FC, useState } from "react";
import { orpc } from "~/integrations/orpc";
import { ActionButton, accent_button, Panel, secondary_button } from "./-ui";

type Candidate = Awaited<ReturnType<typeof orpc.mail.listPromotionCandidates>>[number];
type BatchResult = Awaited<ReturnType<typeof orpc.mail.promotePolicyAutonomyBulk>>;

const CANDIDATE_LIMIT = 40;

// Promotion is gated on the operator having reviewed a policy's shadow record, and that gate was doing the
// opposite of its job: reviewing 113 policies one screen at a time is a gate nobody passes, and as of
// 2026-08-26 not one policy in this system had ever been promoted. Every rule was still only watching.
//
// This page does not weaken the gate. It puts the evidence for the biggest policies in one place so the
// review can actually happen, and the tick below is the same reviewed_shadow_record assertion the
// per-policy control has always required.
const TurnRulesOn: FC = () => {
  const candidates = Route.useLoaderData();
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<BatchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const movers = candidates.filter((candidate) => candidate.moves_mail);
  const pins = candidates.filter((candidate) => !candidate.moves_mail);
  const selected_total = movers
    .filter((candidate) => selected.has(candidate.policy_id))
    .reduce((sum, candidate) => sum + candidate.waiting, 0);

  const toggle = (policy_id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(policy_id)) {
        next.delete(policy_id);
      } else {
        next.add(policy_id);
      }
      return next;
    });
  };

  const promote = async () => {
    setError(null);
    setBusy(true);
    try {
      const outcome = await orpc.mail.promotePolicyAutonomyBulk({
        sender_policy_ids: [...selected],
        reviewed_shadow_record: true,
      });
      setResult(outcome);
      setSelected(new Set());
      await router.invalidate();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <Panel title="Turn rules on">
        <p className="mb-2 text-sm text-zinc-600 dark:text-dark-text">
          These rules have been deciding in the background and have never been allowed to act. Read what each one would do, tick the ones
          you're happy with, and switch them on together.
        </p>
        <p className="text-sm text-zinc-600 dark:text-dark-text">
          Ticking a row is you saying you've read its record — the same confirmation the single-policy control asks for. Turning one on is
          reversible: demote it from the Senders page and it goes back to watching.
        </p>
      </Panel>

      {error !== null && <p className="rounded bg-danger/10 p-3 text-danger text-sm">{error}</p>}

      {result !== null && (
        <Panel title="Result">
          <p className="mb-2 text-sm">
            Switched on <strong>{result.promoted}</strong>
            {result.refused > 0 && (
              <>
                , refused <strong>{result.refused}</strong>
              </>
            )}
            .
          </p>
          {result.results
            .filter((entry) => entry.outcome === "refused")
            .map((entry) => (
              <p className="text-sm text-zinc-600 dark:text-dark-text" key={entry.sender_policy_id}>
                <code>{entry.sender_policy_id}</code> — {entry.outcome === "refused" ? entry.detail : ""}
              </p>
            ))}
        </Panel>
      )}

      <Panel title={`Rules that would move mail (${movers.length})`}>
        {movers.length === 0 && <p className="text-sm text-zinc-600 dark:text-dark-text">Nothing waiting to be turned on.</p>}
        <ul className="flex flex-col gap-2">
          {movers.map((candidate) => (
            <CandidateRow
              candidate={candidate}
              key={candidate.policy_id}
              onToggle={() => toggle(candidate.policy_id)}
              selected={selected.has(candidate.policy_id)}
            />
          ))}
        </ul>
      </Panel>

      {movers.length > 0 && (
        <div className="sticky bottom-4 flex items-center gap-3 rounded border border-zinc-200 bg-white p-3 dark:border-dark-border dark:bg-dark-bg">
          <span className="text-sm">
            <strong>{selected.size}</strong> selected, covering <strong>{selected_total}</strong> emails
          </span>
          <ActionButton
            busy={busy}
            disabled={busy || selected.size === 0}
            label="Switch these on"
            onClick={() => void promote()}
            variant={accent_button}
          />
          <button className={secondary_button} onClick={() => setSelected(new Set(movers.map((row) => row.policy_id)))} type="button">
            Select all
          </button>
          <button className={secondary_button} onClick={() => setSelected(new Set())} type="button">
            Clear
          </button>
        </div>
      )}

      {pins.length > 0 && (
        <Panel title={`Rules that keep mail in your inbox (${pins.length})`}>
          <p className="mb-2 text-sm text-zinc-600 dark:text-dark-text">
            These say "leave this in the inbox", so switching them on moves nothing. They're worth having — a rule like this is what pins a
            sender in place so the weekly sweep never touches them — but they don't belong in a batch you're turning on to clear the
            backlog.
          </p>
          <ul className="flex flex-col gap-1">
            {pins.map((candidate) => (
              <li className="text-sm text-zinc-600 dark:text-dark-text" key={candidate.policy_id}>
                {candidate.scope}:{candidate.value} — {candidate.waiting} emails
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
};

const CandidateRow: FC<{ candidate: Candidate; selected: boolean; onToggle: () => void }> = ({ candidate, selected, onToggle }) => (
  <li
    className={clsx(
      "rounded border p-3",
      selected ? "border-accent bg-accent/5 dark:border-accent-dark" : "border-zinc-200 dark:border-dark-border",
    )}
  >
    <label className="flex cursor-pointer items-start gap-3">
      <input checked={selected} className="mt-1" onChange={onToggle} type="checkbox" />
      <span className="flex-1">
        <span className="flex flex-wrap items-baseline gap-x-2">
          <strong className="text-zinc-900 dark:text-dark-headings">{candidate.value}</strong>
          <span className="text-sm text-zinc-600 dark:text-dark-text">
            {candidate.scope === "domain" ? "whole domain" : "this address"}
          </span>
        </span>
        <span className="mt-1 block text-sm">
          Would <strong>{describeAction(candidate.policy_action)}</strong> <strong>{candidate.waiting}</strong> emails
          {candidate.rescues > 0 && (
            <span className="ml-2 rounded bg-danger/10 px-2 py-0.5 text-danger text-xs">
              {candidate.rescues} you went back and read after it acted — check this one
            </span>
          )}
        </span>
        {candidate.sample_subjects.length > 0 && (
          <span className="mt-1 block text-xs text-zinc-500 dark:text-dark-text">
            e.g. {candidate.sample_subjects.slice(0, 3).join(" · ")}
          </span>
        )}
      </span>
    </label>
  </li>
);

// The column holds whatever a policy was written with, so an unrecognised value renders as itself rather
// than being forced into one of the four this page knows about.
function describeAction(policy_action: string): string {
  if (policy_action === "archive") {
    return "archive";
  }
  if (policy_action === "file") {
    return "file";
  }
  if (policy_action === "auto_trash") {
    return "bin";
  }
  return policy_action;
}

export const Route = createFileRoute("/admin/promote")({
  loader: () => orpc.mail.listPromotionCandidates({ limit: CANDIDATE_LIMIT }),
  component: TurnRulesOn,
});
