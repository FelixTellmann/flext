import { createFileRoute } from "@tanstack/react-router";
import { Client } from "twitter-api-sdk";
import { TWEETS } from "content/tweets";

async function handle({ request }: { request: Request }) {
  const client = new Client(process.env.TWITTER_CLIENT_BEARER_TOKEN!);
  const twitterData = await client.tweets.findTweetsById({
    ids: TWEETS,
    expansions: ["author_id"],
    "user.fields": ["description", "name"],
    "tweet.fields": ["created_at", "in_reply_to_user_id", "text", "withheld"],
  });
  return new Response(JSON.stringify(twitterData, null, 4), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

export const Route = createFileRoute("/api/tweets")({
  server: { handlers: { GET: handle } },
});
