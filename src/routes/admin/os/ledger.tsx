import { operatorWeekRange } from "@server/operator-day";
import { createFileRoute, Link } from "@tanstack/react-router";
import clsx from "clsx";
import type { FC } from "react";
import { z } from "zod";
import { orpc } from "~/integrations/orpc";
import { formatColon, formatLong, formatShort, formatWeekday } from "./-format";
import { paletteClassOf } from "./-palette";
import { OsPanel } from "./-task-row";

type LedgerRange = Awaited<ReturnType<typeof orpc.personalLedger.listRange>>;
type LedgerStream = LedgerRange["streams"][number];
type Series = Pick<LedgerStream, "label" | "mapped" | "palette_slot">;

// One scale for the whole screen, gridlines included. An earlier draft drew bars at 30px/h against
// gridlines at 25 and 20, which made the axis decorative — a column could look taller than a column that
// held more hours.
const PX_PER_HOUR = 25;
const GRIDLINE_HOURS = 4;
const MIN_CHART_HOURS = 8;
const SEGMENT_GAP_PX = 2;

// Colour comes from the project's palette slot, so a stream without one — a fifth project, a Wakapi name
// nobody has assigned — draws in the Other grey rather than a generated hue nobody checked, while keeping
// its own row and label beneath. The `unknown` bucket is heartbeats that named no project at all.
const labelOf = (stream: Series): string => (!stream.mapped && stream.label === "unknown" ? "Unattributed" : stream.label);

const ledger_search_schema = z.object({ from: z.string().optional(), to: z.string().optional() });

export const Route = createFileRoute("/admin/os/ledger")({
  validateSearch: ledger_search_schema,
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const week = operatorWeekRange();
    const range = { from: deps.from ?? week.from, to: deps.to ?? week.to };
    const [ledger, overlap] = await Promise.all([orpc.personalLedger.listRange(range), orpc.personalLedger.listOverlap(range)]);

    return { ledger, overlap, range };
  },
  component: PersonalOsLedgerPage,
});

const dayTotals = (ledger: LedgerRange): number[] =>
  ledger.dates.map((_, index) => ledger.streams.reduce((sum, stream) => sum + (stream.per_day[index] ?? 0), 0));

// A day with nothing recorded is a dash, never a zero-height bar. Absent and zero are different claims and
// only one of them is true — a zero bar asserts the day was measured and empty.
const DayColumn: FC<{ chart_px: number; index: number; streams: LedgerStream[]; total: number }> = ({
  chart_px,
  index,
  streams,
  total,
}) => {
  const segments = streams.map((stream) => ({ stream, seconds: stream.per_day[index] ?? 0 })).filter((segment) => segment.seconds > 0);

  if (total === 0) {
    return (
      <div className="flex min-w-0 flex-1 flex-col justify-end">
        <p className="mb-1 text-center text-gray-400 text-xs dark:text-dark-text">&mdash;</p>
      </div>
    );
  }

  // Height is hours × PX_PER_HOUR with the gaps taken out of the segments, so the column measures the same
  // against the gridlines whether it holds one stream or four.
  const column_px = (total / 3600) * PX_PER_HOUR;
  const usable_px = Math.max(0, column_px - SEGMENT_GAP_PX * (segments.length - 1));

  return (
    <div className="flex min-w-0 flex-1 flex-col justify-end" style={{ height: chart_px }}>
      <p className="mb-1 text-center font-semibold text-gray-900 text-xs dark:text-dark-headings">{formatShort(total)}</p>
      <div className="flex flex-col gap-[2px]">
        {segments.map((segment, segment_index) => (
          <div
            className={clsx(paletteClassOf(segment.stream.palette_slot), segment_index === 0 && "rounded-t")}
            key={segment.stream.key}
            style={{ height: (segment.seconds / total) * usable_px }}
            title={`${labelOf(segment.stream)} — ${formatLong(segment.seconds)}`}
          />
        ))}
      </div>
    </div>
  );
};

function PersonalOsLedgerPage() {
  const { ledger, overlap, range } = Route.useLoaderData();

  const totals = dayTotals(ledger);
  const chart_hours = Math.max(MIN_CHART_HOURS, Math.ceil(Math.max(0, ...totals) / 3600));
  const chart_px = chart_hours * PX_PER_HOUR;
  const gridlines = Array.from({ length: Math.floor(chart_hours / GRIDLINE_HOURS) }, (_, index) => (index + 1) * GRIDLINE_HOURS);
  const under_floor = ledger.streams.filter((stream) => stream.deficit_seconds !== null && stream.deficit_seconds > 0);

  return (
    <>
      <div>
        <div className="flex items-baseline gap-2.5">
          <p className="font-bold text-gray-900 text-xl dark:text-dark-headings">Where the week went</p>
          <p className="text-gray-500 text-sm dark:text-dark-text">
            {range.from} &ndash; {range.to} &middot; {formatLong(ledger.total_seconds)} tracked
          </p>
        </div>
      </div>

      <OsPanel title="The shape of the week, day by day">
        <div className="mb-3.5 flex flex-wrap gap-3">
          {ledger.streams.map((stream) => (
            <span className="flex items-center gap-1.5 text-[13px] text-gray-600 dark:text-dark-text" key={stream.key}>
              <span className={clsx("h-2.5 w-2.5 rounded-sm", paletteClassOf(stream.palette_slot))} />
              {labelOf(stream)}
            </span>
          ))}
        </div>

        <div className="flex gap-3">
          <div className="relative w-8 flex-shrink-0" style={{ height: chart_px + 24 }}>
            {gridlines.map((hour) => (
              <span
                className="absolute right-0 text-[11px] text-gray-400 dark:text-dark-text"
                key={hour}
                style={{ bottom: hour * PX_PER_HOUR + 18 }}
              >
                {hour}h
              </span>
            ))}
          </div>

          <div className="relative flex-grow">
            {gridlines.map((hour) => (
              <span
                className="absolute right-0 left-0 border-gray-200 border-t border-dashed dark:border-dark-border"
                key={hour}
                style={{ bottom: hour * PX_PER_HOUR + 24 }}
              />
            ))}
            <span className="absolute right-0 bottom-6 left-0 border-gray-400 border-t dark:border-dark-text" />

            <div className="flex items-end gap-4" style={{ height: chart_px }}>
              {ledger.dates.map((date, index) => (
                <DayColumn chart_px={chart_px} index={index} key={date} streams={ledger.streams} total={totals[index] ?? 0} />
              ))}
            </div>

            <div className="mt-2 flex gap-4">
              {ledger.dates.map((date, index) => (
                <p
                  className={clsx("min-w-0 flex-1 text-center text-[13px]", (totals[index] ?? 0) === 0 ? "text-gray-400" : "text-gray-600")}
                  key={date}
                >
                  {formatWeekday(date)}
                </p>
              ))}
            </div>
          </div>
        </div>

        <p className="mt-3 border-gray-200 border-t pt-3 text-[13px] text-gray-600 dark:border-dark-border dark:text-dark-text">
          Column height is hours &times; {PX_PER_HOUR}px, gaps included, and the gridlines use the same scale.
          {under_floor.length > 0 &&
            ` ${under_floor.map((stream) => `${labelOf(stream)} ${formatColon(stream.total_seconds)} of a ${stream.floor_hours}h floor`).join("; ")}.`}
        </p>
      </OsPanel>

      <OsPanel title="Exact numbers, every cell">
        <div className="overflow-x-auto">
          <table className="w-full text-sm tabular-nums">
            <thead>
              <tr className="border-gray-200 border-b text-gray-500 dark:border-dark-border dark:text-dark-text">
                <th className="py-1.5 text-left font-medium">Stream</th>
                {ledger.dates.map((date) => (
                  <th className="py-1.5 text-right font-medium" key={date}>
                    {formatWeekday(date)}
                  </th>
                ))}
                <th className="py-1.5 text-right font-medium">Total</th>
                <th className="py-1.5 text-right font-medium">Floor</th>
              </tr>
            </thead>
            <tbody>
              {ledger.streams.map((stream) => (
                <tr className="border-gray-200 border-b border-dotted dark:border-dark-border" key={stream.key}>
                  <td className="flex items-center gap-2 py-1.5 text-gray-900 dark:text-dark-headings">
                    <span className={clsx("h-2.5 w-2.5 flex-shrink-0 rounded-sm", paletteClassOf(stream.palette_slot))} />
                    {labelOf(stream)}
                  </td>
                  {stream.per_day.map((seconds, index) => (
                    <td
                      className={clsx("py-1.5 text-right", seconds === null ? "text-gray-400" : "text-gray-600 dark:text-dark-text")}
                      key={ledger.dates[index]}
                    >
                      {seconds === null ? "—" : formatColon(seconds)}
                    </td>
                  ))}
                  <td className="py-1.5 text-right text-gray-900 dark:text-dark-headings">{formatColon(stream.total_seconds)}</td>
                  <td className={clsx("py-1.5 text-right", (stream.deficit_seconds ?? 0) > 0 ? "text-danger" : "text-gray-400")}>
                    {stream.deficit_seconds === null
                      ? "—"
                      : stream.deficit_seconds === 0
                        ? "met"
                        : `−${formatColon(stream.deficit_seconds)}`}
                  </td>
                </tr>
              ))}
              {ledger.streams.length === 0 && (
                <tr>
                  <td className="py-3 text-gray-500 text-sm dark:text-dark-text" colSpan={ledger.dates.length + 3}>
                    Nothing recorded for this range.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[13px] text-gray-600 dark:text-dark-text">
          A floor is surfaced, never enforced. Missing one is shown beside what consumed the hours instead, because the useful question is
          what the time went to, not whether a number was hit.
        </p>
        <p className="mt-1.5 text-[13px] text-gray-600 dark:text-dark-text">
          {ledger.unmapped_count === 0 && "Every Wakapi name in this range is mapped to a project."}
          {ledger.unmapped_count > 0 && (
            <>
              {ledger.unmapped_count} Wakapi {ledger.unmapped_count === 1 ? "name" : "names"} unmapped &mdash;{" "}
              <Link
                className="underline hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info dark:hover:text-dark-headings"
                to="/admin/os/areas"
              >
                assign them on Areas
              </Link>
              .
            </>
          )}
        </p>
      </OsPanel>

      <OsPanel title={`The US overlap window — ${overlap.window.start_hour}:00 to ${overlap.window.end_hour}:00`}>
        <ul className="flex flex-col gap-1.5">
          {overlap.streams.length === 0 && (
            <li className="text-gray-500 text-sm dark:text-dark-text">No tracked work fell in the window.</li>
          )}
          {overlap.streams.map((stream) => (
            <li className="flex items-center gap-3 border-gray-200 border-b border-dotted py-1 dark:border-dark-border" key={stream.key}>
              <span className={clsx("h-2.5 w-2.5 flex-shrink-0 rounded-sm", paletteClassOf(stream.palette_slot))} />
              <span className="flex-grow text-gray-900 text-sm dark:text-dark-headings">{labelOf(stream)}</span>
              <span className="text-gray-600 text-sm tabular-nums dark:text-dark-text">{formatColon(stream.seconds)}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[13px] text-gray-600 dark:text-dark-text">
          Counted as a second resource, not a slice of the first. Hour-fairness is not slot-fairness here: the US streams can only consume
          this window, so hours given to them inside it cost the local streams nothing — while local work taking the best morning hours does
          cost the US ones.
        </p>
      </OsPanel>
    </>
  );
}
