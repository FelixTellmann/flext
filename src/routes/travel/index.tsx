import { createFileRoute, Link } from "@tanstack/react-router";
import { TRIPS } from "content/travel";
import { asTime, formatDate } from "~/components/travel/trip-view";

export const Route = createFileRoute("/travel/")({
  head: () => ({
    meta: [{ title: "Travel — Felix Tellmann" }, { name: "description", content: "Trips I'm taking, mapped out day by day." }],
  }),
  component: TravelIndexPage,
});

function TravelIndexPage() {
  const trips = [...TRIPS].sort((a, b) => asTime(b.startsAt) - asTime(a.startsAt));

  return (
    <section className="relative mx-auto max-w-6xl px-4 py-16 md:px-8">
      <header className="pb-12">
        <div className="heading-pre">Travel</div>
        <h1 className="heading-2xl -ml-1">Trips, mapped out day by day</h1>
      </header>

      <div className="flex flex-col gap-3">
        {trips.map((trip) => (
          <Link
            key={trip.slug}
            to="/travel/$slug"
            params={{ slug: trip.slug }}
            className="block rounded-md border border-gray-200 d:border-dark-border hfa:border-accent bg-card d:bg-card-dark p-6"
          >
            <div className="heading-pre">{trip.pre}</div>
            <h2 className="heading-sm">{trip.title}</h2>
            <p className="mt-2 max-w-3xl d:text-gray-400 text-gray-600 text-sm">{trip.intro}</p>
            <p className="mt-3 font-mono text-accent text-xs">
              {trip.stops.length} stops · {formatDate(asTime(trip.startsAt))} → {formatDate(asTime(trip.endsAt))}
            </p>
          </Link>
        ))}
      </div>
    </section>
  );
}
