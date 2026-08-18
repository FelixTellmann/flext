import { createFileRoute } from "@tanstack/react-router";
import clsx from "clsx";
import { type FC, useState } from "react";
import { z } from "zod";
import { orpc } from "~/integrations/orpc";
import { field, Panel, secondary_button } from "./-ui";

const senders_search_schema = z.object({
  search: z.string().optional(),
  replied: z.enum(["all", "never", "replied"]).default("all"),
  bulk: z.enum(["all", "bulk", "direct"]).default("all"),
  mailbox_id: z.string().optional(),
  min_messages: z.number().int().min(0).max(10_000).default(0),
  sort: z.enum(["messages", "replies", "last_seen", "address"]).default("messages"),
  direction: z.enum(["asc", "desc"]).default("desc"),
  limit: z.number().int().positive().max(200).default(50),
  offset: z.number().int().min(0).default(0),
});

type SendersSearch = z.infer<typeof senders_search_schema>;
type SenderRow = Awaited<ReturnType<typeof orpc.mail.listSenders>>["rows"][number];
type SenderProfile = Awaited<ReturnType<typeof orpc.mail.getSenderProfile>>;

function toListSendersInput(search: SendersSearch) {
  return {
    search: search.search ?? null,
    replied: search.replied,
    bulk: search.bulk,
    mailbox_id: search.mailbox_id ?? null,
    min_messages: search.min_messages,
    sort: search.sort,
    direction: search.direction,
    limit: search.limit,
    offset: search.offset,
  };
}

export const Route = createFileRoute("/admin/senders")({
  validateSearch: senders_search_schema,
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const [summary, senders] = await Promise.all([orpc.mail.getDashboardSummary(), orpc.mail.listSenders(toListSendersInput(deps))]);
    return { summary, senders };
  },
  component: AdminSendersPage,
});

const volume_bucket_label: Record<SenderRow["volume_bucket"], string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  flood: "Flood",
};

const volume_bucket_style: Record<SenderRow["volume_bucket"], string> = {
  low: "bg-gray-100 text-gray-700 dark:bg-dark-bg dark:text-dark-text",
  medium: "bg-info/10 text-info",
  high: "bg-warning/10 text-warning",
  flood: "bg-danger/10 text-danger",
};

const sort_options: { value: SendersSearch["sort"]; label: string }[] = [
  { value: "messages", label: "Total messages" },
  { value: "replies", label: "Replies" },
  { value: "last_seen", label: "Last seen" },
  { value: "address", label: "Address" },
];

const MailboxHealth: FC<{ mailboxes: Awaited<ReturnType<typeof orpc.mail.getDashboardSummary>>["mailboxes"] }> = ({ mailboxes }) => (
  <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
    {mailboxes.map((entry) => {
      const flagged = !entry.enabled || entry.last_error !== null;
      return (
        <li
          className={clsx(
            "rounded border p-2 text-sm",
            flagged ? "border-danger/50 bg-danger/10" : "border-gray-200 dark:border-dark-border",
          )}
          key={entry.id}
        >
          <p className="truncate font-medium text-gray-900 dark:text-dark-headings">{entry.label}</p>
          <p className="text-gray-600 dark:text-dark-text">
            {entry.messages.toLocaleString()} msgs · {entry.unread.toLocaleString()} unread
          </p>
          {!entry.enabled && <p className="text-danger">disabled</p>}
          {entry.last_error !== null && (
            <p className="truncate text-danger" title={entry.last_error}>
              {entry.last_error}
            </p>
          )}
        </li>
      );
    })}
  </ul>
);

const SenderProfilePanel: FC<{ address: string; profile: SenderProfile | null; status: "loading" | "loaded" | "error" }> = ({
  address,
  profile,
  status,
}) => (
  <Panel title={`Profile — ${address}`}>
    {status === "loading" && <p className="text-gray-600 text-sm dark:text-dark-text">Loading…</p>}
    {status === "error" && <p className="text-danger text-sm">Could not load this sender's profile.</p>}
    {status === "loaded" && profile !== null && (
      <div className="flex flex-col gap-3">
        <dl className="grid grid-cols-2 gap-1 text-gray-600 text-sm dark:text-dark-text">
          <dt>Display name</dt>
          <dd className="truncate">{profile.display_name ?? "—"}</dd>
          <dt>Domain</dt>
          <dd className="truncate">{profile.domain}</dd>
          <dt>First seen</dt>
          <dd>{profile.first_seen_at ?? "—"}</dd>
          <dt>Last seen</dt>
          <dd>{profile.last_seen_at ?? "—"}</dd>
          <dt>Total / replies</dt>
          <dd>
            {profile.message_count.toLocaleString()} / {profile.my_reply_count.toLocaleString()}
          </dd>
        </dl>

        <div>
          <h3 className="mb-1 font-medium text-gray-900 text-sm dark:text-dark-headings">Per mailbox</h3>
          <ul className="flex flex-col gap-0.5 text-gray-600 text-sm dark:text-dark-text">
            {profile.per_mailbox.map((entry) => (
              <li key={entry.label}>
                {entry.label}: {entry.count.toLocaleString()}
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h3 className="mb-1 font-medium text-gray-900 text-sm dark:text-dark-headings">Recent subjects</h3>
          <ul className="flex flex-col gap-1 text-gray-600 text-sm dark:text-dark-text">
            {profile.recent_subjects.map((entry) => (
              <li className="truncate" key={`${entry.internal_date}-${entry.folder}-${entry.subject ?? ""}`}>
                <span className="text-gray-400 dark:text-dark-border">{entry.internal_date.slice(0, 10)}</span>{" "}
                <span className="truncate">{entry.subject ?? "(no subject)"}</span>
                <span className="text-gray-400 dark:text-dark-border"> · {entry.folder}</span>
              </li>
            ))}
            {profile.recent_subjects.length === 0 && <li>No messages found.</li>}
          </ul>
        </div>
      </div>
    )}
  </Panel>
);

function AdminSendersPage() {
  const { summary, senders } = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const [search_draft, setSearchDraft] = useState(search.search ?? "");
  const [min_messages_draft, setMinMessagesDraft] = useState(String(search.min_messages));
  const [selected_address, setSelectedAddress] = useState<string | null>(null);
  const [profile, setProfile] = useState<SenderProfile | null>(null);
  const [profile_status, setProfileStatus] = useState<"loading" | "loaded" | "error">("loading");

  const patchSearch = (patch: Partial<SendersSearch>, reset_offset = true) => {
    void navigate({
      search: (prev) => ({ ...prev, ...patch, offset: reset_offset ? 0 : prev.offset }),
    });
  };

  const openProfile = (address: string) => {
    setSelectedAddress(address);
    setProfile(null);
    setProfileStatus("loading");
    orpc.mail
      .getSenderProfile({ address })
      .then((result) => {
        setProfile(result);
        setProfileStatus("loaded");
      })
      .catch(() => setProfileStatus("error"));
  };

  const page_start = search.offset + 1;
  const page_end = Math.min(search.offset + search.limit, senders.total);

  return (
    <div className="mx-auto flex max-w-8xl flex-col gap-6 p-6">
      <h1 className="font-bold text-gray-900 text-xl dark:text-dark-headings">Senders</h1>

      <Panel title="Overview">
        <dl className="mb-4 grid grid-cols-3 gap-2 text-sm">
          <div>
            <dt className="text-gray-500 dark:text-dark-text">Total messages</dt>
            <dd className="font-semibold text-gray-900 text-lg dark:text-dark-headings">{summary.total_messages.toLocaleString()}</dd>
          </div>
          <div>
            <dt className="text-gray-500 dark:text-dark-text">Total senders</dt>
            <dd className="font-semibold text-gray-900 text-lg dark:text-dark-headings">{summary.total_senders.toLocaleString()}</dd>
          </div>
          <div>
            <dt className="text-gray-500 dark:text-dark-text">Never replied to</dt>
            <dd className="font-semibold text-danger text-lg">{summary.senders_never_replied.toLocaleString()}</dd>
          </div>
        </dl>
        <MailboxHealth mailboxes={summary.mailboxes} />
      </Panel>

      <Panel title="Filters">
        <div className="flex flex-wrap items-end gap-3">
          <form
            className="flex items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              patchSearch({ search: search_draft.trim().length > 0 ? search_draft.trim() : undefined });
            }}
          >
            <label className="flex flex-col gap-1 text-gray-600 text-xs dark:text-dark-text">
              Search
              <input
                className={field}
                onChange={(event) => setSearchDraft(event.target.value)}
                placeholder="address, domain, name"
                value={search_draft}
              />
            </label>
            <button className={secondary_button} type="submit">
              Apply
            </button>
          </form>

          <label className="flex flex-col gap-1 text-gray-600 text-xs dark:text-dark-text">
            Replied
            <select
              className={field}
              onChange={(event) => patchSearch({ replied: event.target.value as SendersSearch["replied"] })}
              value={search.replied}
            >
              <option value="all">All</option>
              <option value="never">Never replied</option>
              <option value="replied">Replied</option>
            </select>
          </label>

          <label className="flex flex-col gap-1 text-gray-600 text-xs dark:text-dark-text">
            Bulk / automated
            <select
              className={field}
              onChange={(event) => patchSearch({ bulk: event.target.value as SendersSearch["bulk"] })}
              value={search.bulk}
            >
              <option value="all">All</option>
              <option value="bulk">Bulk only</option>
              <option value="direct">Direct only</option>
            </select>
          </label>

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

          <form
            className="flex items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const parsed = Number(min_messages_draft);
              patchSearch({ min_messages: Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0 });
            }}
          >
            <label className="flex flex-col gap-1 text-gray-600 text-xs dark:text-dark-text">
              Min. messages
              <input
                className={clsx(field, "w-24")}
                min={0}
                onChange={(event) => setMinMessagesDraft(event.target.value)}
                type="number"
                value={min_messages_draft}
              />
            </label>
            <button className={secondary_button} type="submit">
              Apply
            </button>
          </form>

          <label className="flex flex-col gap-1 text-gray-600 text-xs dark:text-dark-text">
            Sort by
            <select
              className={field}
              onChange={(event) => patchSearch({ sort: event.target.value as SendersSearch["sort"] })}
              value={search.sort}
            >
              {sort_options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <button
            className={secondary_button}
            onClick={() => patchSearch({ direction: search.direction === "desc" ? "asc" : "desc" })}
            type="button"
          >
            {search.direction === "desc" ? "Descending" : "Ascending"}
          </button>
        </div>
      </Panel>

      <Panel title={`Senders (${senders.total.toLocaleString()})`}>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-gray-200 border-b text-gray-500 dark:border-dark-border dark:text-dark-text">
                <th className="py-2 pr-3">Sender</th>
                <th className="py-2 pr-3">Mailboxes</th>
                <th className="py-2 pr-3 text-right">Total</th>
                <th className="py-2 pr-3 text-right">Replies</th>
                <th className="py-2 pr-3 text-right">In inbox</th>
                <th className="py-2 pr-3 text-right">Unread</th>
                <th className="py-2 pr-3">Flags</th>
                <th className="py-2 pr-3">Volume</th>
                <th className="py-2 pr-3">Last seen</th>
              </tr>
            </thead>
            <tbody>
              {senders.rows.map((row) => (
                <tr
                  className="cursor-pointer border-gray-100 border-b hover:bg-gray-50 dark:border-dark-border dark:hover:bg-dark-bg"
                  key={row.address}
                  onClick={() => openProfile(row.address)}
                >
                  <td className="max-w-64 truncate py-2 pr-3">
                    <p className="truncate font-medium text-gray-900 dark:text-dark-headings">{row.display_name ?? row.address}</p>
                    {row.display_name !== null && <p className="truncate text-gray-500 text-xs dark:text-dark-text">{row.address}</p>}
                  </td>
                  <td className="max-w-40 truncate py-2 pr-3 text-gray-600 dark:text-dark-text">{row.mailbox_labels.join(", ")}</td>
                  <td className="py-2 pr-3 text-right">{row.message_count.toLocaleString()}</td>
                  <td className="py-2 pr-3 text-right">{row.my_reply_count.toLocaleString()}</td>
                  <td className="py-2 pr-3 text-right">{row.in_inbox_count.toLocaleString()}</td>
                  <td className="py-2 pr-3 text-right">{row.unread_count.toLocaleString()}</td>
                  <td className="py-2 pr-3">
                    <div className="flex gap-1">
                      {row.bulk_count > 0 && <span className="rounded bg-info/10 px-1.5 py-0.5 text-info text-xs">bulk</span>}
                      {row.automated_count > 0 && (
                        <span className="rounded bg-gray-100 px-1.5 py-0.5 text-gray-600 text-xs dark:bg-dark-bg dark:text-dark-text">
                          automated
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="py-2 pr-3">
                    <span className={clsx("rounded px-1.5 py-0.5 text-xs", volume_bucket_style[row.volume_bucket])}>
                      {volume_bucket_label[row.volume_bucket]}
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-gray-600 dark:text-dark-text">{row.last_seen_at?.slice(0, 10) ?? "—"}</td>
                </tr>
              ))}
              {senders.rows.length === 0 && (
                <tr>
                  <td className="py-4 text-center text-gray-500 dark:text-dark-text" colSpan={9}>
                    No senders match these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-3 flex items-center justify-between text-gray-600 text-sm dark:text-dark-text">
          <p>
            {senders.total === 0
              ? "0 of 0"
              : `${page_start.toLocaleString()}–${page_end.toLocaleString()} of ${senders.total.toLocaleString()}`}
          </p>
          <div className="flex gap-2">
            <button
              className={secondary_button}
              disabled={search.offset === 0}
              onClick={() => patchSearch({ offset: Math.max(0, search.offset - search.limit) }, false)}
              type="button"
            >
              Previous
            </button>
            <button
              className={secondary_button}
              disabled={page_end >= senders.total}
              onClick={() => patchSearch({ offset: search.offset + search.limit }, false)}
              type="button"
            >
              Next
            </button>
          </div>
        </div>
      </Panel>

      {selected_address !== null && <SenderProfilePanel address={selected_address} profile={profile} status={profile_status} />}
    </div>
  );
}
