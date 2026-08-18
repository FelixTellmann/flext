import { createFileRoute, notFound } from "@tanstack/react-router";
import { findTrip } from "content/travel";
import { TripView } from "~/components/travel/trip-view";

export const Route = createFileRoute("/travel/$slug")({
  loader: ({ params }) => {
    const trip = findTrip(params.slug);
    if (!trip) throw notFound();
    return { trip };
  },
  head: ({ loaderData }) => ({
    meta: loaderData
      ? [{ title: `${loaderData.trip.title} — Felix Tellmann` }, { name: "description", content: loaderData.trip.intro }]
      : [],
  }),
  component: TripPage,
});

function TripPage() {
  const { trip } = Route.useLoaderData();

  return (
    <section className="relative mx-auto max-w-6xl px-4 py-16 md:px-8">
      <header className="pb-12">
        <div className="heading-pre">{trip.pre}</div>
        <h1 className="heading-2xl -ml-1">{trip.title}</h1>
        <p className="mt-6 max-w-2xl d:text-gray-400 text-gray-600">{trip.intro}</p>
      </header>

      <TripView trip={trip} />
    </section>
  );
}
