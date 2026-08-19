import { createFileRoute, useRouter } from "@tanstack/react-router";
import clsx from "clsx";
import { type FC, useRef, useState } from "react";
import { z } from "zod";
import { orpc } from "~/integrations/orpc";
import { ActionButton, accent_button, field, Panel, secondary_button } from "./-ui";

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
type PolicyRow = Awaited<ReturnType<typeof orpc.mail.listPolicies>>[number];
type NeverTouchRow = Awaited<ReturnType<typeof orpc.mail.listNeverTouchRules>>[number];

// Mirrors POLICY_ACTIONS in server/mail/classify/rules.ts (an admin route can't import a server value
// without pulling the classify module into the client bundle). A value here that drifted from that
// allowlist would just be rejected by upsertPolicy's own zod schema, not silently applied.
const policy_action_options = ["keep_inbox", "archive", "file", "auto_trash"] as const;
type PolicyActionValue = (typeof policy_action_options)[number];

const policy_action_label: Record<PolicyActionValue, string> = {
  keep_inbox: "Keep inbox",
  archive: "Archive",
  file: "File",
  auto_trash: "Auto-trash",
};

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
    const [summary, senders, policies, never_touch_rules] = await Promise.all([
      orpc.mail.getDashboardSummary(),
      orpc.mail.listSenders(toListSendersInput(deps)),
      orpc.mail.listPolicies({ scope: "all", suspended: "all", search: null }),
      orpc.mail.listNeverTouchRules(),
    ]);
    return { summary, senders, policies, never_touch_rules };
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

const focus_ring = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info";
const checkbox_input = clsx("h-4 w-4 rounded border-gray-300 text-accent dark:border-dark-border dark:bg-dark-bg", focus_ring);
const accent_button_focus = clsx(accent_button, focus_ring);
const secondary_button_focus = clsx(secondary_button, focus_ring);

type PolicyIndex = { by_address: Map<string, PolicyRow>; by_domain: Map<string, PolicyRow> };

function buildPolicyIndex(policies: PolicyRow[]): PolicyIndex {
  const by_address = new Map<string, PolicyRow>();
  const by_domain = new Map<string, PolicyRow>();
  for (const policy of policies) {
    const target = policy.scope === "address" ? by_address : by_domain;
    target.set(policy.value.toLowerCase(), policy);
  }
  return { by_address, by_domain };
}

// §5.2: address-level policy outranks domain-level, so a sender covered by both only ever shows the one
// that would actually fire.
function resolvePolicy(index: PolicyIndex, row: SenderRow): PolicyRow | null {
  return index.by_address.get(row.address.toLowerCase()) ?? index.by_domain.get(row.domain.toLowerCase()) ?? null;
}

function matchesNeverTouch(rules: NeverTouchRow[], row: SenderRow): boolean {
  const address = row.address.toLowerCase();
  const domain = row.domain.toLowerCase();
  return rules.some((rule) => {
    if (rule.kind === "address") {
      return rule.value.toLowerCase() === address;
    }
    if (rule.kind === "domain") {
      const rule_domain = rule.value.toLowerCase();
      return domain === rule_domain || domain.endsWith(`.${rule_domain}`);
    }
    return false;
  });
}

// Every other guard in classify/guards.ts reads per-message signals (flags, thread history, arrival
// time) this list never has. These two are the only ones whose definition IS sender-level rather than
// message-level — never_touch is a static address/domain match, and derived_allowlist is exactly
// `my_reply_count > 0` (deriveSignals' sender_known, verbatim) — so they're the only ones shown here.
// Approximating the rest from aggregates risks the exact failure §5.3 warns against, just inverted: an
// active policy rendered as falsely suppressed.
function resolveSuppression(row: SenderRow, policy: PolicyRow | null, never_touch_rules: NeverTouchRow[]): string | null {
  if (policy === null || policy.suspended_at !== null) {
    return null;
  }
  if (matchesNeverTouch(never_touch_rules, row)) {
    return "never_touch";
  }
  if (policy.action === "auto_trash" && row.my_reply_count > 0) {
    return "derived_allowlist";
  }
  return null;
}

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

const PolicyCell: FC<{ policy: PolicyRow | null; suppressed_by: string | null }> = ({ policy, suppressed_by }) => {
  if (policy === null) {
    return <span className="text-gray-400 dark:text-dark-border">No policy</span>;
  }
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-gray-900 dark:text-dark-headings">
        {policy_action_label[policy.action]}
        <span className="ml-1 text-gray-500 text-xs dark:text-dark-text">({policy.scope === "address" ? "address" : "domain"})</span>
      </span>
      {policy.suspended_at !== null && <span className="text-warning text-xs">suspended</span>}
      {suppressed_by !== null && <span className="text-danger text-xs">suppressed by guard: {suppressed_by}</span>}
    </div>
  );
};

const AssignmentCell: FC<{
  address: string;
  address_policy: PolicyRow | null;
  busy_key: string | null;
  draft_action: PolicyActionValue;
  onAssign: () => void;
  onDraftChange: (action: PolicyActionValue) => void;
  onRemove: () => void;
}> = ({ address, address_policy, busy_key, draft_action, onAssign, onDraftChange, onRemove }) => {
  const any_busy = busy_key !== null;
  return (
    <div className="flex items-center gap-1">
      <label className="flex flex-col gap-0.5">
        <span className="sr-only">Policy action for {address}</span>
        <select
          className={clsx(field, focus_ring, "text-xs")}
          disabled={any_busy}
          onChange={(event) => onDraftChange(event.target.value as PolicyActionValue)}
          value={draft_action}
        >
          {policy_action_options.map((option) => (
            <option key={option} value={option}>
              {policy_action_label[option]}
            </option>
          ))}
        </select>
      </label>
      <ActionButton
        busy={busy_key === `assign:${address}`}
        disabled={any_busy}
        label="Assign"
        onClick={onAssign}
        variant={accent_button_focus}
      />
      {address_policy !== null && (
        <ActionButton
          busy={busy_key === `remove:${address}`}
          disabled={any_busy}
          label="Remove"
          onClick={onRemove}
          variant={secondary_button_focus}
        />
      )}
    </div>
  );
};

function AdminSendersPage() {
  const { summary, senders, policies, never_touch_rules } = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const router = useRouter();
  const [search_draft, setSearchDraft] = useState(search.search ?? "");
  const [min_messages_draft, setMinMessagesDraft] = useState(String(search.min_messages));
  const [selected_address, setSelectedAddress] = useState<string | null>(null);
  const [profile, setProfile] = useState<SenderProfile | null>(null);
  const [profile_status, setProfileStatus] = useState<"loading" | "loaded" | "error">("loading");
  const requested_address_ref = useRef<string | null>(null);

  const [selected_addresses, setSelectedAddresses] = useState<Set<string>>(new Set());
  const [assign_drafts, setAssignDrafts] = useState<Record<string, PolicyActionValue>>({});
  const [bulk_action_draft, setBulkActionDraft] = useState<PolicyActionValue>("archive");
  const [busy_key, setBusyKey] = useState<string | null>(null);
  const [policy_status, setPolicyStatus] = useState<string | null>(null);

  const policy_index = buildPolicyIndex(policies);

  // reset_offset is for filter/sort changes, which must land back on page one. The pagination buttons
  // pass false AND their own offset, so that key has to survive the spread rather than be pinned to prev.
  const patchSearch = (patch: Partial<SendersSearch>, reset_offset = true) => {
    void navigate({
      search: (prev) => ({ ...prev, ...patch, offset: reset_offset ? 0 : (patch.offset ?? prev.offset) }),
    });
  };

  const openProfile = (address: string) => {
    requested_address_ref.current = address;
    setSelectedAddress(address);
    setProfile(null);
    setProfileStatus("loading");
    orpc.mail
      .getSenderProfile({ address })
      .then((result) => {
        // A faster second click can resolve after an earlier one; only the most recently
        // requested address may still update the panel.
        if (requested_address_ref.current !== address) {
          return;
        }
        setProfile(result);
        setProfileStatus("loaded");
      })
      .catch(() => {
        if (requested_address_ref.current !== address) {
          return;
        }
        setProfileStatus("error");
      });
  };

  const toggleAddress = (address: string) => {
    setSelectedAddresses((prev) => {
      const next = new Set(prev);
      if (next.has(address)) {
        next.delete(address);
      } else {
        next.add(address);
      }
      return next;
    });
  };

  const all_on_page_selected = senders.rows.length > 0 && senders.rows.every((row) => selected_addresses.has(row.address));

  const toggleAllOnPage = () => {
    setSelectedAddresses((prev) => {
      const next = new Set(prev);
      for (const row of senders.rows) {
        if (all_on_page_selected) {
          next.delete(row.address);
        } else {
          next.add(row.address);
        }
      }
      return next;
    });
  };

  const assignPolicy = async (address: string, action: PolicyActionValue) => {
    const key = `assign:${address}`;
    setBusyKey(key);
    setPolicyStatus(null);
    try {
      await orpc.mail.upsertPolicy({ scope: "address", value: address, action, source: "operator" });
      await router.invalidate();
    } catch (error) {
      setPolicyStatus(`Assign failed for ${address}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusyKey(null);
    }
  };

  const removePolicy = async (address: string, policy_id: string) => {
    const key = `remove:${address}`;
    setBusyKey(key);
    setPolicyStatus(null);
    try {
      await orpc.mail.deletePolicy({ id: policy_id });
      await router.invalidate();
    } catch (error) {
      setPolicyStatus(`Remove failed for ${address}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusyKey(null);
    }
  };

  const applyBulkAssignment = async (action: PolicyActionValue) => {
    const addresses = [...selected_addresses];
    if (addresses.length === 0) {
      return;
    }
    setBusyKey("bulk");
    setPolicyStatus(`Assigning ${policy_action_label[action]} to ${addresses.length} sender${addresses.length === 1 ? "" : "s"}…`);
    try {
      const results = await Promise.allSettled(
        addresses.map((address) => orpc.mail.upsertPolicy({ scope: "address", value: address, action, source: "operator" })),
      );
      const failed = results.filter((result) => result.status === "rejected").length;
      setPolicyStatus(
        failed === 0
          ? `Assigned ${policy_action_label[action]} to ${addresses.length} sender${addresses.length === 1 ? "" : "s"}.`
          : `Assigned to ${addresses.length - failed} of ${addresses.length} senders — ${failed} failed.`,
      );
      setSelectedAddresses(new Set());
      await router.invalidate();
    } finally {
      setBusyKey(null);
    }
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
        {policy_status !== null && <p className="mb-3 rounded border border-info/40 bg-info/10 p-2 text-sm">{policy_status}</p>}

        <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
          {selected_addresses.size > 0 ? (
            <>
              <span className="text-gray-600 dark:text-dark-text">
                {selected_addresses.size} sender{selected_addresses.size === 1 ? "" : "s"} selected
              </span>
              <label className="flex flex-col gap-0.5">
                <span className="sr-only">Bulk policy action</span>
                <select
                  className={clsx(field, focus_ring)}
                  disabled={busy_key !== null}
                  onChange={(event) => setBulkActionDraft(event.target.value as PolicyActionValue)}
                  value={bulk_action_draft}
                >
                  {policy_action_options.map((option) => (
                    <option key={option} value={option}>
                      {policy_action_label[option]}
                    </option>
                  ))}
                </select>
              </label>
              <ActionButton
                busy={busy_key === "bulk"}
                disabled={busy_key !== null}
                label={`Apply to ${selected_addresses.size}`}
                onClick={() => void applyBulkAssignment(bulk_action_draft)}
                variant={accent_button_focus}
              />
              <button
                className={secondary_button_focus}
                disabled={busy_key !== null}
                onClick={() => setSelectedAddresses(new Set())}
                type="button"
              >
                Clear selection
              </button>
            </>
          ) : (
            <span className="text-gray-500 text-xs dark:text-dark-text">Select rows below to bulk-assign a policy.</span>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-gray-200 border-b text-gray-500 dark:border-dark-border dark:text-dark-text">
                <th className="py-2 pr-3">
                  <label className="flex items-center">
                    <span className="sr-only">Select all senders on this page</span>
                    <input checked={all_on_page_selected} className={checkbox_input} onChange={toggleAllOnPage} type="checkbox" />
                  </label>
                </th>
                <th className="py-2 pr-3">Sender</th>
                <th className="py-2 pr-3">Mailboxes</th>
                <th className="py-2 pr-3 text-right">Total</th>
                <th className="py-2 pr-3 text-right">Replies</th>
                <th className="py-2 pr-3 text-right">In inbox</th>
                <th className="py-2 pr-3 text-right">Unread</th>
                <th className="py-2 pr-3">Flags</th>
                <th className="py-2 pr-3">Volume</th>
                <th className="py-2 pr-3">Last seen</th>
                <th className="py-2 pr-3">Policy</th>
                <th className="py-2 pr-3">Autonomy</th>
                <th className="py-2 pr-3">Assign</th>
              </tr>
            </thead>
            <tbody>
              {senders.rows.map((row) => {
                const resolved_policy = resolvePolicy(policy_index, row);
                const address_policy = policy_index.by_address.get(row.address.toLowerCase()) ?? null;
                const suppressed_by = resolveSuppression(row, resolved_policy, never_touch_rules);
                const draft_action = assign_drafts[row.address] ?? "archive";

                return (
                  <tr
                    className="cursor-pointer border-gray-100 border-b hover:bg-gray-50 dark:border-dark-border dark:hover:bg-dark-bg"
                    key={row.address}
                    onClick={() => openProfile(row.address)}
                  >
                    <td className="py-2 pr-3" onClick={(event) => event.stopPropagation()}>
                      <label className="flex items-center">
                        <span className="sr-only">Select {row.address}</span>
                        <input
                          checked={selected_addresses.has(row.address)}
                          className={checkbox_input}
                          onChange={() => toggleAddress(row.address)}
                          type="checkbox"
                        />
                      </label>
                    </td>
                    <td className="max-w-64 truncate py-2 pr-3">
                      <button
                        className="block w-full truncate rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info focus-visible:ring-inset"
                        onClick={(event) => {
                          event.stopPropagation();
                          openProfile(row.address);
                        }}
                        type="button"
                      >
                        <span className="block truncate font-medium text-gray-900 dark:text-dark-headings">
                          {row.display_name ?? row.address}
                        </span>
                        {row.display_name !== null && (
                          <span className="block truncate text-gray-500 text-xs dark:text-dark-text">{row.address}</span>
                        )}
                      </button>
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
                    <td className="py-2 pr-3">
                      <PolicyCell policy={resolved_policy} suppressed_by={suppressed_by} />
                    </td>
                    <td className="py-2 pr-3 text-gray-600 dark:text-dark-text">{resolved_policy?.autonomy ?? "—"}</td>
                    <td className="py-2 pr-3" onClick={(event) => event.stopPropagation()}>
                      <AssignmentCell
                        address={row.address}
                        address_policy={address_policy}
                        busy_key={busy_key}
                        draft_action={draft_action}
                        onAssign={() => void assignPolicy(row.address, draft_action)}
                        onDraftChange={(action) => setAssignDrafts((prev) => ({ ...prev, [row.address]: action }))}
                        onRemove={() => {
                          if (address_policy !== null) {
                            void removePolicy(row.address, address_policy.id);
                          }
                        }}
                      />
                    </td>
                  </tr>
                );
              })}
              {senders.rows.length === 0 && (
                <tr>
                  <td className="py-4 text-center text-gray-500 dark:text-dark-text" colSpan={13}>
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
