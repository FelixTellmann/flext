import { ORPCError } from "@orpc/client";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import clsx from "clsx";
import { type FC, type ReactNode, useState } from "react";
import { z } from "zod";
import { orpc } from "~/integrations/orpc";
import type { ErrorMeaning, KnownStatus, StateSnapshot } from "./-action-journal";
import {
  changedValues,
  error_meaning_detail,
  error_meaning_headline,
  error_meaning_style,
  status_label,
  status_meaning,
  status_style,
} from "./-action-journal";
import { ActionButton, accent_button, field, Panel, secondary_button } from "./-ui";

// Mirrors ACTION_JOURNAL_STATUS_FILTERS in server/mail/query/actions.ts — an admin route can't import a
// server value without pulling the action modules (and the db handle) into the client bundle, the same
// reasoning shadow.tsx and senders.tsx already carry. The server re-validates this enum on every call.
const journal_status_filters = ["all", "shadow", "pending", "applied", "failed", "deferred", "undone"] as const;

const journal_search_schema = z.object({
  mailbox_id: z.string().optional(),
  policy_id: z.string().optional(),
  sender: z.string().optional(),
  status: z.enum(journal_status_filters).default("all"),
  since: z.string().optional(),
  until: z.string().optional(),
  limit: z.number().int().positive().max(200).default(50),
  offset: z.number().int().min(0).default(0),
});

type JournalSearch = z.infer<typeof journal_search_schema>;
type JournalResult = Awaited<ReturnType<typeof orpc.mail.listActionJournal>>;
type JournalRow = JournalResult["rows"][number];
type MessageLocation = JournalRow["location"];
type PolicyRow = Awaited<ReturnType<typeof orpc.mail.listPolicies>>[number];
type MailboxRow = Awaited<ReturnType<typeof orpc.mail.listMailboxes>>[number];
type UndoByPolicyResult = Awaited<ReturnType<typeof orpc.mail.undoByPolicy>>;

// The filter reads as a calendar day, the journal window is a timestamp range, so each bound is widened
// to the local edges of that day — an `until` of today would otherwise exclude everything after midnight.
// An unparseable value becomes null rather than an Invalid Date, which the procedure's z.date() rejects.
function toDayStart(day: string | undefined): Date | null {
  if (day === undefined || day === "") {
    return null;
  }
  const parsed = new Date(`${day}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toDayEnd(day: string | undefined): Date | null {
  if (day === undefined || day === "") {
    return null;
  }
  const parsed = new Date(`${day}T23:59:59.999`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toListActionJournalInput(search: JournalSearch) {
  return {
    mailbox_id: search.mailbox_id ?? null,
    sender_policy_id: search.policy_id ?? null,
    sender_address: search.sender ?? null,
    status: search.status,
    since: toDayStart(search.since),
    until: toDayEnd(search.until),
    limit: search.limit,
    offset: search.offset,
  };
}

export const Route = createFileRoute("/admin/journal")({
  validateSearch: journal_search_schema,
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const [mailboxes, policies, journal] = await Promise.all([
      orpc.mail.listMailboxes(),
      orpc.mail.listPolicies({ scope: "all", suspended: "all", search: null }),
      orpc.mail.listActionJournal(toListActionJournalInput(deps)),
    ]);
    return { mailboxes, policies, journal };
  },
  component: AdminJournalPage,
});

const focus_ring = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info";
const accent_button_focus = clsx(accent_button, focus_ring);
const secondary_button_focus = clsx(secondary_button, focus_ring);
const muted_text = "text-gray-400 text-xs dark:text-dark-border";
const neutral_chip = "rounded bg-gray-100 px-1 py-0.5 text-gray-600 text-xs dark:bg-dark-bg dark:text-dark-text";

// The banner reports the outcome of a mutation, so on a screen whose whole discipline is meaning-keyed
// colour it cannot be one tone for everything: "reversed" and "the reversal did not land" are not the same
// news. `info` is for outcomes where nothing was changed and nothing broke — a refusal, or work in flight.
type BannerTone = "success" | "info" | "warning" | "danger";

const banner_style: Record<BannerTone, string> = {
  success: "border-success/40 bg-success/10 text-success",
  info: "border-info/40 bg-info/10 text-info",
  warning: "border-warning/40 bg-warning/10 text-warning",
  danger: "border-danger/40 bg-danger/10 text-danger",
};

type OutcomeBanner = { text: string; tone: BannerTone };

// A refusal is not a crash. requireEnabledMailbox throws FORBIDDEN for a disabled mailbox and NOT_FOUND
// for an unknown one, each with a worded explanation and nothing sent to the mailbox — amber, and the
// message shown as written. Anything else reached us as a real failure and stays red.
function toFailureBanner(prefix: string, error: unknown): OutcomeBanner {
  if (error instanceof ORPCError && (error.code === "FORBIDDEN" || error.code === "NOT_FOUND")) {
    return { text: error.message, tone: "warning" };
  }
  return { text: `${prefix}: ${error instanceof Error ? error.message : String(error)}`, tone: "danger" };
}

const Banner: FC<{ banner: OutcomeBanner; className: string }> = ({ banner, className }) => (
  <p className={clsx("rounded border p-2 text-sm", banner_style[banner.tone], className)}>{banner.text}</p>
);

// Mirrors action.kind (server/mail/classify/rules.ts's ActionClass plus "needs_action"), display only.
const kind_label: Record<string, string> = {
  keep_inbox: "Keep inbox",
  archive: "Archive",
  file: "File",
  auto_trash: "Auto-trash",
  purge: "Purge",
  needs_action: "Needs action",
};

const source_label: Record<string, string> = {
  address_policy: "Address policy",
  domain_policy: "Domain policy",
  suspended_policy: "Policy suspended",
  guard: "Guard",
  thread_state: "Thread snoozed/done",
  derived: "Derived default",
  fallback: "No rule matched",
};

const NULL_MAILBOX_EXPLANATION =
  "This row was written by a Phase 3 shadow pass, before actions recorded their own mailbox. Undo and approve both match that column against the mailbox they are handed, so neither can target this row — it is here to read, not to act on.";

const SKIPPED_EXPLANATION =
  "Skipped rows were deliberately left untouched: when one reversal in a chain fails, its siblings are held back so a half-reversed chain can't be made worse. A skipped row writes nothing to the journal, so this counter is the only record that they exist.";

function statusLabel(row: JournalRow): string {
  return row.known_status === null ? row.status : status_label[row.known_status];
}

function statusStyle(row: JournalRow): string {
  return row.known_status === null ? "bg-gray-100 text-gray-700 dark:bg-dark-bg dark:text-dark-text" : status_style[row.known_status];
}

function statusMeaning(row: JournalRow): string {
  if (row.known_status === null) {
    return "The journal does not recognise this status, so nothing can be said about what happened to the message.";
  }
  return status_meaning[row.known_status];
}

// Where the message should be right now, given the status — the sentence the operator actually needs
// beside a before/after pair. `pending` deliberately refuses to claim the mutation did not happen: the
// executor journals the pre-state before it mutates, and the status write that follows can itself fail.
function whereaboutsNote(row: JournalRow): string {
  if (row.known_status === "applied") {
    return "Now at the state on the right.";
  }
  if (row.known_status === "undone") {
    return "Reversed — back at the state on the left.";
  }
  if (row.known_status === "failed") {
    return "Should still be at the state on the left.";
  }
  if (row.known_status === "pending") {
    return "Unconfirmed — the mutation may already have landed.";
  }
  if (row.known_status === "shadow" || row.known_status === "deferred") {
    return "Untouched — nothing was sent to the mailbox.";
  }
  return "Whereabouts unknown — the status is unrecognised.";
}

function missingStateNote(row: JournalRow): string {
  if (row.known_status === "shadow") {
    return "not read — a shadow decision never opens the mailbox";
  }
  if (row.known_status === "deferred") {
    return "not read — nothing was executed";
  }
  return "not recorded";
}

const ValueList: FC<{ changed: Set<string>; changed_style: string; missing: string; values: string[] | null }> = ({
  changed,
  changed_style,
  missing,
  values,
}) => {
  if (values === null) {
    return <span className={muted_text}>{missing}</span>;
  }
  if (values.length === 0) {
    return <span className={muted_text}>(none)</span>;
  }
  return (
    <span className="flex flex-wrap gap-1">
      {values.map((value) => (
        <span
          className={clsx("max-w-40 truncate rounded px-1 py-0.5 text-xs", changed.has(value) ? changed_style : neutral_chip)}
          key={value}
        >
          {value}
        </span>
      ))}
    </span>
  );
};

const FacetRow: FC<{ after: ReactNode; before: ReactNode; name: string }> = ({ after, before, name }) => (
  <div className="flex items-start gap-1.5">
    <span className="w-12 shrink-0 text-gray-500 text-xs dark:text-dark-text">{name}</span>
    <span className="min-w-0 flex-1">{before}</span>
    <span aria-hidden="true" className={clsx("shrink-0", muted_text)}>
      →
    </span>
    <span className="min-w-0 flex-1">{after}</span>
  </div>
);

// "Archived" is not enough to decide whether to trust the next batch, so the folder, flags and labels are
// shown on both sides with the values that differ picked out. Every value here is server text (folder
// names, Gmail labels, IMAP flags) and is rendered as React children only — never into a class or a URL.
const StateDiff: FC<{ row: JournalRow }> = ({ row }) => {
  const before: StateSnapshot | null = row.from_state;
  const after: StateSnapshot | null = row.to_state;
  const missing_before = missingStateNote(row);

  if (before === null && after === null) {
    return (
      <div className="flex flex-col gap-1">
        <span className={muted_text}>No mailbox state recorded — {missing_before}.</span>
        <span className="text-gray-500 text-xs dark:text-dark-text">{whereaboutsNote(row)}</span>
      </div>
    );
  }

  // changedValues yields nothing unless BOTH snapshots exist — a pending or failed row has no post-state,
  // and marking its whole pre-state as removed would contradict the note beside it.
  const removed_flags = changedValues(before, after, "flags");
  const added_flags = changedValues(after, before, "flags");
  const removed_labels = changedValues(before, after, "labels");
  const added_labels = changedValues(after, before, "labels");
  const folder_changed = before !== null && after !== null && before.folder !== after.folder;

  return (
    <div className="flex min-w-72 flex-col gap-1">
      <div className="flex items-center gap-1.5 text-gray-500 text-xs dark:text-dark-text">
        <span className="w-12 shrink-0" />
        <span className="min-w-0 flex-1">Before</span>
        <span aria-hidden="true" className="shrink-0 opacity-0">
          →
        </span>
        <span className="min-w-0 flex-1">{after === null ? "(no after state)" : "After"}</span>
      </div>
      <FacetRow
        after={
          after === null ? (
            <span className={muted_text}>not recorded</span>
          ) : (
            <span
              className={clsx(
                "block max-w-40 truncate rounded px-1 py-0.5 text-xs",
                folder_changed ? "bg-success/10 text-success" : neutral_chip,
              )}
            >
              {after.folder}
            </span>
          )
        }
        before={
          before === null ? (
            <span className={muted_text}>{missing_before}</span>
          ) : (
            <span
              className={clsx(
                "block max-w-40 truncate rounded px-1 py-0.5 text-xs",
                folder_changed ? "bg-danger/10 text-danger" : neutral_chip,
              )}
            >
              {before.folder}
            </span>
          )
        }
        name="Folder"
      />
      <FacetRow
        after={
          <ValueList
            changed={added_flags}
            changed_style="bg-success/10 text-success"
            missing="not recorded"
            values={after?.flags ?? null}
          />
        }
        before={
          <ValueList
            changed={removed_flags}
            changed_style="bg-danger/10 text-danger"
            missing={missing_before}
            values={before?.flags ?? null}
          />
        }
        name="Flags"
      />
      <FacetRow
        after={
          <ValueList
            changed={added_labels}
            changed_style="bg-success/10 text-success"
            missing={after === null ? "not recorded" : "no label support"}
            values={after?.labels ?? null}
          />
        }
        before={
          <ValueList
            changed={removed_labels}
            changed_style="bg-danger/10 text-danger"
            missing={before === null ? missing_before : "no label support"}
            values={before?.labels ?? null}
          />
        }
        name="Labels"
      />
      <span className="text-gray-500 text-xs dark:text-dark-text">{whereaboutsNote(row)}</span>
    </div>
  );
};

const ErrorNote: FC<{ note: NonNullable<JournalRow["error"]> }> = ({ note }) => (
  <div className={clsx("mt-1 flex flex-col gap-0.5 rounded border p-1.5", error_meaning_style[note.meaning])}>
    <span className="font-medium text-xs">{error_meaning_headline[note.meaning]}</span>
    <span className="text-xs opacity-90">{error_meaning_detail[note.meaning]}</span>
    <span className="max-w-80 break-words font-mono text-xs opacity-80">{note.text}</span>
  </div>
);

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

// Only an `applied` row is reversible and only a `shadow` row is approvable, so every other status shows
// why there is no button instead of a control that would come back "not undoable". A null mailbox_id
// disables both regardless of status — the calls compare it against the caller's mailbox and can only
// answer other_mailbox.
const RowActions: FC<{ busy_key: string | null; onApprove: () => void; onUndo: () => void; row: JournalRow }> = ({
  busy_key,
  onApprove,
  onUndo,
  row,
}) => {
  const any_busy = busy_key !== null;

  if (row.mailbox_id === null) {
    return <span className="block max-w-48 text-gray-500 text-xs dark:text-dark-text">{NULL_MAILBOX_EXPLANATION}</span>;
  }

  if (row.known_status === "shadow") {
    return (
      <div className="flex flex-col gap-1">
        <ActionButton
          busy={busy_key === `approve:${row.action_id}`}
          disabled={any_busy}
          label="Approve"
          onClick={onApprove}
          variant={secondary_button_focus}
        />
        <span className="max-w-48 text-gray-500 text-xs dark:text-dark-text">
          Moves the row to pending. It changes the mailbox only when an apply run picks it up.
        </span>
      </div>
    );
  }

  if (row.known_status === "applied") {
    return (
      <ActionButton
        busy={busy_key === `undo:${row.action_id}`}
        disabled={any_busy}
        label="Undo"
        onClick={onUndo}
        variant={secondary_button_focus}
      />
    );
  }

  if (row.known_status === "pending") {
    return (
      <span className="block max-w-48 text-gray-500 text-xs dark:text-dark-text">
        Waiting on an apply run. Undo needs a confirmed outcome, and this row does not have one yet.
      </span>
    );
  }

  if (row.known_status === "undone") {
    return (
      <span className="block max-w-48 text-gray-500 text-xs dark:text-dark-text">Already reversed. Kept on the record on purpose.</span>
    );
  }

  // An unrecognised status must not be folded in with failed and deferred: those two are known to have
  // left the mailbox alone, and this one is not known to have done anything at all. Claiming "no mutation
  // landed" here would contradict the status cell, which says exactly that nothing can be said.
  if (row.known_status === null) {
    return (
      <span className="block max-w-48 text-gray-500 text-xs dark:text-dark-text">
        Unrecognised status — whether anything landed is unknown, so no reversal is offered from here.
      </span>
    );
  }

  return (
    <span className="block max-w-48 text-gray-500 text-xs dark:text-dark-text">Nothing to reverse — no mutation landed for this row.</span>
  );
};

const JournalTableRow: FC<{
  busy_key: string | null;
  onApprove: (row: JournalRow) => void;
  onUndo: (row: JournalRow) => void;
  row: JournalRow;
}> = ({ busy_key, onApprove, onUndo, row }) => (
  <tr className="border-gray-100 border-b align-top dark:border-dark-border">
    <td className="py-2 pr-3">
      <span className="block text-gray-700 text-xs dark:text-dark-text">{row.occurred_at.slice(0, 10)}</span>
      <span className={clsx("block", muted_text)}>{row.occurred_at.slice(11, 16)}</span>
    </td>
    <td className="max-w-56 py-2 pr-3">
      <span className="block truncate font-medium text-gray-900 text-sm dark:text-dark-headings">{row.subject ?? "(no subject)"}</span>
      <span className="block truncate text-gray-600 text-xs dark:text-dark-text">{row.from_address ?? "(unknown sender)"}</span>
      <span className="block truncate text-gray-500 text-xs dark:text-dark-text">{row.mailbox_label}</span>
    </td>
    <td className="py-2 pr-3">
      <span className={clsx("block w-fit rounded px-1.5 py-0.5 text-xs", neutral_chip)}>{kind_label[row.kind] ?? row.kind}</span>
      <span className={clsx("mt-1 block", muted_text)}>{source_label[row.source] ?? row.source}</span>
    </td>
    <td className="py-2 pr-3">
      <span className={clsx("block w-fit rounded px-1.5 py-0.5 text-xs", statusStyle(row))}>{statusLabel(row)}</span>
      <span className="mt-1 block max-w-56 text-gray-500 text-xs dark:text-dark-text">{statusMeaning(row)}</span>
      {row.error !== null && <ErrorNote note={row.error} />}
    </td>
    <td className="py-2 pr-3">
      <StateDiff row={row} />
    </td>
    <td className="py-2 pr-3">
      <LocationLink location={row.location} />
    </td>
    <td className="py-2 pr-3">
      <RowActions busy_key={busy_key} onApprove={() => onApprove(row)} onUndo={() => onUndo(row)} row={row} />
    </td>
  </tr>
);

const UndoByPolicySummary: FC<{ result: UndoByPolicyResult }> = ({ result }) => (
  <div className="mt-3 flex flex-col gap-2">
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-gray-200 border-b text-gray-500 dark:border-dark-border dark:text-dark-text">
            <th className="py-2 pr-3">Mailbox</th>
            <th className="py-2 pr-3 text-right">Examined</th>
            <th className="py-2 pr-3 text-right">Undone</th>
            <th className="py-2 pr-3 text-right">Failed</th>
            <th className="py-2 pr-3 text-right">Skipped</th>
            <th className="py-2 pr-3">Connection</th>
          </tr>
        </thead>
        <tbody>
          {result.mailboxes.map((entry) => (
            <tr className="border-gray-100 border-b dark:border-dark-border" key={entry.mailbox_id}>
              <td className="max-w-40 truncate py-2 pr-3 text-gray-700 dark:text-dark-text">{entry.label}</td>
              <td className="py-2 pr-3 text-right text-gray-700 dark:text-dark-text">{entry.examined.toLocaleString()}</td>
              <td className="py-2 pr-3 text-right text-success">{entry.undone.toLocaleString()}</td>
              <td className="py-2 pr-3 text-right text-danger">{entry.failed.toLocaleString()}</td>
              <td className="py-2 pr-3 text-right text-warning">{entry.skipped.toLocaleString()}</td>
              <td className="max-w-64 py-2 pr-3 text-xs">
                {entry.error === null ? (
                  <span className="text-gray-500 dark:text-dark-text">ok</span>
                ) : (
                  <span className="break-words text-danger">{entry.error}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    <p className="text-gray-700 text-sm dark:text-dark-text">
      Totals — examined {result.totals.examined.toLocaleString()}, undone {result.totals.undone.toLocaleString()}, failed{" "}
      {result.totals.failed.toLocaleString()}, skipped {result.totals.skipped.toLocaleString()}.
    </p>
    {result.totals.skipped > 0 && (
      <p className="rounded border border-warning/40 bg-warning/10 p-2 text-sm text-warning">{SKIPPED_EXPLANATION}</p>
    )}
  </div>
);

const UndoByPolicyPanel: FC<{ mailboxes: MailboxRow[]; onDone: () => Promise<void>; policies: PolicyRow[] }> = ({
  mailboxes,
  onDone,
  policies,
}) => {
  const [policy_id_draft, setPolicyIdDraft] = useState("");
  const [mailbox_id_draft, setMailboxIdDraft] = useState("");
  const [batch_size_draft, setBatchSizeDraft] = useState("50");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<OutcomeBanner | null>(null);
  const [result, setResult] = useState<UndoByPolicyResult | null>(null);

  const runUndo = async () => {
    if (policy_id_draft === "") {
      return;
    }
    const parsed_batch_size = Number(batch_size_draft);
    const batch_size = Number.isFinite(parsed_batch_size) && parsed_batch_size > 0 ? Math.min(200, Math.floor(parsed_batch_size)) : 50;
    setBusy(true);
    setMessage({ text: "Reversing — one mailbox at a time, newest action first…", tone: "info" });
    setResult(null);
    try {
      const outcome = await orpc.mail.undoByPolicy({
        sender_policy_id: policy_id_draft,
        mailbox_id: mailbox_id_draft === "" ? null : mailbox_id_draft,
        batch_size,
      });
      setResult(outcome);
      setMessage(null);
      setConfirmed(false);
      await onDone();
    } catch (error) {
      setMessage(toFailureBanner("Bulk undo failed", error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="Undo everything one policy did">
      <p className="mb-3 text-gray-600 text-sm dark:text-dark-text">
        Reverses applied actions for a single policy, newest first, up to the batch size — per mailbox, so a dead connection fails that
        mailbox and leaves the others reversible. This one does open mailboxes and move messages.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-gray-600 text-xs dark:text-dark-text">
          Policy
          <select
            className={clsx(field, focus_ring)}
            disabled={busy}
            onChange={(event) => setPolicyIdDraft(event.target.value)}
            value={policy_id_draft}
          >
            <option value="">Choose a policy…</option>
            {policies.map((policy) => (
              <option key={policy.id} value={policy.id}>
                {policy.value} — {policy.action}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-gray-600 text-xs dark:text-dark-text">
          Mailbox
          <select
            className={clsx(field, focus_ring)}
            disabled={busy}
            onChange={(event) => setMailboxIdDraft(event.target.value)}
            value={mailbox_id_draft}
          >
            <option value="">Every enabled mailbox</option>
            {mailboxes.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-gray-600 text-xs dark:text-dark-text">
          Batch size
          <input
            className={clsx(field, focus_ring, "w-24")}
            disabled={busy}
            max={200}
            min={1}
            onChange={(event) => setBatchSizeDraft(event.target.value)}
            type="number"
            value={batch_size_draft}
          />
        </label>

        <ActionButton
          busy={busy}
          disabled={busy || policy_id_draft === "" || !confirmed}
          label="Undo this policy"
          onClick={() => void runUndo()}
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
        I understand this moves real messages back to their recorded pre-state.
      </label>

      {message !== null && <Banner banner={message} className="mt-3" />}
      {result !== null && <UndoByPolicySummary result={result} />}
    </Panel>
  );
};

function AdminJournalPage() {
  const { mailboxes, policies, journal } = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const router = useRouter();
  const [busy_key, setBusyKey] = useState<string | null>(null);
  const [action_status, setActionStatus] = useState<OutcomeBanner | null>(null);
  const [sender_draft, setSenderDraft] = useState(search.sender ?? "");

  // reset_offset is for filter changes, which must land back on page one; the pagination buttons pass
  // false and their own offset, so that key has to survive the spread.
  const patchSearch = (patch: Partial<JournalSearch>, reset_offset = true) => {
    void navigate({ search: (prev) => ({ ...prev, ...patch, offset: reset_offset ? 0 : (patch.offset ?? prev.offset) }) });
  };

  const undoRow = async (row: JournalRow) => {
    if (row.mailbox_id === null) {
      return;
    }
    setBusyKey(`undo:${row.action_id}`);
    setActionStatus(null);
    try {
      const outcome = await orpc.mail.undoAction({ action_id: row.action_id, mailbox_id: row.mailbox_id });
      if (outcome.outcome === "undone") {
        setActionStatus({ text: "Reversed — the message is back at its recorded pre-state.", tone: "success" });
      }
      // Amber, not red, and worded the same way the row's own error note is: the action is still applied
      // and the message is still where it put it, so this is a retry, not a broken mailbox.
      if (outcome.outcome === "failed") {
        setActionStatus({
          text: `The reversal did not land: ${outcome.error}. The action still stands and can be retried.`,
          tone: "warning",
        });
      }
      // A refusal means nothing was touched — it reads as information, not as damage.
      if (outcome.outcome === "not_undoable") {
        setActionStatus({ text: `Not undoable (${outcome.reason}): ${outcome.detail}`, tone: "info" });
      }
      await router.invalidate();
    } catch (error) {
      setActionStatus(toFailureBanner("Undo failed", error));
    } finally {
      setBusyKey(null);
    }
  };

  const approveRow = async (row: JournalRow) => {
    if (row.mailbox_id === null) {
      return;
    }
    setBusyKey(`approve:${row.action_id}`);
    setActionStatus(null);
    try {
      // approveDecision's result is a union over both scopes, and only the action arm carries an outcome —
      // narrowing on `scope` first is what keeps the policy arm's counters out of this message.
      const result = await orpc.mail.approveDecision({ scope: "action", mailbox_id: row.mailbox_id, action_id: row.action_id });
      if (result.scope === "action") {
        setActionStatus(
          result.outcome === "promoted"
            ? { text: "Approved — the row is pending and will change the mailbox only when an apply run picks it up.", tone: "success" }
            : { text: `Not approvable (${result.reason}): ${result.detail}`, tone: "info" },
        );
      }
      await router.invalidate();
    } catch (error) {
      setActionStatus(toFailureBanner("Approve failed", error));
    } finally {
      setBusyKey(null);
    }
  };

  const page_start = search.offset + 1;
  const page_end = Math.min(search.offset + search.limit, journal.total);

  return (
    <div className="mx-auto flex max-w-8xl flex-col gap-6 p-6">
      <h1 className="font-bold text-gray-900 text-xl dark:text-dark-headings">Action Journal</h1>

      <p className="text-gray-600 text-sm dark:text-dark-text">
        Every action this system has ever decided or taken, newest first, with the mailbox state it recorded before it acted. Reversed rows
        stay on the record — nothing here is ever deleted.
      </p>

      <UndoByPolicyPanel mailboxes={mailboxes} onDone={() => router.invalidate()} policies={policies} />

      <Panel title="Filters">
        <div className="flex flex-wrap items-end gap-3">
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

          <label className="flex flex-col gap-1 text-gray-600 text-xs dark:text-dark-text">
            Policy
            <select
              className={clsx(field, focus_ring)}
              onChange={(event) => patchSearch({ policy_id: event.target.value === "" ? undefined : event.target.value })}
              value={search.policy_id ?? ""}
            >
              <option value="">All policies</option>
              {policies.map((policy) => (
                <option key={policy.id} value={policy.id}>
                  {policy.value} — {policy.action}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-gray-600 text-xs dark:text-dark-text">
            Status
            <select
              className={clsx(field, focus_ring)}
              onChange={(event) => patchSearch({ status: event.target.value as JournalSearch["status"] })}
              value={search.status}
            >
              {journal_status_filters.map((status) => (
                <option key={status} value={status}>
                  {status === "all" ? "Every status" : status_label[status]}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-gray-600 text-xs dark:text-dark-text">
            From
            <input
              className={clsx(field, focus_ring)}
              onChange={(event) => patchSearch({ since: event.target.value === "" ? undefined : event.target.value })}
              type="date"
              value={search.since ?? ""}
            />
          </label>

          <label className="flex flex-col gap-1 text-gray-600 text-xs dark:text-dark-text">
            To
            <input
              className={clsx(field, focus_ring)}
              onChange={(event) => patchSearch({ until: event.target.value === "" ? undefined : event.target.value })}
              type="date"
              value={search.until ?? ""}
            />
          </label>

          <form
            className="flex items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              patchSearch({ sender: sender_draft === "" ? undefined : sender_draft });
            }}
          >
            <label className="flex flex-col gap-1 text-gray-600 text-xs dark:text-dark-text">
              Sender (exact address)
              <input
                className={clsx(field, focus_ring, "w-64")}
                onChange={(event) => setSenderDraft(event.target.value)}
                placeholder="name@example.com"
                type="text"
                value={sender_draft}
              />
            </label>
            <button className={secondary_button_focus} type="submit">
              Apply
            </button>
          </form>

          <button
            className={secondary_button_focus}
            onClick={() => {
              setSenderDraft("");
              patchSearch({
                mailbox_id: undefined,
                policy_id: undefined,
                sender: undefined,
                since: undefined,
                status: "all",
                until: undefined,
              });
            }}
            type="button"
          >
            Clear filters
          </button>
        </div>
      </Panel>

      <Panel title={`Actions (${journal.total.toLocaleString()})`}>
        {action_status !== null && <Banner banner={action_status} className="mb-3" />}

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-gray-200 border-b text-gray-500 dark:border-dark-border dark:text-dark-text">
                <th className="py-2 pr-3">When</th>
                <th className="py-2 pr-3">Message</th>
                <th className="py-2 pr-3">Action</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3">Mailbox state</th>
                <th className="py-2 pr-3">Open</th>
                <th className="py-2 pr-3">Reverse</th>
              </tr>
            </thead>
            <tbody>
              {journal.rows.map((row) => (
                <JournalTableRow busy_key={busy_key} key={row.action_id} onApprove={approveRow} onUndo={undoRow} row={row} />
              ))}
              {journal.rows.length === 0 && (
                <tr>
                  <td className="py-4 text-center text-gray-500 dark:text-dark-text" colSpan={7}>
                    No actions match these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-3 flex items-center justify-between text-gray-600 text-sm dark:text-dark-text">
          <p>
            {journal.total === 0
              ? "0 of 0"
              : `${page_start.toLocaleString()}–${page_end.toLocaleString()} of ${journal.total.toLocaleString()}`}
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
              disabled={page_end >= journal.total}
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
