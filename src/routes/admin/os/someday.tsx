import { createFileRoute } from "@tanstack/react-router";
import { orpc } from "~/integrations/orpc";
import { Banner } from "../-outcome-banner";
import { OsPanel, TaskTitleLink } from "./-task-row";
import { useTaskAction } from "./-use-task-action";

export const Route = createFileRoute("/admin/os/someday")({
  loader: async () => ({ items: await orpc.personalTasks.listSomeday() }),
  component: PersonalOsSomedayPage,
});

const action_class =
  "rounded border border-gray-300 px-2 py-1 text-gray-600 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info disabled:cursor-not-allowed disabled:opacity-50 dark:border-dark-border dark:text-dark-text";

function PersonalOsSomedayPage() {
  const { items } = Route.useLoaderData();
  const { banner, busy_key, run } = useTaskAction();

  const oldest_days = items.reduce((oldest, item) => Math.max(oldest, item.someday_days), 0);

  const revive = (id: string) =>
    run(id, "Could not revive the task", async () => {
      await orpc.personalTasks.revive({ id });
    });

  const cancel = (id: string) =>
    run(id, "Could not cancel the task", async () => {
      await orpc.personalTasks.setState({ id, state: "cancelled" });
    });

  return (
    <>
      <div>
        <p className="font-bold text-gray-900 text-xl dark:text-dark-headings">Someday</p>
        <p className="mt-0.5 text-gray-500 text-sm dark:text-dark-text">
          {items.length} {items.length === 1 ? "item" : "items"}
          {items.length > 0 && `, oldest ${oldest_days} ${oldest_days === 1 ? "day" : "days"}`}
        </p>
      </div>

      {banner !== null && <Banner banner={banner} className="" />}

      <OsPanel title="Parked, not forgotten">
        {items.length === 0 && <p className="text-gray-500 text-sm dark:text-dark-text">Nothing is parked in someday.</p>}
        <div className="flex flex-col">
          {items.map((task) => (
            <div className="flex items-center gap-3 border-gray-200 border-b border-dotted py-1.5 dark:border-dark-border" key={task.id}>
              <TaskTitleLink task={task} />
              <span className="text-gray-500 text-xs dark:text-dark-text">
                someday for {task.someday_days} {task.someday_days === 1 ? "day" : "days"}
              </span>
              <button className={action_class} disabled={busy_key !== null} onClick={() => revive(task.id)} type="button">
                Revive
              </button>
              <button className={action_class} disabled={busy_key !== null} onClick={() => cancel(task.id)} type="button">
                Cancel
              </button>
            </div>
          ))}
        </div>
        <p className="mt-2.5 text-gray-600 text-xs dark:text-dark-text">
          Revive puts a task back in Anytime with no date and no week; cancel sends it to the logbook. Age counts from the last touch.
        </p>
      </OsPanel>
    </>
  );
}
