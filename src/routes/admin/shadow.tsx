import { createFileRoute, useRouter } from "@tanstack/react-router";
import clsx from "clsx";
import { type FC, useState } from "react";
import { z } from "zod";
import { orpc } from "~/integrations/orpc";
import type { KindCategory } from "./-shadow-kinds";
import { classifyKind } from "./-shadow-kinds";
import { ActionButton, accent_button, field, Panel, secondary_button } from "./-ui";

const shadow_search_schema = z.object({
  policy_id: z.string().optional(),
  mailbox_id: z.string().optional(),
});

type ShadowSearch = z.infer<typeof shadow_search_schema>;
type ShadowReport = Awaited<ReturnType<typeof orpc.mail.getShadowSummary>>;
type ShadowSampleMessage = ShadowReport["sample"][number];
type MessageLocation = ShadowSampleMessage["location"];
type PolicyRow = Awaited<ReturnType<typeof orpc.mail.listPolicies>>[number];
type MailboxRow = Awaited<ReturnType<typeof orpc.mail.listMailboxes>>[number];
type ApprovableRow = Awaited<ReturnType<typeof orpc.mail.listActionJournal>>["rows"][number];

// Approval names one action or one policy, never a run: a single shadow pass journals a decision for
// almost every message in a mailbox, and a control that promoted "everything on screen" would be one
// click away from all of them.
const APPROVAL_LIST_LIMIT = 25;

// The decisions this policy left in shadow for one mailbox — the only rows the per-decision approval on
// this page can name. Both ids are required because approveDecision matches the action's own mailbox.
function loadApprovableDecisions(deps: ShadowSearch) {
  if (deps.policy_id === undefined || deps.mailbox_id === undefined) {
    return Promise.resolve(null);
  }
  return orpc.mail.listActionJournal({
    mailbox_id: deps.mailbox_id,
    sender_policy_id: deps.policy_id,
    sender_address: null,
    status: "shadow",
    since: null,
    until: null,
    limit: APPROVAL_LIST_LIMIT,
    offset: 0,
  });
}

export const Route = createFileRoute("/admin/shadow")({
  validateSearch: shadow_search_schema,
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const [mailboxes, policies, summary, policy_report, approvable] = await Promise.all([
      orpc.mail.listMailboxes(),
      orpc.mail.listPolicies({ scope: "all", suspended: "all", search: null }),
      orpc.mail.getShadowSummary(),
      deps.policy_id === undefined ? Promise.resolve(null) : orpc.mail.getShadowReport({ policy_id: deps.policy_id }),
      loadApprovableDecisions(deps),
    ]);
    return { mailboxes, policies, summary, policy_report, approvable };
  },
  component: AdminShadowPage,
});

const focus_ring = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info";
const accent_button_focus = clsx(accent_button, focus_ring);
const secondary_button_focus = clsx(secondary_button, focus_ring);

// Mirrors POLICY_ACTIONS in server/mail/classify/rules.ts — an admin route can't import a server value
// without pulling the classify module into the client bundle (same reasoning as senders.tsx).
const policy_action_label: Record<string, string> = {
  keep_inbox: "Keep inbox",
  archive: "Archive",
  file: "File",
  auto_trash: "Auto-trash",
};

// Mirrors action.kind values a shadow decision can carry (server/mail/classify/rules.ts's ActionClass
// plus "needs_action"), for display only.
const kind_label: Record<string, string> = {
  keep_inbox: "Keep inbox",
  archive: "Archive",
  file: "File",
  auto_trash: "Auto-trash",
  purge: "Purge",
  needs_action: "Needs action",
};

const source_label: Record<string, string> = {
  address_policy: "Address policy applied",
  domain_policy: "Domain policy applied",
  suspended_policy: "Suppressed — policy suspended",
  guard: "Suppressed by guard",
  thread_state: "Suppressed — thread snoozed/done",
  derived: "Derived default, no policy",
  fallback: "No rule matched",
};

const kind_category_style: Record<KindCategory, string> = {
  destructive: "bg-danger/10 text-danger",
  organisational: "bg-info/10 text-info",
  retained: "bg-gray-100 text-gray-700 dark:bg-dark-bg dark:text-dark-text",
};

type SourceCategory = "applied" | "suppressed" | "neutral";

const APPLIED_SOURCES = ["address_policy", "domain_policy"];
const SUPPRESSED_SOURCES = ["guard", "suspended_policy", "thread_state"];

// A null source is a row whose `Action.source` is not one of the seven decide() emits (toDecisionSource
// in classify/rules.ts). It must not read as "applied" or "suppressed" — neither is known to be true.
function classifySource(source: string | null): SourceCategory {
  if (source !== null && APPLIED_SOURCES.includes(source)) {
    return "applied";
  }
  if (source !== null && SUPPRESSED_SOURCES.includes(source)) {
    return "suppressed";
  }
  return "neutral";
}

function sourceLabel(source: string | null): string {
  if (source === null) {
    return "Unrecognised source";
  }
  return source_label[source] ?? source;
}

const source_category_style: Record<SourceCategory, string> = {
  applied: "bg-success/10 text-success",
  suppressed: "bg-warning/10 text-warning",
  neutral: "bg-gray-100 text-gray-700 dark:bg-dark-bg dark:text-dark-text",
};

const NO_MAILBOX_TOUCHED_STATEMENT =
  "Nothing on this page touches a mailbox — approving included. A shadow pass only reads message metadata already synced to this database and writes a decision row. Approval writes one column on such a row, moving it from shadow to pending; an apply run elsewhere is what later opens a mailbox and moves or deletes anything.";

// Said next to the button as well as at the top of the page, because the gap between "approved" and
// "the message moved" is exactly where an operator concludes the feature is broken. Approval promotes a
// row's status and writes nothing else (promote.ts) — the executor picks it up on its own run.
const APPROVAL_MEANING =
  "Approving promotes a decision from shadow to pending. That is the entire effect: no mailbox is opened, and no message is moved, filed or deleted here. A pending row changes a mailbox only when an apply run later picks it up.";

// promoteAction and promotePolicyActions both match the action's own mailbox column, and Phase 3's shadow
// runner never wrote it (buildShadowActionRow in shadow/run.ts). Those rows are readable and not
// approvable, and saying so is the difference between a known limitation and a button that seems dead.
const NULL_MAILBOX_EXPLANATION =
  "Written by a Phase 3 shadow pass, before decisions recorded their own mailbox. Approval matches that column against the mailbox you pick, so this row cannot be named by either scope — it is here to read.";

// Filing is Phase 5's. The executor marks a promoted `file` row deferred and sends nothing, so approving
// one must not be presented as queueing a move.
const FILE_DEFERRAL_EXPLANATION =
  "Filing has no executor in this phase. Approving this queues it, and an apply run will mark it deferred without sending anything to the mailbox.";

const DESTRUCTIVE_CONFIRMATION_PHRASE = "APPROVE TRASH";

type ApprovalCeremony = {
  // null = no acknowledgement gate: nothing this policy decided will move a message, so a checkbox would
  // be ceremony without a hazard behind it.
  acknowledgement: string | null;
  container: string;
  default_batch_size: string;
  headline: string;
  requires_phrase: boolean;
};

// The ceremony is keyed by the same destructive/organisational split the report is built from, so the
// weight of the gate tracks the weight of the decision rather than a second, hand-maintained opinion about
// which kinds are dangerous. Deleting asks for a typed phrase; moving asks for a checkbox; keeping asks
// for neither.
const approval_ceremony: Record<KindCategory, ApprovalCeremony> = {
  destructive: {
    acknowledgement: "I have read the sample of what would be deleted, and accept that approving queues these messages for the trash.",
    container: "border-danger/40 bg-danger/5",
    default_batch_size: "25",
    headline: "This policy deletes. Approving it in bulk needs the sample above read and the phrase typed.",
    requires_phrase: true,
  },
  organisational: {
    acknowledgement: "I understand these messages will be moved out of the inbox once an apply run picks them up.",
    container: "border-info/40 bg-info/5",
    default_batch_size: "50",
    headline: "This policy moves messages between folders. Nothing it decided will be deleted.",
    requires_phrase: false,
  },
  retained: {
    acknowledgement: null,
    container: "border-gray-200 dark:border-dark-border",
    default_batch_size: "50",
    headline: "This policy leaves messages where they are, so approving it changes nothing in the mailbox either way.",
    requires_phrase: false,
  },
};

type BannerTone = "success" | "info" | "danger";

// A refusal is not a failure: "that row is no longer shadow" means nothing was written and nothing broke,
// and painting it red would read as damage.
const banner_style: Record<BannerTone, string> = {
  success: "border-success/40 bg-success/10 text-success",
  info: "border-info/40 bg-info/10 text-info",
  danger: "border-danger/40 bg-danger/10 text-danger",
};

type ApprovalBanner = { text: string; tone: BannerTone };

const Banner: FC<{ banner: ApprovalBanner }> = ({ banner }) => (
  <p className={clsx("mt-3 rounded border p-2 text-sm", banner_style[banner.tone])}>{banner.text}</p>
);

const LocationLink: FC<{ location: MessageLocation }> = ({ location }) => {
  if (location.kind === "gmail") {
    return (
      <a className={clsx("rounded text-info underline", focus_ring)} href={location.url} rel="noopener noreferrer" target="_blank">
        Open in Gmail
      </a>
    );
  }
  return <span className="max-w-40 truncate text-gray-500 text-xs dark:text-dark-text">{location.folder}</span>;
};

const SampleRow: FC<{ message: ShadowSampleMessage }> = ({ message }) => (
  <li className="flex flex-col gap-1 border-gray-100 border-b py-2 last:border-0 dark:border-dark-border">
    <div className="flex flex-wrap items-center gap-2">
      <span className={clsx("rounded px-1.5 py-0.5 text-xs", kind_category_style[classifyKind(message.kind)])}>
        {kind_label[message.kind] ?? message.kind}
      </span>
      <span className={clsx("rounded px-1.5 py-0.5 text-xs", source_category_style[classifySource(message.source)])}>
        {sourceLabel(message.source)}
      </span>
      <span className="text-gray-400 text-xs dark:text-dark-border">{message.internal_date.slice(0, 10)}</span>
      <LocationLink location={message.location} />
    </div>
    <p className="max-w-xl truncate text-gray-700 text-sm dark:text-dark-text">{message.subject ?? "(no subject)"}</p>
    <p className="max-w-xl truncate text-gray-500 text-xs dark:text-dark-text">{message.from_address ?? "(unknown sender)"}</p>
  </li>
);

const ShadowBreakdown: FC<{ empty_message: string; report: ShadowReport }> = ({ empty_message, report }) => {
  if (report.run_id === null) {
    return <p className="text-gray-600 text-sm dark:text-dark-text">{empty_message}</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded border border-danger/40 bg-danger/10 p-3">
          <dt className="text-danger text-xs">Would be deleted</dt>
          <dd className="font-semibold text-2xl text-danger">{report.destructive_count.toLocaleString()}</dd>
        </div>
        <div className="rounded border border-info/40 bg-info/10 p-3">
          <dt className="text-info text-xs">Would be organised</dt>
          <dd className="font-semibold text-2xl text-info">{report.organisational_count.toLocaleString()}</dd>
        </div>
        <div className="rounded border border-gray-200 p-3 dark:border-dark-border">
          <dt className="text-gray-500 text-xs dark:text-dark-text">Left in place</dt>
          <dd className="font-semibold text-2xl text-gray-900 dark:text-dark-headings">{report.retained_count.toLocaleString()}</dd>
        </div>
      </dl>

      <div>
        <h3 className="mb-1 font-medium text-gray-900 text-sm dark:text-dark-headings">
          By kind ({report.examined.toLocaleString()} examined)
        </h3>
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(report.by_kind).map(([kind, count]) => (
            <span className={clsx("rounded px-1.5 py-0.5 text-xs", kind_category_style[classifyKind(kind)])} key={kind}>
              {kind_label[kind] ?? kind}: {count.toLocaleString()}
            </span>
          ))}
        </div>
      </div>

      <div>
        <h3 className="mb-1 font-medium text-gray-900 text-sm dark:text-dark-headings">By source</h3>
        <p className="mb-1.5 text-gray-500 text-xs dark:text-dark-text">
          A guard-suppressed or suspended-policy row never fired — only the applied rows below are real evidence for promotion.
        </p>
        {/* by_source exists precisely so "the policy applied" and "a guard suppressed it" can't collapse into
            one number — without it a promotion decision would be made on activity the policy never had. */}
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(report.by_source).map(([source, count]) => (
            <span className={clsx("rounded px-1.5 py-0.5 text-xs", source_category_style[classifySource(source)])} key={source}>
              {sourceLabel(source)}: {count.toLocaleString()}
            </span>
          ))}
        </div>
      </div>

      <div className="rounded border border-danger/40 bg-danger/5 p-3">
        <h3 className="mb-1 font-medium text-danger text-sm">Would be deleted — sample</h3>
        {report.destructive_count === 0 ? (
          <p className="text-gray-600 text-sm dark:text-dark-text">No destructive decisions in this run.</p>
        ) : (
          <ul>
            {report.destructive_sample.map((message) => (
              <SampleRow key={message.message_id} message={message} />
            ))}
          </ul>
        )}
      </div>

      <div>
        <h3 className="mb-1 font-medium text-gray-900 text-sm dark:text-dark-headings">Recent decisions — every kind</h3>
        {report.sample.length === 0 ? (
          <p className="text-gray-600 text-sm dark:text-dark-text">No decisions recorded.</p>
        ) : (
          <ul>
            {report.sample.map((message) => (
              <SampleRow key={message.message_id} message={message} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

const RunShadowPassPanel: FC<{ mailboxes: MailboxRow[]; onRan: () => Promise<void> }> = ({ mailboxes, onRan }) => {
  const [mailbox_id_draft, setMailboxIdDraft] = useState("");
  const [batch_size_draft, setBatchSizeDraft] = useState("500");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const runPass = async () => {
    if (mailbox_id_draft === "") {
      return;
    }
    const parsed_batch_size = Number(batch_size_draft);
    const batch_size = Number.isFinite(parsed_batch_size) && parsed_batch_size > 0 ? Math.floor(parsed_batch_size) : 500;
    setBusy(true);
    setStatus("Running — this walks every message in the mailbox in batches and can take several minutes…");
    try {
      const result = await orpc.mail.runShadowPass({ mailbox_id: mailbox_id_draft, batch_size });
      setStatus(`Examined ${result.examined.toLocaleString()} messages, journaled ${result.journaled.toLocaleString()} decisions.`);
      await onRan();
    } catch (error) {
      setStatus(`Run failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="Run a shadow pass">
      <p className="mb-3 text-gray-600 text-sm dark:text-dark-text">
        Pick a mailbox and run a shadow pass over it — there is no run-everything button, on purpose. This walks every message in that
        mailbox in batches of {batch_size_draft || "500"} and journals a decision row for each one; a full mailbox is on the order of tens
        of thousands of rows and the run can take several minutes. It still never opens the mailbox or moves anything.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-gray-600 text-xs dark:text-dark-text">
          Mailbox
          <select
            className={clsx(field, focus_ring)}
            disabled={busy}
            onChange={(event) => setMailboxIdDraft(event.target.value)}
            value={mailbox_id_draft}
          >
            <option value="">Choose a mailbox…</option>
            {mailboxes.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
                {entry.enabled ? "" : " (disabled)"}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-gray-600 text-xs dark:text-dark-text">
          Batch size
          <input
            className={clsx(field, focus_ring, "w-24")}
            disabled={busy}
            max={1000}
            min={1}
            onChange={(event) => setBatchSizeDraft(event.target.value)}
            type="number"
            value={batch_size_draft}
          />
        </label>

        <ActionButton
          busy={busy}
          disabled={busy || mailbox_id_draft === ""}
          label="Run shadow pass"
          onClick={() => void runPass()}
          variant={accent_button_focus}
        />
      </div>
      {status !== null && <p className="mt-3 rounded border border-info/40 bg-info/10 p-2 text-sm">{status}</p>}
    </Panel>
  );
};

const ApprovableRowItem: FC<{ busy_key: string | null; gate_met: boolean; onApprove: () => void; row: ApprovableRow }> = ({
  busy_key,
  gate_met,
  onApprove,
  row,
}) => (
  <li className="flex flex-wrap items-start justify-between gap-2 border-gray-100 border-b py-2 last:border-0 dark:border-dark-border">
    <div className="flex min-w-64 flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className={clsx("rounded px-1.5 py-0.5 text-xs", kind_category_style[classifyKind(row.kind)])}>
          {kind_label[row.kind] ?? row.kind}
        </span>
        <span className={clsx("rounded px-1.5 py-0.5 text-xs", source_category_style[classifySource(row.source)])}>
          {sourceLabel(row.source)}
        </span>
        <span className="text-gray-400 text-xs dark:text-dark-border">{row.occurred_at.slice(0, 10)}</span>
      </div>
      <span className="max-w-xl truncate text-gray-700 text-sm dark:text-dark-text">{row.subject ?? "(no subject)"}</span>
      <span className="max-w-xl truncate text-gray-500 text-xs dark:text-dark-text">{row.from_address ?? "(unknown sender)"}</span>
      {row.kind === "file" && <span className="max-w-xl text-info text-xs">{FILE_DEFERRAL_EXPLANATION}</span>}
    </div>
    {row.mailbox_id === null ? (
      <span className="max-w-72 text-gray-500 text-xs dark:text-dark-text">{NULL_MAILBOX_EXPLANATION}</span>
    ) : (
      <ActionButton
        busy={busy_key === `action:${row.action_id}`}
        disabled={busy_key !== null || !gate_met}
        label="Approve this one"
        onClick={onApprove}
        variant={secondary_button_focus}
      />
    )}
  </li>
);

// Approval lives under the evidence, not beside the policy list: the operator decides with the sample and
// the counts still on screen. Both scopes here are named — this one decision, or this one policy in this
// one mailbox — and there is deliberately no control that reaches a second policy.
const ApprovePolicyPanel: FC<{
  approvable: ApprovableRow[] | null;
  mailboxes: MailboxRow[];
  onApproved: () => Promise<void>;
  onSelectMailbox: (mailbox_id: string | null) => void;
  policy: PolicyRow;
  report: ShadowReport;
  selected_mailbox_id: string | undefined;
}> = ({ approvable, mailboxes, onApproved, onSelectMailbox, policy, report, selected_mailbox_id }) => {
  const category = classifyKind(policy.action);
  const ceremony = approval_ceremony[category];
  const [batch_size_draft, setBatchSizeDraft] = useState(ceremony.default_batch_size);
  const [acknowledged, setAcknowledged] = useState(false);
  const [phrase_draft, setPhraseDraft] = useState("");
  const [busy_key, setBusyKey] = useState<string | null>(null);
  const [banner, setBanner] = useState<ApprovalBanner | null>(null);

  const acknowledgement_met = ceremony.acknowledgement === null || acknowledged;
  const phrase_met = !ceremony.requires_phrase || phrase_draft.trim().toUpperCase() === DESTRUCTIVE_CONFIRMATION_PHRASE;
  // One decision at a time is its own deliberation, so only the destructive tier carries the checkbox into
  // it; the typed phrase guards the bulk scope alone, where one click can reach the whole batch.
  const single_gate_met = category !== "destructive" || acknowledged;
  const batch_gate_met = selected_mailbox_id !== undefined && acknowledgement_met && phrase_met;

  const resetGates = () => {
    setAcknowledged(false);
    setPhraseDraft("");
  };

  const approvePolicy = async () => {
    if (selected_mailbox_id === undefined) {
      return;
    }
    const parsed_batch_size = Number(batch_size_draft);
    const batch_size = Number.isFinite(parsed_batch_size) && parsed_batch_size > 0 ? Math.min(200, Math.floor(parsed_batch_size)) : 50;
    setBusyKey("policy");
    setBanner(null);
    try {
      const result = await orpc.mail.approveDecision({
        scope: "policy",
        mailbox_id: selected_mailbox_id,
        sender_policy_id: policy.id,
        batch_size,
      });
      // approveDecision returns a union over both scopes and only the action arm carries outcome/detail —
      // narrowing on `scope` first is what keeps this branch reading the counters that exist.
      if (result.scope === "policy") {
        setBanner(
          result.promoted === 0
            ? {
                text: `Nothing was promoted: no shadow decision for this policy is recorded against that mailbox. ${NULL_MAILBOX_EXPLANATION}`,
                tone: "info",
              }
            : {
                text: `Approved ${result.promoted.toLocaleString()} of the ${result.examined.toLocaleString()} shadow decisions read. They are pending now — no message has moved.`,
                tone: "success",
              },
        );
      }
      resetGates();
      await onApproved();
    } catch (error) {
      setBanner({ text: `Approve failed: ${error instanceof Error ? error.message : String(error)}`, tone: "danger" });
    } finally {
      setBusyKey(null);
    }
  };

  const approveRow = async (row: ApprovableRow) => {
    if (row.mailbox_id === null) {
      return;
    }
    setBusyKey(`action:${row.action_id}`);
    setBanner(null);
    try {
      const result = await orpc.mail.approveDecision({ scope: "action", mailbox_id: row.mailbox_id, action_id: row.action_id });
      // `detail` names the row's actual status, which is the only thing that explains a click that
      // promoted nothing — a row approved in another tab, or already applied, looks identical without it.
      if (result.scope === "action") {
        setBanner(
          result.outcome === "promoted"
            ? { text: "Approved — that decision is pending. It changes the mailbox only when an apply run picks it up.", tone: "success" }
            : { text: `Not approvable (${result.reason}): ${result.detail}`, tone: "info" },
        );
      }
      await onApproved();
    } catch (error) {
      setBanner({ text: `Approve failed: ${error instanceof Error ? error.message : String(error)}`, tone: "danger" });
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <Panel title={`Approve — ${policy_action_label[policy.action] ?? policy.action} for ${policy.value}`}>
      <div className={clsx("mb-3 rounded border p-3", ceremony.container)}>
        <p className="font-medium text-gray-900 text-sm dark:text-dark-headings">{ceremony.headline}</p>
        <p className="mt-1 text-gray-600 text-sm dark:text-dark-text">{APPROVAL_MEANING}</p>
        {category === "destructive" && (
          <p className="mt-1 text-danger text-sm">
            This run recorded {report.destructive_count.toLocaleString()} decisions that would delete, out of{" "}
            {report.examined.toLocaleString()} examined for this policy.
          </p>
        )}
        {policy.action === "file" && <p className="mt-1 text-info text-sm">{FILE_DEFERRAL_EXPLANATION}</p>}
      </div>

      <p className="mb-3 text-gray-600 text-sm dark:text-dark-text">
        Approval is scoped to what you name here — one decision from the list below, or this one policy in one mailbox, up to the batch
        size. There is no approve-everything control. Bulk approval promotes every shadow decision this policy recorded in that mailbox
        whatever its kind, including rows a guard suppressed to keep-inbox, which change nothing when applied.
      </p>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-gray-600 text-xs dark:text-dark-text">
          Mailbox
          <select
            className={clsx(field, focus_ring)}
            disabled={busy_key !== null}
            onChange={(event) => onSelectMailbox(event.target.value === "" ? null : event.target.value)}
            value={selected_mailbox_id ?? ""}
          >
            <option value="">Choose a mailbox…</option>
            {mailboxes.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
                {entry.enabled ? "" : " (disabled)"}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-gray-600 text-xs dark:text-dark-text">
          Batch size
          <input
            className={clsx(field, focus_ring, "w-24")}
            disabled={busy_key !== null}
            max={200}
            min={1}
            onChange={(event) => setBatchSizeDraft(event.target.value)}
            type="number"
            value={batch_size_draft}
          />
        </label>

        {ceremony.requires_phrase && (
          <label className="flex flex-col gap-1 text-gray-600 text-xs dark:text-dark-text">
            Type {DESTRUCTIVE_CONFIRMATION_PHRASE} to enable bulk approval
            <input
              className={clsx(field, focus_ring, "w-48")}
              disabled={busy_key !== null}
              onChange={(event) => setPhraseDraft(event.target.value)}
              type="text"
              value={phrase_draft}
            />
          </label>
        )}

        <ActionButton
          busy={busy_key === "policy"}
          disabled={busy_key !== null || !batch_gate_met}
          label="Approve every decision for this policy in this mailbox"
          onClick={() => void approvePolicy()}
          variant={accent_button_focus}
        />
      </div>

      {ceremony.acknowledgement !== null && (
        <label className="mt-3 flex items-start gap-2 text-gray-600 text-sm dark:text-dark-text">
          <input
            checked={acknowledged}
            className={clsx(focus_ring, "mt-1 rounded border-gray-300 dark:border-dark-border")}
            disabled={busy_key !== null}
            onChange={(event) => setAcknowledged(event.target.checked)}
            type="checkbox"
          />
          {ceremony.acknowledgement}
        </label>
      )}

      {banner !== null && <Banner banner={banner} />}

      <div className="mt-4">
        <h3 className="mb-1 font-medium text-gray-900 text-sm dark:text-dark-headings">Approve one decision at a time</h3>
        {selected_mailbox_id === undefined && (
          <p className="text-gray-600 text-sm dark:text-dark-text">Choose a mailbox to list this policy's shadow decisions in it.</p>
        )}
        {selected_mailbox_id !== undefined && (approvable === null || approvable.length === 0) && (
          <p className="text-gray-600 text-sm dark:text-dark-text">
            No shadow decisions for this policy in that mailbox. Rows already pending, applied, deferred or undone are not promotable and
            are not listed here — the Action Journal shows them with their status.
          </p>
        )}
        {approvable !== null && approvable.length > 0 && (
          <>
            {category === "destructive" && !acknowledged && (
              <p className="mb-1 text-danger text-sm">
                Tick the acknowledgement above to enable these buttons — each one queues a deletion.
              </p>
            )}
            <p className="mb-1 text-gray-500 text-xs dark:text-dark-text">
              The {APPROVAL_LIST_LIMIT} most recent shadow decisions for this policy in this mailbox. Bulk approval above is not limited to
              them — it works from the oldest decision forward, up to its own batch size.
            </p>
            <ul>
              {approvable.map((row) => (
                <ApprovableRowItem
                  busy_key={busy_key}
                  gate_met={single_gate_met}
                  key={row.action_id}
                  onApprove={() => void approveRow(row)}
                  row={row}
                />
              ))}
            </ul>
          </>
        )}
      </div>
    </Panel>
  );
};

function AdminShadowPage() {
  const { mailboxes, policies, summary, policy_report, approvable } = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const router = useRouter();

  const selected_policy: PolicyRow | null = policies.find((policy) => policy.id === search.policy_id) ?? null;

  const selectPolicy = (policy_id: string | null) => {
    void navigate({ search: (prev: ShadowSearch) => ({ ...prev, policy_id: policy_id ?? undefined }) });
  };

  // Which mailbox the approval is scoped to is a filter over what the loader lists, so it belongs in the
  // URL alongside the policy — a reloaded page then still shows the decisions the operator was reviewing.
  const selectMailbox = (mailbox_id: string | null) => {
    void navigate({ search: (prev: ShadowSearch) => ({ ...prev, mailbox_id: mailbox_id ?? undefined }) });
  };

  return (
    <div className="mx-auto flex max-w-8xl flex-col gap-6 p-6">
      <h1 className="font-bold text-gray-900 text-xl dark:text-dark-headings">Shadow Report</h1>

      <p className="rounded border border-info/40 bg-info/10 p-3 text-info text-sm">{NO_MAILBOX_TOUCHED_STATEMENT}</p>

      <RunShadowPassPanel mailboxes={mailboxes} onRan={() => router.invalidate()} />

      <Panel title="Latest run — every policy">
        <ShadowBreakdown
          empty_message="No shadow pass has run yet. Run one above to see what your policies would have done — that's expected on a fresh setup, not an error."
          report={summary}
        />
      </Panel>

      <Panel title={`Policies (${policies.length})`}>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-gray-200 border-b text-gray-500 dark:border-dark-border dark:text-dark-text">
                <th className="py-2 pr-3">Target</th>
                <th className="py-2 pr-3">Action</th>
                <th className="py-2 pr-3">Autonomy</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3">Shadow record</th>
              </tr>
            </thead>
            <tbody>
              {policies.map((policy) => (
                <tr
                  className={clsx("border-gray-100 border-b dark:border-dark-border", policy.id === search.policy_id && "bg-info/5")}
                  key={policy.id}
                >
                  <td className="max-w-64 truncate py-2 pr-3">
                    <span className="block truncate font-medium text-gray-900 dark:text-dark-headings">{policy.value}</span>
                    <span className="text-gray-500 text-xs dark:text-dark-text">{policy.scope}</span>
                  </td>
                  <td className="py-2 pr-3 text-gray-700 dark:text-dark-text">{policy_action_label[policy.action] ?? policy.action}</td>
                  <td className="py-2 pr-3 text-gray-600 dark:text-dark-text">{policy.autonomy}</td>
                  <td className="py-2 pr-3">
                    {policy.suspended_at !== null ? (
                      <span className="text-warning text-xs">suspended</span>
                    ) : (
                      <span className="text-gray-500 text-xs dark:text-dark-text">active</span>
                    )}
                  </td>
                  <td className="py-2 pr-3">
                    <button
                      className={secondary_button_focus}
                      onClick={() => selectPolicy(policy.id === search.policy_id ? null : policy.id)}
                      type="button"
                    >
                      {policy.id === search.policy_id ? "Hide shadow record" : "View shadow record"}
                    </button>
                  </td>
                </tr>
              ))}
              {policies.length === 0 && (
                <tr>
                  <td className="py-4 text-center text-gray-500 dark:text-dark-text" colSpan={5}>
                    No policies yet — assign one from the Senders page first.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      {search.policy_id !== undefined && (
        <Panel
          title={
            selected_policy === null
              ? "Shadow record"
              : `Shadow record — ${policy_action_label[selected_policy.action] ?? selected_policy.action} for ${selected_policy.value}`
          }
        >
          {policy_report === null ? (
            <p className="text-gray-600 text-sm dark:text-dark-text">This policy no longer exists.</p>
          ) : (
            <ShadowBreakdown
              empty_message="No shadow pass has run yet, so there's nothing to review for this policy."
              report={policy_report}
            />
          )}
        </Panel>
      )}

      {selected_policy !== null && policy_report !== null && (
        // Keyed by policy so switching to another one remounts the panel: an acknowledgement ticked for an
        // archive policy must not still be ticked when an auto-trash policy takes its place.
        <ApprovePolicyPanel
          approvable={approvable === null ? null : approvable.rows}
          key={selected_policy.id}
          mailboxes={mailboxes}
          onApproved={() => router.invalidate()}
          onSelectMailbox={selectMailbox}
          policy={selected_policy}
          report={policy_report}
          selected_mailbox_id={search.mailbox_id}
        />
      )}
    </div>
  );
}
