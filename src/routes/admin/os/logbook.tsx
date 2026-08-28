import { DAY_MS, operatorDateOf } from "@server/operator-day";
import { createFileRoute } from "@tanstack/react-router";
import clsx from "clsx";
import { useState } from "react";
import { z } from "zod";
import { orpc } from "~/integrations/orpc";
import { Banner } from "../-outcome-banner";
import { formatDay } from "./-format";
import { OsPanel } from "./-task-row";
import { useTaskAction } from "./-use-task-action";

const LOGBOOK_DAYS = 90;

const logbook_search_schema = z.object({ from: z.string().optional(), to: z.string().optional() });

export const Route = createFileRoute("/admin/os/logbook")({
  validateSearch: logbook_search_schema,
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const to = deps.to ?? operatorDateOf();
    const from = deps.from ?? operatorDateOf(new Date(Date.now() - LOGBOOK_DAYS * DAY_MS));

    return { entries: await orpc.personalReview.listLogbook({ from, to }), range: { from, to } };
  },
  component: PersonalOsLogbookPage,
});

function PersonalOsLogbookPage() {
  const { entries, range } = Route.useLoaderData();
  const { banner, busy_key, run } = useTaskAction();
  const [confirm, setConfirm] = useState("");

  const completed = entries.filter((entry) => entry.state === "completed");
  const cancelled = entries.filter((entry) => entry.state === "cancelled");

  return (
    <>
      <div>
        <p className="font-bold text-gray-900 text-xl dark:text-dark-headings">Logbook</p>
        <p className="mt-0.5 text-gray-500 text-sm dark:text-dark-text">
          {range.from} &ndash; {range.to} &middot; {completed.length} done, {cancelled.length} cancelled
        </p>
      </div>

      {banner !== null && <Banner banner={banner} className="" />}

      <OsPanel title="Settled work">
        {entries.length === 0 && <p className="text-gray-500 text-sm dark:text-dark-text">Nothing settled in this range.</p>}
        <ul className="flex flex-col">
          {entries.map((entry) => (
            <li className="flex flex-col gap-1 border-gray-200 border-b border-dotted py-1.5 dark:border-dark-border" key={entry.id}>
              <div className="flex items-center gap-3">
                <span
                  className={clsx(
                    "flex-grow text-sm",
                    entry.state === "completed"
                      ? "text-gray-900 dark:text-dark-headings"
                      : "text-gray-500 line-through dark:text-dark-text",
                  )}
                >
                  {entry.title}
                </span>
                {entry.deferral_count > 0 && (
                  <span className="rounded-sm border border-gray-300 px-1.5 text-gray-500 text-xs dark:border-dark-border dark:text-dark-text">
                    !{entry.deferral_count}
                  </span>
                )}
                <span className="text-gray-500 text-xs dark:text-dark-text">
                  {entry.settled_at === null ? "—" : formatDay(entry.settled_at)}
                </span>
              </div>
              {entry.reason !== null && <p className="text-gray-500 text-xs italic dark:text-dark-text">&ldquo;{entry.reason}&rdquo;</p>}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[13px] text-gray-600 dark:text-dark-text">
          Cancelling is not deleting. A task that was dropped stays readable here with the reason it was last rescheduled, which is the only
          place the record can say why something took as long as it did.
        </p>
      </OsPanel>

      <OsPanel dashed title="Amnesty">
        <p className="text-[13px] text-gray-600 dark:text-dark-text">
          Archive every open task at once &mdash; inbox, pool and someday alike. They land here, cancelled, and nothing is destroyed. A
          backlog that has become frightening is not fixed by working through it; it is fixed by being allowed to declare it over.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            className="min-w-0 flex-grow rounded border border-gray-300 bg-bg px-2 py-1.5 text-gray-900 text-sm placeholder:text-gray-400 dark:border-dark-border dark:bg-dark-bg dark:text-dark-headings"
            onChange={(event) => setConfirm(event.target.value)}
            placeholder="type: archive everything"
            value={confirm}
          />
          <button
            className="rounded border border-danger px-3 py-1.5 text-danger text-sm disabled:cursor-not-allowed disabled:opacity-50"
            disabled={busy_key !== null || confirm !== "archive everything"}
            onClick={() =>
              run("amnesty", "Could not archive", async () => {
                await orpc.personalReview.archiveEverything({ confirm: "archive everything" });
                setConfirm("");
              })
            }
            type="button"
          >
            Archive everything
          </button>
        </div>
      </OsPanel>
    </>
  );
}
