import { createFileRoute, useRouter } from "@tanstack/react-router";
import clsx from "clsx";
import { type FC, useState } from "react";
import { z } from "zod";
import { orpc } from "~/integrations/orpc";
import { ActionButton, accent_button, field, Panel, secondary_button } from "./-ui";

const shadow_search_schema = z.object({
  policy_id: z.string().optional(),
});

type ShadowSearch = z.infer<typeof shadow_search_schema>;
type ShadowReport = Awaited<ReturnType<typeof orpc.mail.getShadowSummary>>;
type ShadowSampleMessage = ShadowReport["sample"][number];
type MessageLocation = ShadowSampleMessage["location"];
type PolicyRow = Awaited<ReturnType<typeof orpc.mail.listPolicies>>[number];
type MailboxRow = Awaited<ReturnType<typeof orpc.mail.listMailboxes>>[number];

export const Route = createFileRoute("/admin/shadow")({
  validateSearch: shadow_search_schema,
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const [mailboxes, policies, summary, policy_report] = await Promise.all([
      orpc.mail.listMailboxes(),
      orpc.mail.listPolicies({ scope: "all", suspended: "all", search: null }),
      orpc.mail.getShadowSummary(),
      deps.policy_id === undefined ? Promise.resolve(null) : orpc.mail.getShadowReport({ policy_id: deps.policy_id }),
    ]);
    return { mailboxes, policies, summary, policy_report };
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

type KindCategory = "destructive" | "organisational" | "retained";

// Mirrors DESTRUCTIVE_KINDS / ORGANISATIONAL_KINDS in server/mail/query/shadow.ts — kept as plain string
// arrays here since this file can't import that server module's values into the client bundle.
const DESTRUCTIVE_KINDS = ["auto_trash", "purge"];
const ORGANISATIONAL_KINDS = ["archive", "file"];

function classifyKind(kind: string): KindCategory {
  if (DESTRUCTIVE_KINDS.includes(kind)) {
    return "destructive";
  }
  if (ORGANISATIONAL_KINDS.includes(kind)) {
    return "organisational";
  }
  return "retained";
}

const kind_category_style: Record<KindCategory, string> = {
  destructive: "bg-danger/10 text-danger",
  organisational: "bg-info/10 text-info",
  retained: "bg-gray-100 text-gray-700 dark:bg-dark-bg dark:text-dark-text",
};

type SourceCategory = "applied" | "suppressed" | "neutral";

const APPLIED_SOURCES = ["address_policy", "domain_policy"];
const SUPPRESSED_SOURCES = ["guard", "suspended_policy", "thread_state"];

function classifySource(source: string): SourceCategory {
  if (APPLIED_SOURCES.includes(source)) {
    return "applied";
  }
  if (SUPPRESSED_SOURCES.includes(source)) {
    return "suppressed";
  }
  return "neutral";
}

const source_category_style: Record<SourceCategory, string> = {
  applied: "bg-success/10 text-success",
  suppressed: "bg-warning/10 text-warning",
  neutral: "bg-gray-100 text-gray-700 dark:bg-dark-bg dark:text-dark-text",
};

const NO_MAILBOX_TOUCHED_STATEMENT =
  "Nothing on this page has touched a mailbox. A shadow pass only reads message metadata already synced to this database and writes a decision row — it never opens a mailbox, moves a message, or deletes anything.";

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
        {source_label[message.source] ?? message.source}
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
              {source_label[source] ?? source}: {count.toLocaleString()}
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

function AdminShadowPage() {
  const { mailboxes, policies, summary, policy_report } = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const router = useRouter();

  const selected_policy: PolicyRow | null = policies.find((policy) => policy.id === search.policy_id) ?? null;

  const selectPolicy = (policy_id: string | null) => {
    void navigate({ search: (prev: ShadowSearch) => ({ ...prev, policy_id: policy_id ?? undefined }) });
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
    </div>
  );
}
