import clsx from "clsx";
import { type FC, useState } from "react";
import { orpc } from "~/integrations/orpc";
import type { OutcomeBanner } from "./-outcome-banner";
import { Banner, toFailureBanner } from "./-outcome-banner";
import { ActionButton, accent_button, field, Panel } from "./-ui";

// The apply control, shared by the two screens the operator actually works from. It lives here rather
// than in either route because approval (Task 11) and the journal (Task 10) both stop at "pending", so
// this is the only path from an approved decision to a changed mailbox — and a second copy of it would
// be a second copy of the counter vocabulary below, which is exactly how the status wording has drifted
// before.

type SummaryMailbox = Awaited<ReturnType<typeof orpc.mail.getDashboardSummary>>["mailboxes"][number];
type ApplyPendingResult = Awaited<ReturnType<typeof orpc.mail.applyPending>>;

export type PendingCount = { mailbox_id: string; label: string; enabled: boolean; pending: number };

const focus_ring = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info";
const accent_button_focus = clsx(accent_button, focus_ring);

// The procedure caps the batch at 200. 25 is small enough that a first real run is readable row by row in
// the journal afterwards, which is the point of bounding it at all.
const DEFAULT_APPLY_BATCH_SIZE = 25;
const MAX_APPLY_BATCH_SIZE = 200;

const APPLY_PREAMBLE =
  "The only control on this screen that opens a mailbox and moves messages. A shadow pass reads, an approval writes one column — this is what finally acts on the rows they produced. It runs one mailbox, oldest decision first, up to the batch size; there is deliberately no apply-everything button, so a stray click cannot reach four mailboxes.";

// listActionJournal filters on the message's mailbox while the executor selects on the action's own
// mailbox and skips messages that have disappeared from the server, so the two sets are not identical and
// the count is an upper bound. Saying which way it can be wrong is cheaper than a number the operator
// cannot reconcile with what the run reports.
const PENDING_COUNT_BASIS =
  "Counted from the Action Journal by the mailbox the message lives in. A run additionally skips rows whose message has since disappeared from the server, so it can examine fewer than the number shown. Rows written before Phase 4 carry no mailbox of their own and can never be approved, so none of them are in these counts.";

const EXAMINED_NOTE =
  "Examined is how many pending rows the run read, not the sum of the three outcomes: a row can be read and still be left as it was.";

// The pending column is written before the mutation is issued and the outcome is written after it, so the
// absence of a result is not the presence of an untouched message.
const STILL_PENDING_NOTE =
  "A row still pending after a run is not proof that nothing happened to it. The outcome is recorded after the mutation, so a write-back that itself failed can leave a message already moved. Read the journal and the mailbox rather than assuming.";

// A count here would be prose the screen cannot keep true: apply runs consume the backlog. The property
// is what the operator needs, and it holds at any count.
const DEFERRED_STANDING_NOTE =
  "Much of the backlog is file decisions, and filing has no executor in this phase. Every one of them reports deferred and sends nothing to the mailbox, so a run whose outcome is mostly deferred is behaving as designed, not failing.";

const CONFIRMATION_LABEL = "I understand this opens the mailbox and moves real messages.";

const outcome_meaning: Record<"applied" | "failed" | "deferred", string> = {
  applied: "The mutation landed and the post-state was recorded. These rows are reversible from the Action Journal.",
  failed:
    "The mutation did not land. Each row keeps the pre-state it recorded and is not retried automatically — the next sync re-reads the mailbox, and the journal carries the error.",
  deferred:
    "A file decision, deliberately not executed: Phase 4 has no executor for filing and nothing was sent to the mailbox. This is a designed outcome, not a failure.",
};

const outcome_tone: Record<"applied" | "failed" | "deferred", string> = {
  applied: "text-success",
  failed: "text-danger",
  deferred: "text-info",
};

const OutcomeLine: FC<{ count: number; kind: "applied" | "failed" | "deferred"; label: string }> = ({ count, kind, label }) => (
  <div>
    <dt className={clsx("font-medium text-sm", outcome_tone[kind])}>
      {label} {count.toLocaleString()}
    </dt>
    <dd className="text-gray-600 text-sm dark:text-dark-text">{outcome_meaning[kind]}</dd>
  </div>
);

const ApplyPendingSummary: FC<{ result: ApplyPendingResult }> = ({ result }) => (
  <div className="mt-3 flex flex-col gap-3">
    <p className="text-gray-700 text-sm dark:text-dark-text">
      {result.label} — {result.examined.toLocaleString()} pending row{result.examined === 1 ? "" : "s"} examined.
    </p>
    <dl className="flex flex-col gap-2">
      <OutcomeLine count={result.applied} kind="applied" label="Applied" />
      <OutcomeLine count={result.failed} kind="failed" label="Failed" />
      <OutcomeLine count={result.deferred} kind="deferred" label="Deferred" />
    </dl>
    <p className="text-gray-500 text-xs dark:text-dark-text">{EXAMINED_NOTE}</p>
    <p className="rounded border border-warning/40 bg-warning/10 p-2 text-sm text-warning">{STILL_PENDING_NOTE}</p>
  </div>
);

const PendingCountList: FC<{ counts: PendingCount[] }> = ({ counts }) => {
  const total = counts.reduce((sum, entry) => sum + entry.pending, 0);

  return (
    <div className="flex flex-col gap-2">
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {counts.map((entry) => (
          <li
            className={clsx(
              "rounded border p-2 text-sm",
              entry.pending > 0 ? "border-warning/50 bg-warning/10" : "border-gray-200 dark:border-dark-border",
            )}
            key={entry.mailbox_id}
          >
            <p className="truncate font-medium text-gray-900 dark:text-dark-headings">{entry.label}</p>
            <p className="text-gray-600 dark:text-dark-text">{entry.pending.toLocaleString()} approved, waiting to run</p>
            {!entry.enabled && <p className="text-danger text-xs">disabled — an apply run is refused</p>}
          </li>
        ))}
        {counts.length === 0 && <li className="text-gray-500 text-sm dark:text-dark-text">No mailboxes are synced yet.</li>}
      </ul>
      <p className="text-gray-700 text-sm dark:text-dark-text">
        {total.toLocaleString()} approved decision{total === 1 ? "" : "s"} waiting across every mailbox.
      </p>
      <p className="text-gray-500 text-xs dark:text-dark-text">{PENDING_COUNT_BASIS}</p>
    </div>
  );
};

export const ApplyPendingPanel: FC<{ counts: PendingCount[]; mailboxes: SummaryMailbox[]; onApplied: () => Promise<void> }> = ({
  counts,
  mailboxes,
  onApplied,
}) => {
  const [mailbox_id_draft, setMailboxIdDraft] = useState("");
  const [batch_size_draft, setBatchSizeDraft] = useState(String(DEFAULT_APPLY_BATCH_SIZE));
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<OutcomeBanner | null>(null);
  const [result, setResult] = useState<ApplyPendingResult | null>(null);

  const runApply = async () => {
    if (mailbox_id_draft === "" || !confirmed) {
      return;
    }
    const parsed_batch_size = Number(batch_size_draft);
    const batch_size =
      Number.isFinite(parsed_batch_size) && parsed_batch_size > 0
        ? Math.min(MAX_APPLY_BATCH_SIZE, Math.floor(parsed_batch_size))
        : DEFAULT_APPLY_BATCH_SIZE;
    setBusy(true);
    setBanner({ text: "Applying — opening the mailbox and issuing one batch of mutations…", tone: "info" });
    setResult(null);
    try {
      const outcome = await orpc.mail.applyPending({ mailbox_id: mailbox_id_draft, batch_size });
      setResult(outcome);
      setBanner(
        outcome.examined === 0 ? { text: `Nothing to do: no approved decision is waiting for ${outcome.label}.`, tone: "info" } : null,
      );
      setConfirmed(false);
      await onApplied();
    } catch (error) {
      // A disabled or unknown mailbox is refused before anything is opened, and the procedure words that
      // refusal itself — amber with the server's own text, not a red generic failure.
      setBanner(toFailureBanner("Apply failed", error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="Apply approved actions">
      <p className="mb-3 text-gray-600 text-sm dark:text-dark-text">{APPLY_PREAMBLE}</p>

      <PendingCountList counts={counts} />

      <p className="mt-3 rounded border border-info/40 bg-info/10 p-2 text-info text-sm">{DEFERRED_STANDING_NOTE}</p>

      <div className="mt-3 flex flex-wrap items-end gap-3">
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
                {entry.enabled ? entry.label : `${entry.label} — disabled`}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-gray-600 text-xs dark:text-dark-text">
          Batch size
          <input
            className={clsx(field, focus_ring, "w-24")}
            disabled={busy}
            max={MAX_APPLY_BATCH_SIZE}
            min={1}
            onChange={(event) => setBatchSizeDraft(event.target.value)}
            type="number"
            value={batch_size_draft}
          />
        </label>

        <ActionButton
          busy={busy}
          disabled={busy || mailbox_id_draft === "" || !confirmed}
          label="Apply this mailbox"
          onClick={() => void runApply()}
          variant={accent_button_focus}
        />
      </div>

      <label className="mt-3 flex items-center gap-2 text-gray-600 text-sm dark:text-dark-text">
        <input
          checked={confirmed}
          className={clsx(focus_ring, "rounded border-gray-300 dark:border-dark-border")}
          disabled={busy}
          onChange={(event) => setConfirmed(event.target.checked)}
          type="checkbox"
        />
        {CONFIRMATION_LABEL}
      </label>

      {banner !== null && <Banner banner={banner} className="mt-3" />}
      {result !== null && <ApplyPendingSummary result={result} />}
    </Panel>
  );
};

// One round trip per mailbox: listActionJournal returns `total` alongside its rows, and asking for a
// single row is the cheapest way to reach that count without a procedure of its own.
export async function loadPendingCounts(mailboxes: SummaryMailbox[]): Promise<PendingCount[]> {
  return Promise.all(
    mailboxes.map(async (entry) => {
      const journal = await orpc.mail.listActionJournal({
        mailbox_id: entry.id,
        sender_policy_id: null,
        sender_address: null,
        status: "pending",
        since: null,
        until: null,
        limit: 1,
        offset: 0,
      });
      return { mailbox_id: entry.id, label: entry.label, enabled: entry.enabled, pending: journal.total };
    }),
  );
}
