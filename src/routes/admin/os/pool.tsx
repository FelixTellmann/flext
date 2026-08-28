import { createFileRoute, useRouter } from "@tanstack/react-router";
import clsx from "clsx";
import { useEffect, useState } from "react";
import { orpc } from "~/integrations/orpc";
import type { OutcomeBanner } from "../-outcome-banner";
import { Banner, toFailureBanner } from "../-outcome-banner";
import { DeferralBadge, OsPanel, type PersonalTask, TaskRow } from "./-task-row";

export const Route = createFileRoute("/admin/os/pool")({
  loader: async () => {
    const { plan_week } = await orpc.personalTasks.currentWeek();
    const [pool, today] = await Promise.all([orpc.personalTasks.listPool({ plan_week }), orpc.personalTasks.listToday()]);

    return { plan_week, pool, today };
  },
  component: PersonalOsPoolPage,
});

function PersonalOsPoolPage() {
  const { plan_week, pool, today } = Route.useLoaderData();
  const router = useRouter();

  const [banner, setBanner] = useState<OutcomeBanner | null>(null);
  const [busy_id, setBusyId] = useState<string | null>(null);
  const [blocked_id, setBlockedId] = useState<string | null>(null);
  const [dragging_id, setDraggingId] = useState<string | null>(null);
  const [order, setOrder] = useState<PersonalTask[]>(pool);

  // The loader hands back a fresh array on every invalidate, so this resynchronises the dragged order with
  // whatever the server actually stored — including a reorder that failed and never landed.
  useEffect(() => {
    setOrder(pool);
  }, [pool]);

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

  const pull = (id: string) =>
    runOnTask(id, "Could not pull the task into today", async () => {
      await orpc.personalTasks.pullToToday({ id });
    });

  const complete = (id: string) =>
    runOnTask(id, "Could not complete the task", async () => {
      setBlockedId(null);
      await orpc.personalTasks.setState({ id, state: "completed" });
    });

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

  const moveTask = (list: PersonalTask[], id: string, to: number): PersonalTask[] | null => {
    const from = list.findIndex((task) => task.id === id);
    const moved = list[from];

    if (from === -1 || moved === undefined || to < 0 || to >= list.length || to === from) {
      return null;
    }

    const next = [...list];
    next.splice(from, 1);
    next.splice(to, 0, moved);
    return next;
  };

  // Only pool_order moves, and nothing else does. A task can be dragged to the bottom every day of the
  // week without that counting as a deferral — the count is reserved for a same-day promise you broke.
  const persistOrder = async (ids: string[]) => {
    setBanner(null);
    try {
      await orpc.personalTasks.reorderPool({ ids });
    } catch (error) {
      setBanner(toFailureBanner("Could not save the new order", error));
    }
    await router.invalidate();
  };

  const dragOver = (target_id: string) => {
    if (dragging_id === null || dragging_id === target_id) {
      return;
    }

    setOrder(
      (current) =>
        moveTask(
          current,
          dragging_id,
          current.findIndex((task) => task.id === target_id),
        ) ?? current,
    );
  };

  // Dragging is mouse-only — a pointer gesture no keyboard can express — so the handle answers the arrow
  // keys with the same move. Without it the pool is orderable by some people and fixed for the rest.
  const nudge = (id: string, delta: number) => {
    const next = moveTask(order, id, order.findIndex((task) => task.id === id) + delta);

    if (next === null) {
      return;
    }

    setOrder(next);
    void persistOrder(next.map((task) => task.id));
  };

  return (
    <>
      <div>
        <p className="font-bold text-gray-900 text-xl dark:text-dark-headings">Week pool &rarr; Today</p>
        <p className="mt-1 text-gray-500 text-sm dark:text-dark-text">
          Week {plan_week} &middot; pulling is the commitment; reordering is free
        </p>
      </div>

      {banner !== null && <Banner banner={banner} className="" />}

      <div className="grid items-start gap-5 md:grid-cols-2">
        <OsPanel title={`Week pool — ${order.length}`}>
          <ul className="flex flex-col gap-2">
            {order.length === 0 && (
              <li className="text-gray-500 text-sm dark:text-dark-text">The pool is empty. Capture something, or plan the week.</li>
            )}
            {order.map((task) => (
              <li
                className={clsx(
                  "flex items-center gap-2.5 rounded border border-gray-200 bg-bg px-3 py-2.5 dark:border-dark-border dark:bg-dark-bg",
                  dragging_id === task.id && "opacity-50",
                )}
                draggable
                key={task.id}
                onDragEnd={() => persistOrder(order.map((item) => item.id))}
                onDragOver={(event) => {
                  event.preventDefault();
                  dragOver(task.id);
                }}
                onDragStart={() => setDraggingId(task.id)}
              >
                <button
                  aria-label={`Reorder ${task.title}`}
                  className="cursor-grab text-[13px] text-gray-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info dark:text-dark-text"
                  onKeyDown={(event) => {
                    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") {
                      return;
                    }

                    event.preventDefault();
                    nudge(task.id, event.key === "ArrowUp" ? -1 : 1);
                  }}
                  type="button"
                >
                  &#10303;
                </button>
                <span className="flex-grow text-gray-900 text-sm dark:text-dark-headings">{task.title}</span>
                <DeferralBadge count={task.deferral_count} />
                <button
                  className="rounded border border-gray-300 px-2.5 py-1 text-gray-900 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info disabled:cursor-not-allowed disabled:opacity-50 dark:border-dark-border dark:text-dark-headings"
                  disabled={busy_id !== null}
                  onClick={() => pull(task.id)}
                  type="button"
                >
                  pull &rarr;
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-gray-600 text-xs dark:text-dark-text">
            No dates here. Dragging to reorder costs nothing and counts nothing &mdash; that is planning, not avoidance.
          </p>
        </OsPanel>

        <OsPanel title={`Committed today — ${today.committed.length}`}>
          <div className="flex flex-col gap-2">
            {today.committed.length === 0 && <p className="text-gray-500 text-sm dark:text-dark-text">Nothing pulled in yet.</p>}
            {today.committed.map((task) => (
              <div className="flex flex-col gap-2" key={task.id}>
                <TaskRow
                  action_label="Not today"
                  busy={busy_id === task.id}
                  disabled={busy_id !== null}
                  onAction={() => pushOut(task.id)}
                  onComplete={() => complete(task.id)}
                  overdue_since={null}
                  task={task}
                />
                {blocked_id === task.id && (
                  <div className="flex flex-wrap items-center gap-2 rounded border border-danger p-2.5 text-[13px] text-gray-600 dark:text-dark-text">
                    <span className="flex-grow">
                      Blocked at three. It stops moving and owes a disposition: do it today, someday, or cancel it to the logbook.
                    </span>
                    <button
                      className="rounded border border-gray-300 px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info dark:border-dark-border"
                      onClick={() => dispose(task.id, "someday")}
                      type="button"
                    >
                      Someday
                    </button>
                    <button
                      className="rounded border border-gray-300 px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info dark:border-dark-border"
                      onClick={() => dispose(task.id, "cancelled")}
                      type="button"
                    >
                      Drop it
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
          <p className="mt-3 text-gray-600 text-xs dark:text-dark-text">
            Push one out and it returns to the pool wearing a higher count. Only a same-day promise you break counts.
          </p>
        </OsPanel>
      </div>
    </>
  );
}
