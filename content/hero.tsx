// @ts-ignore
import heroCode from "!!raw-loader!content/code-blocks/hero.tsx"; // Adding `!!` to a request will disable all loaders specified in the configuration
import { SiSpring } from "@react-icons/all-files/si/SiSpring";
import { Link } from "components/link";
import { TECH } from "content/tech-stack";
import party from "party-js";

export const HERO = {
  pre: "Welcome to my site.",
  heading: (
    <>
      I'm <strong>Mateus Neres</strong>, a Backend developer.
    </>
  ),
  tech: [
    TECH.java,
    {
      name: "Spring",
      Icon: ({ className }) => <SiSpring className={className} />,
    },
    TECH.redis,
    TECH.jenkins,
    TECH.aws,
  ] as const,
  body: (
    <>
      I'm a passionate programming enthusiast, constantly striving to tackle a wide range of
      challenges using my coding skills. Whether it's automating tasks or integrating with APIs,
      I've been immersed in the world of programming for several years now.
      <span className="mt-4 block" />
      My passion is to explore the endless possibilities that programming offers and discover innovative solutions to problems.{" "}
    </>
  ),
  cta1: {
    href: "mailto:contato@mateusneres.dev",
    name: "Let's Work",
  },
  cta2: {
    href: "/resume",
    name: "Resume",
  },
  code: `${heroCode}`,
};
