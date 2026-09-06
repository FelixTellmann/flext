import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import clsx from "clsx";
import { type FC, useState } from "react";
import { orpc } from "~/integrations/orpc";
import type { OutcomeBanner } from "./-outcome-banner";
import { Banner, toFailureBanner } from "./-outcome-banner";
import { visibleRules } from "./-promote-list";
import type { SectionResult } from "./-review-groups";
import { approvalPasses, groupKeyString, settleSection, topProposalGroups } from "./-review-groups";
import { SessionsStrip } from "./-sessions-strip";
import { ActionButton, accent_button, Panel, secondary_button } from "./-ui";
import { UnsubscribePicker } from "./-unsubscribe-picker";

type Candidate = Awaited<ReturnType<typeof orpc.mail.listPromotionCandidates>>[number];
type ProposalReport = Awaited<ReturnType<typeof orpc.mail.listProposalGroups>>;
type ProposalGroup = ProposalReport["groups"][number];

// The same seven the link hub shows: the lead sentence plus six earlier sittings.
const SESSION_STRIP_LIMIT = 7;
// Wide enough that the top-ten cut below is made over the real backlog, as on the pages this folds up.
const RULE_LIMIT = 40;
const GROUP_LIMIT = 40;
const UNSUBSCRIBE_LIMIT = 60;
// Mirrors MAX_ACTION_BATCH_SIZE on the procedures; "Approve all" covers a bigger group in bounded passes.
const GROUP_BATCH_SIZE = 200;

const focus_ring = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info";
const accent_button_focus = clsx(accent_button, focus_ring);
const secondary_button_focus = clsx(secondary_button, focus_ring);
const link_style = clsx("rounded text-info text-sm underline", focus_ring);
const checkbox_input = clsx("h-4 w-4 rounded border-gray-300 text-accent dark:border-dark-border dark:bg-dark-bg", focus_ring);

const SectionError: FC<{ error: string }> = ({ error }) => (
  <p className="rounded border border-danger/40 bg-danger/10 p-2 text-danger text-sm">This section could not load: {error}</p>
);

// The column holds whatever a policy was written with, so an unrecognised value renders as itself.
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

// One row per rule, one button each. The tick is the same reviewed_shadow_record assertion the promote
// page and the per-policy control require: the button does nothing until the row says it has been read.
const RuleRow: FC<{ busy: boolean; candidate: Candidate; onSwitchOn: () => void }> = ({ busy, candidate, onSwitchOn }) => {
  const [read, setRead] = useState(false);

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 border-zinc-100 border-b py-2 last:border-0 dark:border-dark-border">
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline gap-x-2">
          <strong className="text-zinc-900 dark:text-dark-headings">{candidate.value}</strong>
          <span className="text-xs text-zinc-500 dark:text-dark-text">
            {candidate.scope === "domain" ? "whole domain" : "this address"}
          </span>
        </span>
        <span className="block text-sm text-zinc-600 dark:text-dark-text">
          Would <strong>{describeAction(candidate.policy_action)}</strong> <strong>{candidate.waiting}</strong> waiting
          {candidate.rescues > 0 && (
            <span className="ml-2 rounded bg-danger/10 px-2 py-0.5 text-danger text-xs">wrong before: {candidate.rescues} rescued</span>
          )}
        </span>
        {candidate.sample_subjects.length > 0 && (
          <details className="text-xs text-zinc-500 dark:text-dark-text">
            <summary className="cursor-pointer select-none">samples ({candidate.sample_subjects.length})</summary>
            <ul className="mt-1 flex flex-col gap-0.5">
              {[...new Set(candidate.sample_subjects)].map((subject) => (
                <li key={subject}>{subject}</li>
              ))}
            </ul>
          </details>
        )}
      </span>
      <label className="flex shrink-0 items-center gap-2 text-xs text-zinc-600 dark:text-dark-text">
        <input
          checked={read}
          className={checkbox_input}
          disabled={busy}
          onChange={(event) => setRead(event.target.checked)}
          type="checkbox"
        />
        I've read this one
      </label>
      <ActionButton busy={busy} disabled={busy || !read} label="Switch on" onClick={onSwitchOn} variant={accent_button_focus} />
    </li>
  );
};

const RulesWaiting: FC<{ candidates: Candidate[] }> = ({ candidates }) => {
  const router = useRouter();
  const [busy_id, setBusyId] = useState<string | null>(null);
  const [banner, setBanner] = useState<OutcomeBanner | null>(null);

  const movers = candidates.filter((candidate) => candidate.moves_mail);
  const { visible, hidden } = visibleRules(movers, false);

  const switchOn = async (candidate: Candidate) => {
    setBusyId(candidate.policy_id);
    setBanner(null);
    try {
      const result = await orpc.mail.promotePolicyAutonomy({ sender_policy_id: candidate.policy_id, reviewed_shadow_record: true });
      setBanner(
        result.outcome === "promoted"
          ? {
              text: `${candidate.value} is on. Its ${candidate.waiting} waiting emails go over the next ticks; demote it from the Senders page to stop.`,
              tone: "success",
            }
          : { text: `${candidate.value} was refused (${result.gate}): ${result.detail}`, tone: "warning" },
      );
      await router.invalidate();
    } catch (error) {
      setBanner(toFailureBanner("Switch on failed", error));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <p className="mb-2 text-sm text-zinc-600 dark:text-dark-text">
        Rules that have been deciding in the background and never allowed to act, biggest backlog first. Switching one on is you saying
        you've read what it would do; it is reversible from the Senders page.
      </p>
      {banner !== null && <Banner banner={banner} className="mb-3" />}
      {movers.length === 0 && <p className="text-sm text-zinc-600 dark:text-dark-text">Nothing waiting to be switched on.</p>}
      <ul className="flex flex-col">
        {visible.map((candidate) => (
          <RuleRow busy={busy_id !== null} candidate={candidate} key={candidate.policy_id} onSwitchOn={() => void switchOn(candidate)} />
        ))}
      </ul>
      {hidden > 0 && (
        <Link className={clsx(link_style, "mt-3 inline-block")} search={{ all: true }} to="/admin/promote">
          Show all {movers.length} on the full page
        </Link>
      )}
    </>
  );
};

type GroupOutcome = { banner: OutcomeBanner; done: boolean };

const ProposalGroupRow: FC<{
  busy: boolean;
  group: ProposalGroup;
  onApprove: () => void;
  onDismiss: () => void;
  outcome: GroupOutcome | undefined;
}> = ({ busy, group, onApprove, onDismiss, outcome }) => (
  <li className="border-zinc-100 border-b py-3 last:border-0 dark:border-dark-border">
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline gap-x-2">
          <strong className="text-zinc-900 dark:text-dark-headings">{group.rule_label}</strong>
          <span className="text-xs text-zinc-500 dark:text-dark-text">{group.rule_note}</span>
        </span>
        <span className="block text-sm text-zinc-600 dark:text-dark-text">
          Would <strong>{group.action_label}</strong> <strong>{group.count}</strong> in {group.mailbox_label}
        </span>
      </span>
      {group.destructive ? (
        <Link className={link_style} to="/admin/shadow">
          Deletes — approve on the shadow page
        </Link>
      ) : (
        <ActionButton
          busy={busy}
          disabled={busy || outcome?.done === true}
          label="Approve all"
          onClick={onApprove}
          variant={accent_button_focus}
        />
      )}
      <ActionButton
        busy={busy}
        disabled={busy || outcome?.done === true}
        label="Dismiss"
        onClick={onDismiss}
        variant={secondary_button_focus}
      />
    </div>
    {group.sample_subjects.length > 0 && (
      <details className="mt-1 text-xs text-zinc-500 dark:text-dark-text">
        <summary className="cursor-pointer select-none">samples ({group.sample_subjects.length})</summary>
        <ul className="mt-1 flex flex-col gap-0.5">
          {group.sample_subjects.map((subject) => (
            <li key={subject}>{subject}</li>
          ))}
        </ul>
      </details>
    )}
    {outcome !== undefined && <Banner banner={outcome.banner} className="mt-2" />}
  </li>
);

// "Approve all" is bounded by the count on screen: as many 200-row passes as that count needs, stopping
// early when a pass moves nothing. A group that grew under the loop waits for the next press.
const ProposalGroups: FC<{ report: ProposalReport }> = ({ report }) => {
  const router = useRouter();
  const [busy_key, setBusyKey] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<Record<string, GroupOutcome>>({});

  const { visible, hidden_groups, hidden_proposals } = topProposalGroups(report.groups);

  const runGroup = async (group: ProposalGroup, verb: "approve" | "dismiss") => {
    const key = groupKeyString(group.key);
    setBusyKey(key);
    try {
      let changed = 0;
      let remaining = group.count;
      for (let pass = 0; pass < approvalPasses(group.count, GROUP_BATCH_SIZE); pass += 1) {
        const result =
          verb === "approve"
            ? await orpc.mail.approveProposalGroup({ key: group.key, batch_size: GROUP_BATCH_SIZE })
            : await orpc.mail.dismissProposalGroup({ key: group.key, batch_size: GROUP_BATCH_SIZE });
        changed += result.changed;
        remaining = result.remaining;
        if (result.changed === 0) {
          break;
        }
      }
      const tail = remaining > 0 ? ` ${remaining} still waiting — press again.` : "";
      const text =
        verb === "approve"
          ? `Approved ${changed} of ${group.count}. They are pending now — no message has moved until an apply run picks them up.${tail}`
          : `Dismissed ${changed} of ${group.count}. Nothing was sent to the mailbox.${tail}`;
      setOutcomes((current) => ({ ...current, [key]: { banner: { text, tone: "success" }, done: remaining === 0 } }));
      await router.invalidate();
    } catch (error) {
      setOutcomes((current) => ({
        ...current,
        [key]: { banner: toFailureBanner(verb === "approve" ? "Approve failed" : "Dismiss failed", error), done: false },
      }));
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <>
      <p className="mb-2 text-sm text-zinc-600 dark:text-dark-text">
        What the rules would do to mail already here, one line per rule and mailbox. Approving queues the moves for the next apply run;
        dismissing drops them and touches nothing. {report.total_proposals} proposals in {report.total_groups} groups.
      </p>
      {report.groups.length === 0 && <p className="text-sm text-zinc-600 dark:text-dark-text">Nothing is waiting for approval.</p>}
      <ul className="flex flex-col">
        {visible.map((group) => (
          <ProposalGroupRow
            busy={busy_key === groupKeyString(group.key)}
            group={group}
            key={groupKeyString(group.key)}
            onApprove={() => void runGroup(group, "approve")}
            onDismiss={() => void runGroup(group, "dismiss")}
            outcome={outcomes[groupKeyString(group.key)]}
          />
        ))}
      </ul>
      {(hidden_groups > 0 || report.total_groups > report.groups.length) && (
        <Link className={clsx(link_style, "mt-3 inline-block")} to="/admin/shadow">
          {hidden_proposals > 0 ? `${hidden_proposals} more in ${hidden_groups} smaller groups` : "The rest"} on the shadow page
        </Link>
      )}
    </>
  );
};

const Review: FC = () => {
  const { loaded_at, sessions, rules, proposals, unsubscribe } = Route.useLoaderData();

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-zinc-600 dark:text-dark-text">
        The Monday pass in one page: what to switch on, what to approve, what to stop. The full pages stay for the deep dives.
      </p>

      {sessions.ok ? (
        <SessionsStrip loaded_at={loaded_at} sessions={sessions.value} title="When you last read mail" />
      ) : (
        <Panel title="When you last read mail">
          <SectionError error={sessions.error} />
        </Panel>
      )}

      <Panel title="Rules waiting to be switched on">
        {rules.ok ? <RulesWaiting candidates={rules.value} /> : <SectionError error={rules.error} />}
      </Panel>

      <Panel title="Proposals waiting for your approval">
        {proposals.ok ? <ProposalGroups report={proposals.value} /> : <SectionError error={proposals.error} />}
      </Panel>

      <Panel title="Senders to unsubscribe">
        <p className="mb-2 text-sm text-zinc-600 dark:text-dark-text">
          Busiest first, still reaching an inbox. One press sends the unsubscribe, writes an archive rule and archives what is here now.{" "}
          <Link className={link_style} to="/admin/unsubscribe">
            Link-only senders and the details are on the full page.
          </Link>
        </p>
        {unsubscribe.ok ? <UnsubscribePicker candidates={unsubscribe.value} /> : <SectionError error={unsubscribe.error} />}
      </Panel>
    </div>
  );
};

type ReviewSections = {
  loaded_at: string;
  sessions: SectionResult<Awaited<ReturnType<typeof orpc.mail.listRecentAttentionSessions>>>;
  rules: SectionResult<Candidate[]>;
  proposals: SectionResult<ProposalReport>;
  unsubscribe: SectionResult<Awaited<ReturnType<typeof orpc.mail.listUnsubscribeCandidates>>>;
};

export const Route = createFileRoute("/admin/review")({
  loader: async (): Promise<ReviewSections> => {
    const [sessions, rules, proposals, unsubscribe] = await Promise.allSettled([
      orpc.mail.listRecentAttentionSessions({ limit: SESSION_STRIP_LIMIT }),
      orpc.mail.listPromotionCandidates({ limit: RULE_LIMIT }),
      orpc.mail.listProposalGroups({ limit: GROUP_LIMIT }),
      orpc.mail.listUnsubscribeCandidates({ limit: UNSUBSCRIBE_LIMIT }),
    ]);
    return {
      loaded_at: new Date().toISOString(),
      sessions: settleSection(sessions),
      rules: settleSection(rules),
      proposals: settleSection(proposals),
      unsubscribe: settleSection(unsubscribe),
    };
  },
  component: Review,
});
