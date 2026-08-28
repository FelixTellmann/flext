import { createFileRoute, getRouteApi, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { orpc } from "~/integrations/orpc";
import type { OutcomeBanner } from "../-outcome-banner";
import { Banner, toFailureBanner } from "../-outcome-banner";
import { useCaptureStore } from "./-capture";
import { formatOperatorToday, formatTaskDay, OsPanel, type PersonalTask, TaskRow } from "./-task-row";

const shell_route = getRouteApi("/admin/os");

export const Route = createFileRoute("/admin/os/")({
  loader: async () => orpc.personalTasks.listToday(),
  component: PersonalOsTodayPage,
});

function PersonalOsTodayPage() {
  const { committed, hidden_count, overdue } = Route.useLoaderData();
  const { plan_week } = shell_route.useLoaderData();
  const router = useRouter();
  const [, setCaptureOpen] = useCaptureStore();

  const [banner, setBanner] = useState<OutcomeBanner | null>(null);
  const [busy_id, setBusyId] = useState<string | null>(null);
  const [blocked_id, setBlockedId] = useState<string | null>(null);
  const [hidden, setHidden] = useState<PersonalTask[] | null>(null);

  const runOnTask = async (id: string, prefix: string, run: () => Promise<void>) => {
    setBusyId(id);
    setBanner(null);
    try {
      await run();
      await router.invalidate();
    } catch (error) {
      setBanner(toFailureBanner(prefix, error));
    } finally {
      setBusyId(null);
    }
  };

  const complete = (id: string) =>
    runOnTask(id, "Could not complete the task", async () => {
      setBlockedId(null);
      await orpc.personalTasks.setState({ id, state: "completed" });
    });

  // pushOut answers `blocked` rather than throwing, because refusing a fourth deferral is a decision the
  // system made on purpose — not an error. The row has to say so, or the click looks broken.
  const pushOut = (id: string) =>
    runOnTask(id, "Could not push the task out", async () => {
      const result = await orpc.personalTasks.pushOut({ id });
      setBlockedId(result.blocked ? id : null);
    });

  const dispose = (id: string, state: "someday" | "cancelled") =>
    runOnTask(id, "Could not settle the task", async () => {
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
        busy={busy_id === task.id}
        disabled={busy_id !== null}
        onAction={() => pushOut(task.id)}
        onComplete={() => complete(task.id)}
        overdue_since={overdue_since}
        task={task}
      />
      {blocked_id === task.id && (
        <div className="flex flex-wrap items-center gap-2 rounded border border-warning/40 bg-warning/10 p-2 text-sm text-warning">
          <span className="flex-grow">
            Pushed out {task.deferral_count} times already. It stays here until you decide what it really is.
          </span>
          <button
            className="rounded border border-warning/40 px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info"
            onClick={() => dispose(task.id, "someday")}
            type="button"
          >
            Someday
          </button>
          <button
            className="rounded border border-warning/40 px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info"
            onClick={() => dispose(task.id, "cancelled")}
            type="button"
          >
            Drop it
          </button>
        </div>
      )}
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
