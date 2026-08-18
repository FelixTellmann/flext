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

  // TripView is a fixed full-bleed layout below the site header; no page container wraps it.
  return <TripView trip={trip} />;
}
