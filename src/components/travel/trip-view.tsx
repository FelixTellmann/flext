import { ClientOnly } from "@tanstack/react-router";
import clsx from "clsx";
import type { TravelStop, TravelTrip } from "content/travel";
import { type FC, useMemo, useState } from "react";
import { TripMap } from "~/components/travel/trip-map";

const HOUR = 3_600_000;

/** Stop times are wall-clock; reading them as UTC keeps the timeline identical in every timezone. */
export const asTime = (value: string) => new Date(`${value}Z`).getTime();

// Formatted by hand rather than via Intl: Node and the browser ship different ICU data ("Sep" vs
// "Sept"), and that disagreement fails hydration on a server-rendered date.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export const formatDate = (value: number) => {
  const date = new Date(value);
  return `${WEEKDAYS[date.getUTCDay()]}, ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
};

export const formatDay = (value: number) => {
  const date = new Date(value);
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
};

const KIND_DOT: Record<TravelStop["kind"], string> = {
  city: "bg-sky-400",
  park: "bg-green-500",
  friends: "bg-pink-500",
};

function locate(trip: TravelTrip, hours: number) {
  const now = asTime(trip.startsAt) + hours * HOUR;
  for (const stop of trip.stops) {
    if (now >= asTime(stop.arriveAt) && now < asTime(stop.departAt)) return { stop, inTransit: false };
    if (now < asTime(stop.arriveAt)) return { stop, inTransit: true };
  }
  return { stop: trip.stops[trip.stops.length - 1], inTransit: false };
}

export const TripView: FC<{ trip: TravelTrip }> = ({ trip }) => {
  const [hours, setHours] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const trip_start = asTime(trip.startsAt);
  const total_hours = Math.round((asTime(trip.endsAt) - trip_start) / HOUR);

  const { stop: scrubbed, inTransit } = useMemo(() => locate(trip, hours), [trip, hours]);
  const active = useMemo(() => trip.stops.find((stop) => stop.id === selectedId) ?? scrubbed, [trip, selectedId, scrubbed]);

  const focus = (stop: TravelStop) => {
    setSelectedId(stop.id);
    setHours(Math.max(0, Math.min(total_hours, Math.round((asTime(stop.arriveAt) - trip_start) / HOUR))));
  };

  return (
    <>
      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div>
          <div className="overflow-hidden rounded-md border border-gray-200 d:border-dark-border">
            <ClientOnly fallback={<div className="h-[420px] w-full bg-card d:bg-card-dark md:h-[560px]" />}>
              <TripMap stops={trip.stops} activeId={active.id} onSelect={setSelectedId} />
            </ClientOnly>
          </div>

          <div className="mt-4 rounded-md border border-gray-200 d:border-dark-border bg-card d:bg-card-dark p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="font-mono d:text-white text-gray-900">{formatDate(trip_start + hours * HOUR)}</div>
                <div className="text-accent text-sm">
                  {inTransit ? `In transit to ${scrubbed.name}` : scrubbed.name}
                  {!inTransit && scrubbed.lodging ? ` — ${scrubbed.lodging.name}` : ""}
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelectedId(null);
                  setHours(0);
                }}
                className="rounded-md bg-gray-900/5 d:bg-white/10 hfa:bg-gray-900/10 px-3 py-1.5 font-medium d:text-gray-200 text-gray-700 text-sm"
              >
                Reset
              </button>
            </div>
            <input
              type="range"
              min={0}
              max={total_hours}
              step={1}
              value={hours}
              aria-label="Trip timeline"
              onChange={(event) => {
                setSelectedId(null);
                setHours(Number(event.target.value));
              }}
              className="mt-4 w-full accent-sky-500"
            />
            <div className="mt-2 flex justify-between font-mono d:text-gray-500 text-[11px] text-gray-500">
              <span>{formatDay(trip_start)}</span>
              <span>{formatDay(asTime(trip.endsAt))}</span>
            </div>
          </div>
        </div>

        <aside className="rounded-md border border-gray-200 d:border-dark-border bg-card d:bg-card-dark p-5 lg:sticky lg:top-24 lg:self-start">
          <div className="heading-pre">{active.kind === "park" ? "National park" : "Stop"}</div>
          <h2 className="heading-sm">{active.name}</h2>
          <p className="d:text-gray-400 text-gray-600 text-sm">{active.region}</p>
          <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 border-gray-200 d:border-dark-border border-t pt-4 text-sm">
            <dt className="d:text-gray-500 text-gray-500 text-xs uppercase tracking-wide">Arrive</dt>
            <dd className="d:text-gray-200 text-gray-800">{formatDate(asTime(active.arriveAt))}</dd>
            <dt className="d:text-gray-500 text-gray-500 text-xs uppercase tracking-wide">Leave</dt>
            <dd className="d:text-gray-200 text-gray-800">{formatDate(asTime(active.departAt))}</dd>
            {active.lodging ? (
              <>
                <dt className="d:text-gray-500 text-gray-500 text-xs uppercase tracking-wide">Lodging</dt>
                <dd className="d:text-gray-200 text-gray-800">{active.lodging.name}</dd>
              </>
            ) : null}
          </dl>
          {active.note ? <p className="mt-4 d:text-gray-400 text-gray-600 text-sm">{active.note}</p> : null}
        </aside>
      </div>

      <h2 className="heading-sm mt-16 mb-4">Day by day</h2>
      <div className="flex flex-col gap-2">
        {trip.stops.map((stop) => (
          <button
            key={stop.id}
            type="button"
            onClick={() => focus(stop)}
            className={clsx(
              "grid w-full grid-cols-1 gap-1 rounded-md border p-4 text-left sm:grid-cols-[7rem_1fr] sm:gap-4",
              "border-gray-200 d:border-dark-border hfa:border-accent bg-card d:bg-card-dark",
              stop.id === active.id && "border-accent",
            )}
          >
            <span className="font-mono text-accent text-sm">{formatDay(asTime(stop.arriveAt))}</span>
            <span>
              <span className={clsx("mr-2 inline-block h-2 w-2 rounded-full align-middle", KIND_DOT[stop.kind])} />
              <span className="font-semibold d:text-gray-100 text-gray-900">{stop.name}</span>
              <span className="d:text-gray-400 text-gray-600 text-sm"> — {stop.region}</span>
            </span>
          </button>
        ))}
      </div>

      {trip.openQuestions.length ? (
        <>
          <h2 className="heading-sm mt-16 mb-4">Still to confirm</h2>
          <div className="flex flex-col gap-2">
            {trip.openQuestions.map((item) => (
              <div key={item.question} className="rounded-md border border-warning/40 bg-warning/5 p-4">
                <p className="font-semibold d:text-gray-100 text-gray-900">{item.question}</p>
                <p className="mt-1 d:text-gray-400 text-gray-600 text-sm">{item.detail}</p>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </>
  );
};
