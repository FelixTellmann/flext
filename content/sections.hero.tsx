import { Link } from "_client/link";
import party from "party-js";

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
        className="cursor-pointer"
        onClick={(e) => {
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
};
