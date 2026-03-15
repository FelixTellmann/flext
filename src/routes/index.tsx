import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { About } from "~/components/sections/about";
import { Hero } from "~/components/sections/hero";
import { PortfolioPreview } from "~/components/sections/portfolio-preview";
import { Timeline } from "~/components/sections/timeline";
import { Client } from "twitter-api-sdk";

const fetchTwitterData = createServerFn({ method: "GET" }).handler(async () => {
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
  return twitterData.data;
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
