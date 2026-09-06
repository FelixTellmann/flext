import { createFileRoute, useRouter } from "@tanstack/react-router";
import clsx from "clsx";
import { type FC, useState } from "react";
import { z } from "zod";
import { orpc } from "~/integrations/orpc";
import { filingReasonLabel, filingReasonOperatorAction } from "./-filing-reasons";
import type { OutcomeBanner } from "./-outcome-banner";
import { Banner, toFailureBanner } from "./-outcome-banner";
import { ActionButton, accent_button, field, Panel, secondary_button } from "./-ui";

const filing_search_schema = z.object({
  mailbox_id: z.string().optional(),
  limit: z.number().int().positive().max(200).default(50),
  offset: z.number().int().min(0).default(0),
});

type FilingSearch = z.infer<typeof filing_search_schema>;
type FilingQueueResult = Awaited<ReturnType<typeof orpc.mail.listFilingQueue>>;
type FilingQueueRow = FilingQueueResult["rows"][number];
type MessageLocation = FilingQueueRow["location"];

export const Route = createFileRoute("/admin/filing")({
  validateSearch: filing_search_schema,
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const [mailboxes, queue] = await Promise.all([
      orpc.mail.listMailboxes(),
      orpc.mail.listFilingQueue({ mailbox_id: deps.mailbox_id ?? null, limit: deps.limit, offset: deps.offset }),
    ]);
    return { mailboxes, queue };
  },
  component: AdminFilingPage,
});

const focus_ring = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info";
const accent_button_focus = clsx(accent_button, focus_ring);
const secondary_button_focus = clsx(secondary_button, focus_ring);
const neutral_chip = "rounded bg-gray-100 px-1.5 py-0.5 text-gray-700 text-xs dark:bg-dark-bg dark:text-dark-text";

// This queue only ever holds rows written after mailbox_id was added to Action, so the null case should
// not occur in practice — kept anyway because resolveFiling compares the row's OWN mailbox column, and a
// row without one cannot be named to that procedure at all, the same reasoning journal.tsx's identical
// note carries for approve and undo.
const NULL_MAILBOX_EXPLANATION =
  "This row has no recorded mailbox, so it cannot be matched to one for resolution. It is here to read, not to act on.";

const LocationLink: FC<{ location: MessageLocation }> = ({ location }) => {
  if (location.kind === "gmail") {
    return (
      <a className={clsx("rounded text-info underline", focus_ring)} href={location.url} rel="noopener noreferrer" target="_blank">
        Open in Gmail
      </a>
    );
  }
  return <span className="block max-w-40 truncate text-gray-600 text-xs dark:text-dark-text">{location.folder}</span>;
};

const ReasonNote: FC<{ row: FilingQueueRow }> = ({ row }) => {
  const label = row.reason === null ? "Unrecognised reason" : filingReasonLabel(row.reason);
  const operator_action =
    row.reason === null ? "This row's reason could not be parsed — resolve manually." : filingReasonOperatorAction(row.reason);

  return (
    <div className="flex max-w-64 flex-col gap-1">
      <span className={clsx("block w-fit", neutral_chip)}>{label}</span>
      <span className="text-gray-500 text-xs dark:text-dark-text">{operator_action}</span>
      {row.detail !== "" && <span className="break-words text-gray-400 text-xs dark:text-dark-border">{row.detail}</span>}
    </div>
  );
};

// A row whose target_path is null needs the operator to type one; a row that already carries a proposal
// needs only confirmation. Both call the same procedure — the input box only appears when there is
// nothing to confirm yet.
const ResolveControl: FC<{
  busy: boolean;
  draft: string;
  onChangeDraft: (value: string) => void;
  onResolve: () => void;
  row: FilingQueueRow;
}> = ({ busy, draft, onChangeDraft, onResolve, row }) => {
  if (row.mailbox_id === null) {
    return <span className="block max-w-48 text-gray-500 text-xs dark:text-dark-text">{NULL_MAILBOX_EXPLANATION}</span>;
  }

  const has_proposal = row.target_path !== null;

  return (
    <div className="flex flex-col gap-1">
      {!has_proposal && (
        <input
          className={clsx(field, focus_ring, "w-56")}
          disabled={busy}
          onChange={(event) => onChangeDraft(event.target.value)}
          placeholder="Invoices"
          type="text"
          value={draft}
        />
      )}
      <ActionButton
        busy={busy}
        disabled={busy || draft.trim() === ""}
        label={has_proposal ? "File here" : "Resolve"}
        onClick={onResolve}
        variant={accent_button_focus}
      />
    </div>
  );
};

const FilingQueueTableRow: FC<{
  busy_key: string | null;
  draft: string;
  onChangeDraft: (value: string) => void;
  onResolve: () => void;
  row: FilingQueueRow;
}> = ({ busy_key, draft, onChangeDraft, onResolve, row }) => (
  <tr className="border-gray-100 border-b align-top dark:border-dark-border">
    <td className="max-w-56 py-2 pr-3">
      <span className="block truncate font-medium text-gray-900 text-sm dark:text-dark-headings">{row.subject ?? "(no subject)"}</span>
      <span className="block truncate text-gray-600 text-xs dark:text-dark-text">{row.from_address ?? "(unknown sender)"}</span>
      <span className="block truncate text-gray-500 text-xs dark:text-dark-text">{row.mailbox_label}</span>
    </td>
    <td className="max-w-56 py-2 pr-3">
      {row.target_path === null ? (
        <span className="text-gray-400 text-xs dark:text-dark-border">No proposal — type a folder name</span>
      ) : (
        <span className={clsx("block max-w-56 truncate", neutral_chip)}>{row.target_path}</span>
      )}
    </td>
    <td className="py-2 pr-3">
      <ReasonNote row={row} />
    </td>
    <td className="py-2 pr-3">
      <LocationLink location={row.location} />
    </td>
    <td className="py-2 pr-3">
      <ResolveControl
        busy={busy_key === `resolve:${row.action_id}`}
        draft={draft}
        onChangeDraft={onChangeDraft}
        onResolve={onResolve}
        row={row}
      />
    </td>
  </tr>
);

function AdminFilingPage() {
  const { mailboxes, queue } = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const router = useRouter();
  const [busy_key, setBusyKey] = useState<string | null>(null);
  const [action_status, setActionStatus] = useState<OutcomeBanner | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  // reset_offset is for filter changes, which must land back on page one; the pagination buttons pass
  // false and their own offset, so that key has to survive the spread.
  const patchSearch = (patch: Partial<FilingSearch>, reset_offset = true) => {
    void navigate({ search: (prev) => ({ ...prev, ...patch, offset: reset_offset ? 0 : (patch.offset ?? prev.offset) }) });
  };

  const draftFor = (row: FilingQueueRow) => drafts[row.action_id] ?? row.target_path ?? "";

  const resolveRow = async (row: FilingQueueRow) => {
    if (row.mailbox_id === null) {
      return;
    }
    const target_path = draftFor(row).trim();
    if (target_path === "") {
      return;
    }
    setBusyKey(`resolve:${row.action_id}`);
    setActionStatus(null);
    try {
      await orpc.mail.resolveFiling({ mailbox_id: row.mailbox_id, action_id: row.action_id, target_path });
      setActionStatus({ text: "Resolved — the row is pending again and will file on the next apply run.", tone: "success" });
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[row.action_id];
        return next;
      });
      await router.invalidate();
    } catch (error) {
      setActionStatus(toFailureBanner("Resolve failed", error));
    } finally {
      setBusyKey(null);
    }
  };

  const page_start = search.offset + 1;
  const page_end = Math.min(search.offset + search.limit, queue.total);

  return (
    <div className="mx-auto flex max-w-8xl flex-col gap-6 p-6">
      <h1 className="font-bold text-gray-900 text-xl dark:text-dark-headings">Filing Queue</h1>

      <p className="text-gray-600 text-sm dark:text-dark-text">
        Every `file` action the filing gate could not resolve on its own, parked rather than executed — nothing here was ever sent to a
        mailbox. Confirm a proposed destination, or type one where there isn't a proposal, to send the row back to the executor unchanged.
      </p>

      <Panel title="Filters">
        <label className="flex flex-col gap-1 text-gray-600 text-xs dark:text-dark-text">
          Mailbox
          <select
            className={clsx(field, focus_ring)}
            onChange={(event) => patchSearch({ mailbox_id: event.target.value === "" ? undefined : event.target.value })}
            value={search.mailbox_id ?? ""}
          >
            <option value="">All mailboxes</option>
            {mailboxes.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>
      </Panel>

      <Panel title={`Queue (${queue.total.toLocaleString()})`}>
        {action_status !== null && <Banner banner={action_status} className="mb-3" />}

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-gray-200 border-b text-gray-500 dark:border-dark-border dark:text-dark-text">
                <th className="py-2 pr-3">Message</th>
                <th className="py-2 pr-3">Proposed path</th>
                <th className="py-2 pr-3">Reason</th>
                <th className="py-2 pr-3">Open</th>
                <th className="py-2 pr-3">Resolve</th>
              </tr>
            </thead>
            <tbody>
              {queue.rows.map((row) => (
                <FilingQueueTableRow
                  busy_key={busy_key}
                  draft={draftFor(row)}
                  key={row.action_id}
                  onChangeDraft={(value) => setDrafts((prev) => ({ ...prev, [row.action_id]: value }))}
                  onResolve={() => void resolveRow(row)}
                  row={row}
                />
              ))}
              {queue.rows.length === 0 && (
                <tr>
                  <td className="py-4 text-center text-gray-500 dark:text-dark-text" colSpan={5}>
                    Nothing is waiting on a filing decision.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-3 flex items-center justify-between text-gray-600 text-sm dark:text-dark-text">
          <p>
            {queue.total === 0
              ? "0 of 0"
              : `${page_start.toLocaleString()}–${page_end.toLocaleString()} of ${queue.total.toLocaleString()}`}
          </p>
          <div className="flex gap-2">
            <button
              className={secondary_button_focus}
              disabled={search.offset === 0}
              onClick={() => patchSearch({ offset: Math.max(0, search.offset - search.limit) }, false)}
              type="button"
            >
              Previous
            </button>
            <button
              className={secondary_button_focus}
              disabled={page_end >= queue.total}
              onClick={() => patchSearch({ offset: search.offset + search.limit }, false)}
              type="button"
            >
              Next
            </button>
          </div>
        </div>
      </Panel>
    </div>
  );
}
