import clsx from "clsx";
import type { FC, ReactNode } from "react";
import type { orpc } from "~/integrations/orpc";
import { Spinner } from "../-ui";

export type PersonalTask = Awaited<ReturnType<typeof orpc.personalTasks.listToday>>["committed"][number];

// The server decides what "today" means at a fixed +02:00 (OPERATOR_UTC_OFFSET_MINUTES in
// server/orpc/personal-tasks.ts). Naming the zone here rather than reading the browser's keeps the server
// render and the hydrated one identical, and stops a date the server called today printing as yesterday.
const OPERATOR_TIME_ZONE = "Africa/Johannesburg";

export const formatTaskDay = (iso: string): string =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: OPERATOR_TIME_ZONE }).format(new Date(iso));

export const formatOperatorToday = (): string =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", timeZone: OPERATOR_TIME_ZONE, weekday: "long" }).format(new Date());

// One row, shared by Today and the week pool, which differ only in the verb on the right: Today can push a
// task out, the pool can pull one in. Everything else about a task looks the same wherever it is read.
export const TaskRow: FC<{
  action_label: string;
  busy: boolean;
  disabled: boolean;
  onAction: () => void;
  onComplete: () => void;
  overdue_since: string | null;
  task: PersonalTask;
}> = ({ action_label, busy, disabled, onAction, onComplete, overdue_since, task }) => (
  <div className="flex items-center gap-3 rounded border border-gray-200 bg-bg p-3 dark:border-dark-border dark:bg-dark-bg">
    <button
      aria-label={`Complete ${task.title}`}
      className="h-4 w-4 flex-shrink-0 rounded-sm border-[1.5px] border-gray-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info disabled:cursor-not-allowed disabled:opacity-50 dark:border-dark-border"
      disabled={disabled}
      onClick={() => onComplete()}
      type="button"
    />
    <span className="flex-grow text-gray-900 text-sm dark:text-dark-headings">{task.title}</span>

    {overdue_since !== null && <span className="text-danger text-xs">was {overdue_since}</span>}

    {task.focus && (
      <span className="rounded-sm border border-accent px-1.5 text-accent text-xs dark:border-accent-dark dark:text-accent-dark">
        focus
      </span>
    )}

    {task.deferral_count > 0 && (
      <span
        className="rounded-sm border border-gray-300 px-1.5 text-gray-500 text-xs dark:border-dark-border dark:text-dark-text"
        title={`Pushed out ${task.deferral_count} time${task.deferral_count === 1 ? "" : "s"}`}
      >
        !{task.deferral_count}
      </span>
    )}

    <button
      className="inline-flex items-center justify-center gap-1.5 rounded border border-gray-300 px-2 py-1 text-gray-600 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info disabled:cursor-not-allowed disabled:opacity-50 dark:border-dark-border dark:text-dark-text"
      disabled={disabled}
      onClick={() => onAction()}
      type="button"
    >
      {busy && <Spinner />}
      {action_label}
    </button>
  </div>
);

// A section is a panel with a heading, and the peek block is the same panel drawn as a dashed outline so
// that "revealed, not committed to" reads before you have finished the heading.
export const OsPanel: FC<{ children: ReactNode; dashed?: boolean; title: string }> = ({ children, dashed, title }) => (
  <section
    className={clsx(
      "rounded-lg border bg-card p-4 dark:bg-dark-card",
      dashed === true ? "border-gray-300 border-dashed dark:border-dark-border" : "border-gray-200 dark:border-dark-border",
    )}
  >
    <h2 className="mb-3 font-semibold text-gray-900 text-sm dark:text-dark-headings">{title}</h2>
    {children}
  </section>
);
