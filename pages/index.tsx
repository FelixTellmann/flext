import { About } from "components/sections/about";
import { Hero } from "components/sections/hero";
import { PortfolioPreview } from "components/sections/portfolio-preview";
import { Timeline } from "components/sections/timeline";
import { GetStaticProps } from "next";
import party from "party-js";
import { FC } from "react";
import { Client } from "twitter-api-sdk";
import { components } from "twitter-api-sdk/dist/gen/openapi-types";

type IndexProps = {
  twitterData: components["schemas"]["User"];
};

party.settings.respectReducedMotion = false;

export const Index: FC<IndexProps> = (props) => {
  return (
    <>
      <Hero twitterData={props.twitterData} />
      <About />
      <Timeline />
      <PortfolioPreview />
    </>
  );
};

export const getStaticProps: GetStaticProps = async (context) => {
  const client = new Client(process.env.TWITTER_CLIENT_BEARER_TOKEN as string);
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
    "tweet.fields": [
      "attachments",
      "author_id",
      "context_annotations",
      "conversation_id",
      "created_at",
      "entities",
      "geo",
      "id",
      "in_reply_to_user_id",
      "lang",
      "non_public_metrics",
      "organic_metrics",
      "possibly_sensitive",
      "promoted_metrics",
      "public_metrics",
      "referenced_tweets",
      "reply_settings",
      "source",
      "text",
      "withheld",
    ],
  });

  return {
    props: { twitterData: twitterData.data as components["schemas"]["User"] }, // will be passed to the page component as props
    revalidate: 300,
  };
};
export default Index;
