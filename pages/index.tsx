import { Link } from "_client/link";
import { CodeEditor } from "components/code-editor";
import { HeroIcon } from "components/dynamic-hero-icon";
import { ReactIcon } from "components/dynamic-react-icon";
import ToggleSwitch from "components/toggle-switch";
import { TwitterProfile } from "components/twitter-profile";
import { CODE } from "content/code";
import { GetStaticProps } from "next";
import { useTheme } from "next-themes";
import party from "party-js";
import { FC } from "react";
import { Client } from "twitter-api-sdk";
import { findUserByUsername, TwitterResponse } from "twitter-api-sdk/dist/types";

type IndexProps = {
  twitterData: TwitterResponse<findUserByUsername>["data"];
};

party.settings.respectReducedMotion = false;

export const Index: FC<IndexProps> = (props) => {
  const { theme, setTheme } = useTheme();

  console.log(props.twitterData);
  return (
    <>
      <section className="hero relative min-h-screen overflow-hidden">
        <div className="mx-auto max-w-6xl grid-cols-3 gap-8 px-4 py-16 md:py-32 md:px-8 lg:grid">
          <section className="col-span-2">
            <header>
              <div className="heading-pre">Welcome to my site.</div>
              <h1 className="heading-hero ">
                I'm <strong>Felix Tellmann</strong>, a Fullstack developer.
              </h1>
              {/* <h2 className="heading-hero ">
                <Typewriter
                  loop={false}
                  items={[
                    <>
                      I'm a <u>Fullstack</u> developer
                    </>,

                    <>I build websites & web apps</>,
                  ]}
                />
              </h2>*/}
              <ul className="scrollbar-none -mx-4 mb-4 flex items-center gap-6 overflow-x-auto px-4 text-[15px] font-medium">
                <li className="flex items-center gap-2 text-gray-500">
                  <ReactIcon name="SiReact" className="h-7 w-7 text-gray-400" />
                  React.js
                </li>
                <li className="flex items-center gap-2 text-gray-500">
                  <ReactIcon name="SiNodedotjs" className="h-7 w-7  text-gray-400" />
                  Node.js
                </li>
                <li className="flex items-center gap-2 text-gray-500">
                  <ReactIcon name="SiTailwindcss" className="h-7 w-7  text-gray-400" />
                  Tailwind
                </li>
                <li className="flex items-center gap-2 text-gray-500">
                  <ReactIcon name="SiShopify" className="h-7 w-7  text-gray-400" />
                  Shopify
                </li>
              </ul>
            </header>
            <main>
              <p className="mb-3 max-w-prose font-normal text-gray-500 md:text-lg md:tracking-tight">
                I love writing code that takes things next level creating highly performant
                websites, automated API integrations, building my own dev-tools, and creating
                stunning user-experiences that makes you feel{" "}
                <em
                  className="cursor-pointer"
                  onClick={(e) => {
                    party.confetti(e.currentTarget, { count: 40 });
                  }}
                >
                  WOW!
                </em>
                .
              </p>

              <p className="mb-3 max-w-xl font-normal text-gray-500 md:text-lg md:tracking-tight">
                I am always keen to learn and explore new technologies, frameworks and programming
                languages. Currently, I'm learning{" "}
                <Link
                  target="_blank"
                  href="https://astro.build/"
                  className="underline hfa:text-sky-500"
                >
                  Astro
                </Link>
                .
              </p>
            </main>
            <footer className="mt-6 flex flex-wrap gap-4 md:gap-8">
              <Link
                href="/contact"
                className="button-rainbow inline-flex whitespace-nowrap bg-gray-800 px-10 py-2.5 text-sm font-medium tracking-tight text-gray-50 hfa:border-gray-300/90 hfa:bg-gray-900 hfa:text-white md:px-12"
              >
                Lets work
              </Link>

              <Link
                href="/resume"
                className="button-border inline-flex whitespace-nowrap bg-white/90 px-10 py-2.5 text-sm font-medium tracking-tight text-gray-500 hfa:border-gray-900/70 hfa:bg-white/90 hfa:text-gray-900 md:px-12"
              >
                See Resume
              </Link>
            </footer>
          </section>
          <section className="relative h-[460px]">
            <div className="absolute left-4 top-16 flex h-full min-w-[460px] sm:left-8 sm:min-w-[660px] lg:left-6 lg:top-24 lg:min-w-[460px]">
              <CodeEditor code={CODE.hero} language="tsx" />
            </div>
            <div className="absolute top-10 right-2 flex items-end gap-2">
              <div className="inline-flex cursor-pointer select-none items-center whitespace-nowrap rounded-md bg-cyan-100 px-3 py-1 text-[13px] font-medium text-cyan-900 transition-all hfa:bg-cyan-200/90">
                Hiker
              </div>
              <div className="inline-flex cursor-pointer select-none items-center whitespace-nowrap rounded-md bg-green-100 px-3 py-1 text-[13px] font-medium text-green-900 transition-all hfa:bg-green-200/90">
                Chef
              </div>
              <div className="inline-flex cursor-pointer select-none items-center whitespace-nowrap rounded-md bg-orange-100 px-3 py-1 text-[13px] font-medium text-orange-900 transition-all hfa:bg-orange-200/90">
                Trail Running
              </div>
              <div className="inline-flex cursor-pointer select-none items-center whitespace-nowrap rounded-md bg-pink-100 px-3 py-1 text-[13px] font-medium text-pink-900 transition-all hfa:bg-pink-200/90">
                Mixologist
              </div>
              <ToggleSwitch
                enabled={theme === "dark"}
                setEnabled={(bool) => setTheme(bool ? "dark" : "light")}
                enabledIcon={<HeroIcon name="MoonIcon" className="h-3 w-3 text-slate-400" />}
                disabledIcon={<HeroIcon name="SunIcon" className="h-4 w-4 text-orange-400" />}
              />
            </div>
            <div className="absolute top-full -left-64 z-20">
              <TwitterProfile {...props.twitterData} />
            </div>
          </section>
        </div>
        <div className="background pointer-events-none absolute inset-0 z-0 select-none"></div>
      </section>
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
  if (twitterData.data) {
    return {
      props: { twitterData: twitterData.data as TwitterResponse<findUserByUsername> }, // will be passed to the page component as props
    };
  }
  return {
    props: { twitterData: null }, // will be passed to the page component as props
  };
};
export default Index;
