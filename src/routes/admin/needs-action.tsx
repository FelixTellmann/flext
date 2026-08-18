import { createFileRoute } from "@tanstack/react-router";
import clsx from "clsx";
import { type FC, useState } from "react";
import { z } from "zod";
import { orpc } from "~/integrations/orpc";
import { accent_button, field, Panel, secondary_button } from "./-ui";

const age_window_schema = z.union([z.literal(7), z.literal(30), z.literal(90), z.literal(365), z.literal("all")]);

const needs_action_search_schema = z.object({
  mailbox_id: z.string().optional(),
  age_window: age_window_schema.default(30),
  limit: z.number().int().positive().max(200).default(50),
  offset: z.number().int().min(0).default(0),
});

type NeedsActionSearch = z.infer<typeof needs_action_search_schema>;
type NeedsActionRow = Awaited<ReturnType<typeof orpc.mail.listNeedsAction>>["rows"][number];
type MessageLocation = NeedsActionRow["location"];

function toMaxAgeDays(age_window: NeedsActionSearch["age_window"]): number | null {
  return age_window === "all" ? null : age_window;
}

function toListNeedsActionInput(search: NeedsActionSearch) {
  return {
    mailbox_id: search.mailbox_id ?? null,
    max_age_days: toMaxAgeDays(search.age_window),
    limit: search.limit,
    offset: search.offset,
  };
}

export const Route = createFileRoute("/admin/needs-action")({
  validateSearch: needs_action_search_schema,
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const [summary, queue, unfiltered] = await Promise.all([
      orpc.mail.getDashboardSummary(),
      orpc.mail.listNeedsAction(toListNeedsActionInput(deps)),
      orpc.mail.listNeedsAction({ mailbox_id: deps.mailbox_id ?? null, max_age_days: null, limit: 1, offset: 0 }),
    ]);
    return { summary, queue, unfiltered_total: unfiltered.total };
  },
  component: AdminNeedsActionPage,
});

const age_window_options: { value: NeedsActionSearch["age_window"]; label: string }[] = [
  { value: 7, label: "7 days" },
  { value: 30, label: "30 days" },
  { value: 90, label: "90 days" },
  { value: 365, label: "365 days" },
  { value: "all", label: "All time" },
];

const reason_badge = "rounded bg-gray-100 px-1.5 py-0.5 text-gray-600 text-xs dark:bg-dark-bg dark:text-dark-text";
const focus_ring = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info";

const MessageIdCopy: FC<{ message_id: string | null }> = ({ message_id }) => {
  const [copied, setCopied] = useState(false);

  if (message_id === null) {
    return <span className="text-gray-400 text-xs dark:text-dark-border">no Message-ID</span>;
  }

  return (
    <button
      className={clsx(
        "rounded border border-gray-300 px-1.5 py-0.5 text-gray-600 text-xs dark:border-dark-border dark:text-dark-text",
        focus_ring,
      )}
      onClick={() => {
        void navigator.clipboard.writeText(message_id).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      type="button"
    >
      {copied ? "Copied" : "Copy Message-ID"}
    </button>
  );
};

const LocationCell: FC<{ location: MessageLocation }> = ({ location }) => {
  if (location.kind === "gmail") {
    return (
      <a className={clsx("rounded text-info underline", focus_ring)} href={location.url} rel="noopener noreferrer" target="_blank">
        Open in Gmail
      </a>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <span className="max-w-40 truncate text-gray-600 text-xs dark:text-dark-text">{location.folder}</span>
      <MessageIdCopy message_id={location.message_id} />
    </div>
  );
};

function AdminNeedsActionPage() {
  const { summary, queue, unfiltered_total } = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();

  // reset_offset is for filter changes, which must land back on page one. The pagination buttons pass
  // false AND their own offset, so that key has to survive the spread rather than be pinned to prev.
  const patchSearch = (patch: Partial<NeedsActionSearch>, reset_offset = true) => {
    void navigate({ search: (prev) => ({ ...prev, ...patch, offset: reset_offset ? 0 : (patch.offset ?? prev.offset) }) });
  };

  const page_start = search.offset + 1;
  const page_end = Math.min(search.offset + search.limit, queue.total);
  const withheld = Math.max(0, unfiltered_total - queue.total);

  return (
    <div className="mx-auto flex max-w-8xl flex-col gap-6 p-6">
      <h1 className="font-bold text-gray-900 text-xl dark:text-dark-headings">Needs Action</h1>

      <p className="text-gray-600 text-sm dark:text-dark-text">
        Threads addressed to you that aren't bulk or automated, oldest first, across every synced mailbox. Whether you already replied isn't
        known yet — that needs the thread-state table from Phase 3, which also brings snooze, mark done and "shouldn't be here". This view
        is read-only until then.
      </p>

      <Panel title="Window">
        <div className="flex flex-wrap items-center gap-2">
          {age_window_options.map((option) => (
            <button
              className={clsx(option.value === search.age_window ? accent_button : secondary_button, focus_ring)}
              key={String(option.value)}
              onClick={() => patchSearch({ age_window: option.value })}
              type="button"
            >
              {option.label}
            </button>
          ))}
        </div>
        <p className="mt-3 text-gray-600 text-sm dark:text-dark-text">
          {queue.total.toLocaleString()} thread{queue.total === 1 ? "" : "s"} in this window
          {search.age_window !== "all" && (
            <>
              {" "}
              of {unfiltered_total.toLocaleString()} total ({withheld.toLocaleString()} withheld by the age window —{" "}
              <button className={clsx("underline", focus_ring)} onClick={() => patchSearch({ age_window: "all" })} type="button">
                show all
              </button>
              )
            </>
          )}
        </p>
      </Panel>

      <Panel title="Filters">
        <label className="flex flex-col gap-1 text-gray-600 text-xs dark:text-dark-text">
          Mailbox
          <select
            className={field}
            onChange={(event) => patchSearch({ mailbox_id: event.target.value === "" ? undefined : event.target.value })}
            value={search.mailbox_id ?? ""}
          >
            <option value="">All mailboxes</option>
            {summary.mailboxes.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>
      </Panel>

      <Panel title={`Queue (${queue.total.toLocaleString()})`}>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-gray-200 border-b text-gray-500 dark:border-dark-border dark:text-dark-text">
                <th className="py-2 pr-3">Sender</th>
                <th className="py-2 pr-3">Subject</th>
                <th className="py-2 pr-3">Mailbox</th>
                <th className="py-2 pr-3 text-right">Age</th>
                <th className="py-2 pr-3">Why it's here</th>
                <th className="py-2 pr-3">Open</th>
              </tr>
            </thead>
            <tbody>
              {queue.rows.map((row) => (
                <tr
                  className="border-gray-100 border-b dark:border-dark-border"
                  key={row.thread_key ?? `${row.mailbox_id}-${row.internal_date}`}
                >
                  <td className="max-w-56 truncate py-2 pr-3">
                    <p className="truncate font-medium text-gray-900 dark:text-dark-headings">
                      {row.from_name ?? row.from_address ?? "Unknown sender"}
                    </p>
                    {row.from_name !== null && row.from_address !== null && (
                      <p className="truncate text-gray-500 text-xs dark:text-dark-text">{row.from_address}</p>
                    )}
                  </td>
                  <td className="max-w-96 truncate py-2 pr-3 text-gray-700 dark:text-dark-text">{row.subject ?? "(no subject)"}</td>
                  <td className="max-w-32 truncate py-2 pr-3 text-gray-600 dark:text-dark-text">{row.mailbox_label}</td>
                  <td className="py-2 pr-3 text-right text-gray-600 dark:text-dark-text">{row.age_days}d</td>
                  <td className="py-2 pr-3">
                    <div className="flex flex-wrap gap-1">
                      {row.reasons.map((reason) => (
                        <span className={reason_badge} key={reason}>
                          {reason}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="py-2 pr-3">
                    <LocationCell location={row.location} />
                  </td>
                </tr>
              ))}
              {queue.rows.length === 0 && (
                <tr>
                  <td className="py-4 text-center text-gray-500 dark:text-dark-text" colSpan={6}>
                    Nothing needs action in this window.
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
              className={clsx(secondary_button, focus_ring)}
              disabled={search.offset === 0}
              onClick={() => patchSearch({ offset: Math.max(0, search.offset - search.limit) }, false)}
              type="button"
            >
              Previous
            </button>
            <button
              className={clsx(secondary_button, focus_ring)}
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
