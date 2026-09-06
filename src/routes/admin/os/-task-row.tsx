import { operatorDateOf } from "@server/operator-day";
import { Link } from "@tanstack/react-router";
import clsx from "clsx";
import type { FC, ReactNode } from "react";
import type { orpc } from "~/integrations/orpc";
import { Spinner } from "../-ui";
import { formatDay } from "./-format";

export type PersonalTask = Awaited<ReturnType<typeof orpc.personalTasks.listToday>>["committed"][number];

// pushOut answers `blocked` rather than throwing: refusing a fourth deferral is a decision the system
// made on purpose, not a failure. Saying nothing would make the click look broken instead of answered.
export const BlockedNotice: FC<{ disabled: boolean; onDispose: (state: "someday" | "cancelled") => void }> = ({ disabled, onDispose }) => (
  <div className="flex flex-wrap items-center gap-2 rounded border border-danger p-2.5 text-[13px] text-gray-600 dark:text-dark-text">
    <span className="flex-grow">
      Blocked at three. It stops moving and owes a disposition: do it today, put it in someday, or cancel it to the logbook.
    </span>
    <button
      className="rounded border border-gray-300 px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info disabled:cursor-not-allowed disabled:opacity-50 dark:border-dark-border"
      disabled={disabled}
      onClick={() => onDispose("someday")}
      type="button"
    >
      Someday
    </button>
    <button
      className="rounded border border-gray-300 px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info disabled:cursor-not-allowed disabled:opacity-50 dark:border-dark-border"
      disabled={disabled}
      onClick={() => onDispose("cancelled")}
      type="button"
    >
      Drop it
    </button>
  </div>
);

// A task that has bounced back has to look different from a fresh one, or the count is bookkeeping nobody
// reads. Nothing is drawn at zero: the badge is news, not a field.
export const DeferralBadge: FC<{ count: number }> = ({ count }) => {
  if (count === 0) {
    return null;
  }

  return (
    <span
      className="rounded-sm border border-gray-300 px-1.5 text-gray-500 text-xs dark:border-dark-border dark:text-dark-text"
      title={`Pushed out ${count} time${count === 1 ? "" : "s"}`}
    >
      !{count}
    </span>
  );
};

// The title of every row is the way into the detail editor, wherever the row is read.
export const TaskTitleLink: FC<{ task: Pick<PersonalTask, "id" | "title"> }> = ({ task }) => (
  <Link
    className="min-w-0 flex-grow text-gray-900 text-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info dark:text-dark-headings"
    params={{ taskId: task.id }}
    to="/admin/os/task/$taskId"
  >
    {task.title}
  </Link>
);

// Quiet on purpose: a deadline hides nothing and schedules nothing, so it reads as a fact under the title
// rather than a verb beside it. Today or past turns it the same danger the overdue dates already use.
export const DeadlineLine: FC<{ className?: string; deadline: string | null }> = ({ className, deadline }) => {
  if (deadline === null) {
    return null;
  }

  const due = operatorDateOf(new Date(deadline)) <= operatorDateOf();

  return (
    <span className={clsx("text-xs", due ? "text-danger" : "text-gray-500 dark:text-dark-text", className)}>
      deadline {formatDay(deadline)}
    </span>
  );
};

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
    <div className="flex min-w-0 flex-grow flex-col items-start gap-0.5">
      <TaskTitleLink task={task} />
      <DeadlineLine deadline={task.deadline} />
    </div>

    {overdue_since !== null && <span className="text-danger text-xs">was {overdue_since}</span>}

    {task.focus && (
      <span className="rounded-sm border border-accent px-1.5 text-accent text-xs dark:border-accent-dark dark:text-accent-dark">
        focus
      </span>
    )}

    <DeferralBadge count={task.deferral_count} />

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
