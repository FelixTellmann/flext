import { operatorWeekRange } from "@server/operator-day";
import { createFileRoute, Link } from "@tanstack/react-router";
import clsx from "clsx";
import { type FC, type ReactNode, useState } from "react";
import { orpc } from "~/integrations/orpc";
import { Banner } from "../-outcome-banner";
import { formatColon, formatDay } from "./-format";
import { OsPanel } from "./-task-row";
import { useTaskAction } from "./-use-task-action";

type Disposition = Awaited<ReturnType<typeof orpc.personalReview.listDispositionsRequired>>[number];

export const Route = createFileRoute("/admin/os/review")({
  loader: async () => {
    const week = operatorWeekRange();
    const review = await orpc.personalReview.openCurrent();
    const [dispositions, someday, ledger, pool, inbox] = await Promise.all([
      orpc.personalReview.listDispositionsRequired(),
      orpc.personalReview.listSomedaySweep(),
      orpc.personalLedger.listRange(week),
      orpc.personalTasks.listPool({ plan_week: review.plan_week }),
      orpc.personalTasks.listInbox(),
    ]);

    return { dispositions, inbox_count: inbox.length, ledger, pool_count: pool.length, review, someday, week };
  },
  component: PersonalOsReviewPage,
});

const Step: FC<{ children: ReactNode; number: number; title: string }> = ({ children, number, title }) => (
  <OsPanel title={`${number}   ${title}`}>{children}</OsPanel>
);

function PersonalOsReviewPage() {
  const { dispositions, inbox_count, ledger, pool_count, review, someday, week } = Route.useLoaderData();
  const { banner, busy_key, run } = useTaskAction();

  const [scheduling_id, setSchedulingId] = useState<string | null>(null);
  const [schedule_date, setScheduleDate] = useState("");
  const [schedule_reason, setScheduleReason] = useState("");
  const [note, setNote] = useState(review.note ?? "");

  const dispose = (id: string, exit: "do_today" | "someday" | "cancel") =>
    run(id, "Could not settle the task", async () => {
      await orpc.personalReview.dispose({ id, exit });
    });

  const schedule = (id: string) =>
    run(id, "Could not schedule the task", async () => {
      await orpc.personalReview.dispose({
        id,
        exit: "schedule",
        when_date: new Date(`${schedule_date}T09:00:00.000Z`).toISOString(),
        reason: schedule_reason.trim(),
      });
      setSchedulingId(null);
      setScheduleDate("");
      setScheduleReason("");
    });

  const under_floor = ledger.streams.filter((stream) => (stream.deficit_seconds ?? 0) > 0);
  const top_consumer = ledger.streams.find((stream) => (stream.deficit_seconds ?? 0) === 0 && stream.total_seconds > 0);

  return (
    <>
      <div>
        <p className="font-bold text-gray-900 text-xl dark:text-dark-headings">Weekly review</p>
        <p className="mt-0.5 text-gray-500 text-sm dark:text-dark-text">
          Sunday am/midday, Monday fallback &middot; Week {review.plan_week}
          {review.completed_at !== null && ` · completed ${formatDay(review.completed_at)}`}
        </p>
        {/* A fact in secondary text and nothing more — no colour, no icon, no count, and nothing to
            click. §16 forbids a streak; it does not forbid a fact. */}
        {review.previous_week_unreviewed && (
          <p className="mt-1 text-[13px] text-gray-400 dark:text-dark-text">{review.previous_week} was not reviewed.</p>
        )}
      </div>

      {banner !== null && <Banner banner={banner} className="" />}

      <Step number={1} title="Execution">
        {/* Rendering 0% would be a false claim about a week in which nothing was ever planned. §16
            rule 2: "no data" and "data: none" are distinct, and this is the former. */}
        <p className="text-gray-500 text-sm dark:text-dark-text">
          No tactics were planned this week &mdash; goals and twelve-week cycles arrive in a later phase, and the scorecard is theirs to
          fill. This section is the space they will occupy, not a score of zero.
        </p>
      </Step>

      <Step number={2} title="Allocation variance">
        {ledger.total_seconds === 0 && <p className="text-gray-500 text-sm dark:text-dark-text">Nothing was tracked this week.</p>}
        {under_floor.map((stream) => (
          <div
            className="flex items-center gap-3 border-gray-200 border-b border-dotted py-1.5 dark:border-dark-border"
            key={stream.project}
          >
            <span className="flex-grow text-gray-900 text-sm dark:text-dark-headings">
              {stream.project} {formatColon(stream.total_seconds)} &mdash; under the {stream.floor_hours}h soft floor
            </span>
            <span className="text-danger text-sm tabular-nums">&minus;{formatColon(stream.deficit_seconds ?? 0)}</span>
          </div>
        ))}
        {under_floor.length > 0 && top_consumer !== undefined && (
          <p className="mt-2 text-[13px] text-gray-600 dark:text-dark-text">
            What consumed it instead: {top_consumer.project} {formatColon(top_consumer.total_seconds)}.
          </p>
        )}
        {under_floor.length === 0 && ledger.total_seconds > 0 && (
          <p className="text-gray-500 text-sm dark:text-dark-text">Every stream with a floor met it.</p>
        )}
        <p className="mt-3 text-[13px] text-gray-600 dark:text-dark-text">
          Surfaced, never enforced. The &ldquo;name the loser&rdquo; moment simply moves from commitment time to here.
        </p>
      </Step>

      <Step number={3} title={`Dispositions required — tasks at !${dispositions.length > 0 ? dispositions[0]?.deferral_count : 3}`}>
        {dispositions.length === 0 && <p className="text-gray-500 text-sm dark:text-dark-text">Nothing owes a decision.</p>}
        {dispositions.map((task: Disposition) => (
          <div className="flex flex-col gap-2 border-gray-200 border-b border-dotted py-2 dark:border-dark-border" key={task.id}>
            <div className="flex items-center gap-3">
              <span className="flex-grow text-gray-900 text-sm dark:text-dark-headings">{task.title}</span>
              <span className="rounded-sm border border-gray-300 px-1.5 text-gray-500 text-xs dark:border-dark-border dark:text-dark-text">
                !{task.deferral_count}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {[
                { label: "Do today", run: () => dispose(task.id, "do_today") },
                { label: "Schedule with a reason", run: () => setSchedulingId(task.id) },
                { label: "Someday", run: () => dispose(task.id, "someday") },
                { label: "Cancel to logbook", run: () => dispose(task.id, "cancel") },
              ].map((exit) => (
                <button
                  className="rounded border border-gray-300 px-2.5 py-1 text-gray-900 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info disabled:cursor-not-allowed disabled:opacity-50 dark:border-dark-border dark:text-dark-headings"
                  disabled={busy_key !== null}
                  key={exit.label}
                  onClick={() => exit.run()}
                  type="button"
                >
                  {exit.label}
                </button>
              ))}
            </div>
            {scheduling_id === task.id && (
              <div className="flex flex-wrap items-center gap-2 rounded border border-gray-300 p-2 dark:border-dark-border">
                <input
                  className="rounded border border-gray-300 bg-bg px-2 py-1 text-gray-900 text-xs dark:border-dark-border dark:bg-dark-bg dark:text-dark-headings"
                  onChange={(event) => setScheduleDate(event.target.value)}
                  type="date"
                  value={schedule_date}
                />
                <input
                  className="min-w-0 flex-grow rounded border border-gray-300 bg-bg px-2 py-1 text-gray-900 text-xs placeholder:text-gray-400 dark:border-dark-border dark:bg-dark-bg dark:text-dark-headings"
                  onChange={(event) => setScheduleReason(event.target.value)}
                  placeholder="why this date, and not sooner"
                  value={schedule_reason}
                />
                <button
                  className="rounded bg-accent px-2.5 py-1 font-medium text-white text-xs disabled:cursor-not-allowed disabled:opacity-50 dark:bg-accent-dark dark:text-dark-bg"
                  disabled={busy_key !== null || schedule_date === "" || schedule_reason.trim() === ""}
                  onClick={() => schedule(task.id)}
                  type="button"
                >
                  Schedule
                </button>
              </div>
            )}
          </div>
        ))}
        <p className="mt-3 text-[13px] text-gray-600 dark:text-dark-text">
          Exactly four exits and no fifth. Auto-filing to someday would <em>be</em> the silent escape this prevents &mdash; a nicer folder
          is still a backlog.
        </p>
      </Step>

      <Step number={4} title="Next week's pool">
        <div className="flex items-center gap-3 border-gray-200 border-b border-dotted py-1.5 dark:border-dark-border">
          <span className="flex-grow text-gray-900 text-sm dark:text-dark-headings">{pool_count} tasks carried</span>
          <Link
            className="rounded border border-gray-300 px-2.5 py-1 text-gray-900 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info dark:border-dark-border dark:text-dark-headings"
            to="/admin/os/pool"
          >
            Open pool
          </Link>
        </div>
        <div className="flex items-center gap-3 border-gray-200 border-b border-dotted py-1.5 dark:border-dark-border">
          <span className="flex-grow text-gray-600 text-sm dark:text-dark-text">Someday sweep</span>
          <span className="text-[13px] text-gray-500 dark:text-dark-text">
            {someday.items.length} items &middot;{" "}
            {someday.last_swept_at === null ? "never swept" : `last swept ${formatDay(someday.last_swept_at)}`}
          </span>
          <button
            className="rounded border border-gray-300 px-2.5 py-1 text-gray-900 text-xs disabled:cursor-not-allowed disabled:opacity-50 dark:border-dark-border dark:text-dark-headings"
            disabled={busy_key !== null}
            onClick={() => run("sweep", "Could not record the sweep", async () => void (await orpc.personalReview.sweepSomeday()))}
            type="button"
          >
            Mark swept
          </button>
        </div>
        <div className="flex items-center gap-3 border-gray-200 border-b border-dotted py-1.5 dark:border-dark-border">
          <span className="flex-grow text-gray-600 text-sm dark:text-dark-text">Inbox triage</span>
          <span className="text-[13px] text-gray-500 dark:text-dark-text">{inbox_count} captured</span>
          <Link
            className="rounded border border-gray-300 px-2.5 py-1 text-gray-900 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info dark:border-dark-border dark:text-dark-headings"
            to="/admin/os"
          >
            Open Today
          </Link>
        </div>

        <div className="mt-3 flex flex-col gap-2">
          <textarea
            className="rounded border border-gray-300 bg-bg p-2 text-gray-900 text-sm placeholder:text-gray-400 dark:border-dark-border dark:bg-dark-bg dark:text-dark-headings"
            onChange={(event) => setNote(event.target.value)}
            placeholder="the sentence about why this week went the way it did, if there is one"
            rows={2}
            value={note}
          />
          <button
            className={clsx(
              "self-start rounded px-3 py-1.5 font-medium text-sm disabled:cursor-not-allowed disabled:opacity-50",
              review.completed_at === null
                ? "bg-accent text-white dark:bg-accent-dark dark:text-dark-bg"
                : "border border-gray-300 text-gray-600 dark:border-dark-border dark:text-dark-text",
            )}
            disabled={busy_key !== null}
            onClick={() =>
              run("complete", "Could not complete the review", async () => void (await orpc.personalReview.complete({ note })))
            }
            type="button"
          >
            {review.completed_at === null ? "Complete the review" : "Update the note"}
          </button>
        </div>

        <p className="mt-3 text-[13px] text-gray-600 dark:text-dark-text">
          Skipping the review is the single main way twelve-week cycles fail, which is why it gets a fallback day rather than a stricter
          reminder. Week {week.from} to {week.to}.
        </p>
      </Step>
    </>
  );
}
