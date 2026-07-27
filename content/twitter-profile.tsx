export type TwitterProfileData = {
  name: string;
  username: string;
  description: string;
  profile_image_url: string;
  public_metrics: {
    followers_count: number;
    following_count: number;
  };
};

// Snapshot of the values the old site was serving, taken 2026-07-26. The card used to be fed by the
// X API, but user lookup now needs a paid plan, so it is static content rather than a live fetch.
// The avatar is vendored into public/ so the card does not depend on X's CDN either.
export const TWITTER_PROFILE: TwitterProfileData = {
  name: "Felix Tellmann",
  username: "FelixTellmann",
  description:
    "Hey, I'm new to twitter and not really a social media person 🙃 I'm looking to connect with fellow developers and to learn about the latest in web dev 🤗",
  profile_image_url: "/images/twitter-avatar.jpg",
  public_metrics: {
    followers_count: 50,
    following_count: 218,
  },
};
