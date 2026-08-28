import { OPERATOR_TIME_ZONE } from "@server/operator-day";
import { createFileRoute, getRouteApi } from "@tanstack/react-router";
import { useState } from "react";
import { orpc } from "~/integrations/orpc";
import { Banner, toFailureBanner } from "../-outcome-banner";
import { useCaptureStore } from "./-capture";
import { BlockedNotice, OsPanel, type PersonalTask, TaskRow } from "./-task-row";
import { useTaskAction } from "./-use-task-action";

const shell_route = getRouteApi("/admin/os");

// Formatted in the operator's zone rather than the browser's, so the server render and the hydrated one
// agree and a date the server called today never prints as yesterday.
const formatTaskDay = (iso: string): string =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: OPERATOR_TIME_ZONE }).format(new Date(iso));

const formatOperatorToday = (): string =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", timeZone: OPERATOR_TIME_ZONE, weekday: "long" }).format(new Date());

export const Route = createFileRoute("/admin/os/")({
  loader: async () => {
    const [today, inbox] = await Promise.all([orpc.personalTasks.listToday(), orpc.personalTasks.listInbox()]);

    return { ...today, inbox };
  },
  component: PersonalOsTodayPage,
});

function PersonalOsTodayPage() {
  const { committed, hidden_count, inbox, overdue } = Route.useLoaderData();
  const { plan_week } = shell_route.useLoaderData();
  const [, setCaptureOpen] = useCaptureStore();
  const { banner, busy_key, run, setBanner } = useTaskAction();

  const [blocked_id, setBlockedId] = useState<string | null>(null);
  const [hidden, setHidden] = useState<PersonalTask[] | null>(null);
  const [triaging, setTriaging] = useState(false);

  const complete = (id: string) =>
    run(id, "Could not complete the task", async () => {
      setBlockedId(null);
      await orpc.personalTasks.setState({ id, state: "completed" });
    });

  const pushOut = (id: string) =>
    run(id, "Could not push the task out", async () => {
      const result = await orpc.personalTasks.pushOut({ id });
      setBlockedId(result.blocked ? id : null);
    });

  const pullToToday = (id: string) =>
    run(id, "Could not pull the task into today", async () => {
      await orpc.personalTasks.pullToToday({ id });
    });

  const sendToPool = (id: string) =>
    run(id, "Could not send the task to the pool", async () => {
      await orpc.personalTasks.sendToPool({ id });
    });

  const dispose = (id: string, state: "someday" | "cancelled") =>
    run(id, "Could not settle the task", async () => {
      setBlockedId(null);
      await orpc.personalTasks.setState({ id, state });
    });

  // Peek reveals and changes nothing, so it loads its own list on demand rather than riding the loader —
  // hiding is only bearable while you can prove the hidden things are still there.
  const togglePeek = async () => {
    if (hidden !== null) {
      setHidden(null);
      return;
    }

    setBanner(null);
    try {
      setHidden(await orpc.personalTasks.listHidden());
    } catch (error) {
      setBanner(toFailureBanner("Could not read what is hidden", error));
    }
  };

  const renderTask = (task: PersonalTask, overdue_since: string | null) => (
    <div className="flex flex-col gap-2" key={task.id}>
      <TaskRow
        action_label="Not today"
        busy={busy_key === task.id}
        disabled={busy_key !== null}
        onAction={() => pushOut(task.id)}
        onComplete={() => complete(task.id)}
        overdue_since={overdue_since}
        task={task}
      />
      {blocked_id === task.id && <BlockedNotice disabled={busy_key !== null} onDispose={(state) => dispose(task.id, state)} />}
    </div>
  );

  return (
    <>
      <div className="flex items-center gap-3">
        <div className="flex-grow">
          <p className="font-bold text-gray-900 text-xl dark:text-dark-headings">{formatOperatorToday()}</p>
          <p className="mt-0.5 text-gray-500 text-sm dark:text-dark-text">
            Week {plan_week.slice(-2)} &middot; {hidden_count} {hidden_count === 1 ? "item" : "items"} hidden until later
          </p>
        </div>
        <button
          className="rounded border border-gray-300 px-3 py-1 text-gray-900 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info dark:border-dark-border dark:text-dark-headings"
          onClick={() => togglePeek()}
          type="button"
        >
          {hidden === null ? "Peek" : "Hide"}
        </button>
        <button
          className="rounded bg-accent px-3 py-2 font-medium text-sm text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info dark:bg-accent-dark dark:text-dark-bg"
          onClick={() => setCaptureOpen(true)}
          type="button"
        >
          Capture
        </button>
      </div>

      {banner !== null && <Banner banner={banner} className="" />}

      {/* A count by default, expanded only when triaged. §3.5: the inbox must never become the
          working list, and a list of captured thoughts sitting open above today's commitments is
          precisely that. Expanding is the morning recap's triage step. */}
      {inbox.length > 0 && (
        <section className="rounded-lg border border-gray-200 bg-card p-4 dark:border-dark-border dark:bg-dark-card">
          <button
            aria-expanded={triaging}
            className="flex w-full items-center gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info"
            onClick={() => setTriaging((open) => !open)}
            type="button"
          >
            <span className="font-semibold text-gray-900 text-sm dark:text-dark-headings">Inbox &mdash; {inbox.length}</span>
            <span className="flex-grow text-[13px] text-gray-500 dark:text-dark-text">
              {triaging ? "one action each, then it is empty" : "captured, not yet triaged"}
            </span>
            <span className="text-gray-500 text-xs dark:text-dark-text">{triaging ? "Hide" : "Triage"}</span>
          </button>

          {triaging && (
            <ul className="mt-3 flex flex-col gap-2">
              {inbox.map((task) => (
                <li
                  className="flex flex-wrap items-center gap-2 rounded border border-gray-200 bg-bg p-3 dark:border-dark-border dark:bg-dark-bg"
                  key={task.id}
                >
                  <span className="min-w-0 flex-grow text-gray-900 text-sm dark:text-dark-headings">{task.title}</span>
                  {[
                    { label: "today", run: () => pullToToday(task.id) },
                    { label: "→ pool", run: () => sendToPool(task.id) },
                    { label: "someday", run: () => dispose(task.id, "someday") },
                    { label: "drop", run: () => dispose(task.id, "cancelled") },
                  ].map((exit) => (
                    <button
                      className="rounded border border-gray-300 px-2 py-1 text-gray-600 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info disabled:cursor-not-allowed disabled:opacity-50 dark:border-dark-border dark:text-dark-text"
                      disabled={busy_key !== null}
                      key={exit.label}
                      onClick={() => exit.run()}
                      type="button"
                    >
                      {exit.label}
                    </button>
                  ))}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <OsPanel title="Committed today">
        {committed.length === 0 && (
          <p className="text-gray-500 text-sm dark:text-dark-text">Nothing committed yet. The pool is where you pick.</p>
        )}
        <div className="flex flex-col gap-2">{committed.map((task) => renderTask(task, null))}</div>
      </OsPanel>

      {overdue.length > 0 && (
        <OsPanel title="Overdue">
          <div className="flex flex-col gap-2">
            {overdue.map((task) => renderTask(task, task.when_date === null ? null : formatTaskDay(task.when_date)))}
          </div>
        </OsPanel>
      )}

      <OsPanel title="Did yesterday go sideways?">
        <p className="text-gray-500 text-sm dark:text-dark-text">
          The guardrail prompts land here once there are guardrails to answer for. Until then this is the space they will occupy.
        </p>
      </OsPanel>

      {hidden !== null && (
        <OsPanel dashed title="Hidden by when">
          <div className="flex flex-col gap-1.5">
            {hidden.length === 0 && <p className="text-gray-500 text-sm dark:text-dark-text">Nothing is hidden.</p>}
            {hidden.map((task) => (
              <div className="flex items-center gap-3 border-gray-200 border-b border-dotted py-1 dark:border-dark-border" key={task.id}>
                <span className="flex-grow text-gray-500 text-sm dark:text-dark-text">{task.title}</span>
                <span className="rounded-sm border border-gray-300 px-1.5 text-gray-500 text-xs dark:border-dark-border dark:text-dark-text">
                  {task.when_date === null ? "someday" : `when ${formatTaskDay(task.when_date)}`}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-2.5 text-gray-600 text-xs dark:text-dark-text">
            Hiding only works while you trust hidden things exist. One keystroke, and they do.
          </p>
        </OsPanel>
      )}
    </>
  );
}
