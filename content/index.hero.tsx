import { Link } from "_client/link";
import party from "party-js";

// @ts-ignore
import heroCode from "!!raw-loader!content/code-blocks/hero.tsx"; // Adding `!!` to a request will disable all loaders specified in the configuration

export const HERO = {
  pre: "Welcome to my site.",
  heading: (
    <>
      I'm <strong>Felix Tellmann</strong>, a Fullstack developer.
    </>
  ),
  tech: [
    {
      name: "React.js",
      icon: "SiReact",
    },
    {
      name: "Node.js",
      icon: "SiNodedotjs",
    },
    {
      name: "Tailwind",
      icon: "SiTailwindcss",
    },
    {
      name: "Shopify",
      icon: "SiShopify",
    },
  ] as const,
  body: (
    <>
      I love writing code that takes things next level creating highly performant websites,
      automated API integrations, building my own dev-tools, and creating stunning user-experiences
      that makes you feel{" "}
      <em
        className="relative cursor-pointer before:absolute b:bottom-0 b:-z-10 b:h-3 b:w-full b:-rotate-2 b:animate-hint-hint b:bg-pink-400/70 b:blur-sm d:b:bg-pink-600"
        onClick={(e) => {
          e.currentTarget.classList.remove("before:absolute");
          party.confetti(e.currentTarget, { count: 40 });
        }}
      >
        WOW!
      </em>
      .<span className="mt-4 block" />I am always keen to learn and explore new technologies,
      frameworks and programming languages. Currently, I'm learning{" "}
      <Link target="_blank" href="https://astro.build/" className="underline hfa:text-sky-500">
        Astro
      </Link>
      .
    </>
  ),
  cta1: {
    href: "/contact",
    name: "Let's Work",
  },
  cta2: {
    href: "/resume",
    name: "Resume",
  },
  code: `${heroCode}`,
};
