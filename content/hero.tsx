// @ts-ignore
import heroCode from "!!raw-loader!content/code-blocks/hero.tsx"; // Adding `!!` to a request will disable all loaders specified in the configuration
import { SiNodeDotJs } from "@react-icons/all-files/si/SiNodeDotJs";
import { SiReact } from "@react-icons/all-files/si/SiReact";
import { SiShopify } from "@react-icons/all-files/si/SiShopify";
import { SiTailwindcss } from "@react-icons/all-files/si/SiTailwindcss";
import { Link } from "components/link";
import { TECH } from "content/tech-stack";
import party from "party-js";

export const HERO = {
  pre: "Welcome to my site.",
  heading: (
    <>
      I'm <strong>Felix Tellmann</strong>, a Fullstack developer.
    </>
  ),
  tech: [
    TECH.nextjs,
    {
      name: "Node.js",
      Icon: ({ className }) => <SiNodeDotJs className={className} />,
    },
    {
      name: "Tailwind",
      Icon: ({ className }) => <SiTailwindcss className={className} />,
    },
    {
      name: "Shopify",
      Icon: ({ className }) => <SiShopify className={className} />,
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
      frameworks and programming languages. Currently, I'm learning about{" "}
      <Link target="_blank" href="https://astro.build/" className="underline hfa:text-sky-500">
        Astro
      </Link>{" "}
      and{" "}
      <Link href="https://replicache.dev" target="_blank" className="underline hfa:text-sky-500">
        Replicache
      </Link>
      .
    </>
  ),
  cta1: {
    href: "mailto:hello@flext.dev",
    name: "Let's Work",
  },
  cta2: {
    href: "/resume",
    name: "Resume",
  },
  code: `${heroCode}`,
};
