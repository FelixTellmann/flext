import { ClientOnly, Link } from "@tanstack/react-router";
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
    // The map owns the viewport below the fixed site header and the panel is a fixed-width
    // scrolling column beside it. On small screens they stack, map on top.
    <div className="fixed inset-x-0 top-header bottom-0 flex flex-col md:flex-row">
      <aside className="order-2 flex min-h-0 w-full flex-1 flex-col border-gray-200 d:border-dark-border border-t md:order-1 md:w-[400px] md:flex-none md:border-t-0 md:border-r">
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="border-gray-200 d:border-dark-border border-b p-5">
            <Link to="/travel" className="font-mono text-accent text-xs hfa:underline">
              ← All trips
            </Link>
            <div className="heading-pre mt-3">{trip.pre}</div>
            <h1 className="heading-lg">{trip.title}</h1>
          </div>

          <div className="border-gray-200 d:border-dark-border border-b p-5">
            <div className="flex items-baseline justify-between gap-3">
              <div className="font-mono d:text-white text-gray-900 text-sm">{formatDate(trip_start + hours * HOUR)}</div>
              <button
                type="button"
                onClick={() => {
                  setSelectedId(null);
                  setHours(0);
                }}
                className="font-mono d:text-gray-400 hfa:text-accent text-gray-500 text-xs"
              >
                Reset
              </button>
            </div>
            <div className="mt-0.5 text-accent text-sm">
              {inTransit ? `In transit to ${scrubbed.name}` : scrubbed.name}
              {!inTransit && scrubbed.lodging ? ` — ${scrubbed.lodging.name}` : ""}
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
              className="mt-3 w-full accent-sky-500"
            />
            <div className="mt-1 flex justify-between font-mono d:text-gray-500 text-[11px] text-gray-500">
              <span>{formatDay(trip_start)}</span>
              <span>{formatDay(asTime(trip.endsAt))}</span>
            </div>
          </div>

          <div className="border-gray-200 d:border-dark-border border-b p-5">
            <div className="heading-pre">{active.kind === "park" ? "National park" : "Stop"}</div>
            <h2 className="heading-sm">{active.name}</h2>
            <p className="d:text-gray-400 text-gray-600 text-sm">{active.region}</p>
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
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
            {active.note ? <p className="mt-3 d:text-gray-400 text-gray-600 text-sm">{active.note}</p> : null}
          </div>

          <div className="p-5">
            <div className="heading-pre mb-3">Day by day</div>
            <div className="flex flex-col gap-1.5">
              {trip.stops.map((stop) => (
                <button
                  key={stop.id}
                  type="button"
                  onClick={() => focus(stop)}
                  className={clsx(
                    "grid w-full grid-cols-[3.5rem_1fr] items-baseline gap-2 rounded-md border p-2.5 text-left",
                    "border-gray-200 d:border-dark-border hfa:border-accent",
                    stop.id === active.id ? "border-accent bg-sky-50 d:bg-white/5" : "bg-card d:bg-card-dark",
                  )}
                >
                  <span className="font-mono text-accent text-xs">{formatDay(asTime(stop.arriveAt))}</span>
                  <span className="text-sm">
                    <span className={clsx("mr-1.5 inline-block h-2 w-2 rounded-full", KIND_DOT[stop.kind])} />
                    <span className="font-semibold d:text-gray-100 text-gray-900">{stop.name}</span>
                    <span className="d:text-gray-400 text-gray-600"> — {stop.region}</span>
                  </span>
                </button>
              ))}
            </div>

            {trip.openQuestions.length ? (
              <>
                <div className="heading-pre mt-6 mb-3">Still to confirm</div>
                <div className="flex flex-col gap-1.5">
                  {trip.openQuestions.map((item) => (
                    <div key={item.question} className="rounded-md border border-warning/40 bg-warning/5 p-3">
                      <p className="font-semibold d:text-gray-100 text-gray-900 text-sm">{item.question}</p>
                      <p className="mt-1 d:text-gray-400 text-gray-600 text-xs">{item.detail}</p>
                    </div>
                  ))}
                </div>
              </>
            ) : null}
          </div>
        </div>
      </aside>

      <div className="order-1 h-[45vh] min-h-0 md:order-2 md:h-auto md:flex-1">
        <ClientOnly fallback={<div className="h-full w-full bg-card d:bg-card-dark" />}>
          <TripMap stops={trip.stops} activeId={active.id} onSelect={setSelectedId} />
        </ClientOnly>
      </div>
    </div>
  );
};
