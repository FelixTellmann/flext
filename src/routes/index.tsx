import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { Client } from "twitter-api-sdk";
import { About } from "~/components/sections/about";
import { Hero } from "~/components/sections/hero";
import { PortfolioPreview } from "~/components/sections/portfolio-preview";
import { Timeline } from "~/components/sections/timeline";

// Stands in for the old site's `revalidate: 300`. Without it the loader calls the X API on every
// single request, which burns the rate limit and adds a network round-trip to every server render.
// Failures are cached too, so a dead token costs one call per window rather than one per visitor.
const TWITTER_CACHE_TTL_MS = 5 * 60 * 1000;

type TwitterUser = Awaited<ReturnType<Client["users"]["findUserByUsername"]>>["data"] | null;

let twitter_cache: { data: TwitterUser; fetched_at: number } | null = null;

const fetchTwitterData = createServerFn({ method: "GET" }).handler(async () => {
  if (twitter_cache && Date.now() - twitter_cache.fetched_at < TWITTER_CACHE_TTL_MS) {
    return twitter_cache.data;
  }

  try {
    const client = new Client(process.env.TWITTER_CLIENT_BEARER_TOKEN!);
    const twitterData = await client.users.findUserByUsername("FelixTellmann", {
      "user.fields": [
        "created_at",
        "description",
        "entities",
        "id",
        "location",
        "name",
        "pinned_tweet_id",
        "profile_image_url",
        "protected",
        "public_metrics",
        "url",
        "username",
        "verified",
        "withheld",
      ],
    });
    twitter_cache = { data: twitterData.data ?? null, fetched_at: Date.now() };
    return twitter_cache.data;
  } catch (error) {
    console.error("Failed to fetch Twitter data:", error);
    twitter_cache = { data: null, fetched_at: Date.now() };
    return null;
  }
});

export const Route = createFileRoute("/")({
  loader: async () => {
    const twitterData = await fetchTwitterData();
    return { twitterData };
  },
  component: IndexPage,
});

function IndexPage() {
  const { twitterData } = Route.useLoaderData();
  return (
    <>
      <Hero twitterData={twitterData} />
      <About />
      <Timeline />
      <PortfolioPreview />
    </>
  );
}
