import { TWEETS } from "content/tweets";
import type { NextApiRequest, NextApiResponse } from "next";
import { Client } from "twitter-api-sdk";

type TweetsFunction = (req: NextApiRequest, res: NextApiResponse) => Promise<void>;

export const Tweets: TweetsFunction = async (req, res) => {
  const client = new Client(process.env.TWITTER_CLIENT_BEARER_TOKEN as string);
  const twitterData = await client.tweets.findTweetsById({
    //A comma separated list of fields to expand
    ids: TWEETS,
    expansions: ["author_id"],
    //A comma separated list of Media fields to display
    "user.fields": ["description", "name"],
    "tweet.fields": ["created_at", "in_reply_to_user_id", "text", "withheld"],
  });
  res.status(200).send(JSON.stringify(twitterData, null, 4));
};

export default Tweets;
