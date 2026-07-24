import { AiOutlineConsoleSql } from "@react-icons/all-files/ai/AiOutlineConsoleSql";
import { FaAws } from "@react-icons/all-files/fa/FaAws";
import { ImUpload } from "@react-icons/all-files/im/ImUpload";
import { IoLogoSass } from "@react-icons/all-files/io5/IoLogoSass";
import { IoLogoVercel } from "@react-icons/all-files/io5/IoLogoVercel";
import { MdDesktopMac } from "@react-icons/all-files/md/MdDesktopMac";
import { SiAdobeillustrator } from "@react-icons/all-files/si/SiAdobeillustrator";
import { SiAdobephotoshop } from "@react-icons/all-files/si/SiAdobephotoshop";
import { SiCss3 } from "@react-icons/all-files/si/SiCss3";
import { SiEslint } from "@react-icons/all-files/si/SiEslint";
import { SiFacebook } from "@react-icons/all-files/si/SiFacebook";
import { SiFigma } from "@react-icons/all-files/si/SiFigma";
import { SiFirebase } from "@react-icons/all-files/si/SiFirebase";
import { SiFramer } from "@react-icons/all-files/si/SiFramer";
import { SiGit } from "@react-icons/all-files/si/SiGit";
import { SiGithub } from "@react-icons/all-files/si/SiGithub";
import { SiGooglechrome } from "@react-icons/all-files/si/SiGooglechrome";
import { SiGraphql } from "@react-icons/all-files/si/SiGraphql";
import { SiHtml5 } from "@react-icons/all-files/si/SiHtml5";
import { SiInstagram } from "@react-icons/all-files/si/SiInstagram";
import { SiIntellijidea } from "@react-icons/all-files/si/SiIntellijidea";
import { SiIonic } from "@react-icons/all-files/si/SiIonic";
import { SiJavascript } from "@react-icons/all-files/si/SiJavascript";
import { SiJest } from "@react-icons/all-files/si/SiJest";
import { SiMarkdown } from "@react-icons/all-files/si/SiMarkdown";
import { SiMicrosoftoffice } from "@react-icons/all-files/si/SiMicrosoftoffice";
import { SiMicrosoftteams } from "@react-icons/all-files/si/SiMicrosoftteams";
import { SiMysql } from "@react-icons/all-files/si/SiMysql";
import { SiNetlify } from "@react-icons/all-files/si/SiNetlify";
import { SiNextDotJs } from "@react-icons/all-files/si/SiNextDotJs";
import { SiNodeDotJs } from "@react-icons/all-files/si/SiNodeDotJs";
import { SiNpm } from "@react-icons/all-files/si/SiNpm";
import { SiPhp } from "@react-icons/all-files/si/SiPhp";
import { SiPostman } from "@react-icons/all-files/si/SiPostman";
import { SiPrettier } from "@react-icons/all-files/si/SiPrettier";
import { SiReact } from "@react-icons/all-files/si/SiReact";
import { SiRedis } from "@react-icons/all-files/si/SiRedis";
import { SiRuby } from "@react-icons/all-files/si/SiRuby";
import { SiShopify } from "@react-icons/all-files/si/SiShopify";
import { SiSketch } from "@react-icons/all-files/si/SiSketch";
import { SiTailwindcss } from "@react-icons/all-files/si/SiTailwindcss";
import { SiTypescript } from "@react-icons/all-files/si/SiTypescript";
import { SiWebpack } from "@react-icons/all-files/si/SiWebpack";
import { SiWordpress } from "@react-icons/all-files/si/SiWordpress";
import { SiYarn } from "@react-icons/all-files/si/SiYarn";

import AwsAmplify from "../src/assets/tech-logos/aws_amplify.svg?react";
import AwsLambda from "../src/assets/tech-logos/aws_lambda.svg?react";
import Axios from "../src/assets/tech-logos/axios.svg?react";
import Emmet from "../src/assets/tech-logos/emmet.svg?react";
import Express from "../src/assets/tech-logos/express.svg?react";
import HeadlessUi from "../src/assets/tech-logos/headlessui.svg?react";
import Jsdom from "../src/assets/tech-logos/jsdom.svg?react";
import Liquid from "../src/assets/tech-logos/liquid.svg?react";
import Mdx from "../src/assets/tech-logos/mdx.svg?react";
import NextJs from "../src/assets/tech-logos/nextjs.svg?react";
import PlanetScale from "../src/assets/tech-logos/planetscale.svg?react";
import Preact from "../src/assets/tech-logos/preact.svg?react";
import Prisma from "../src/assets/tech-logos/prisma.svg?react";
import ReactQuery from "../src/assets/tech-logos/react_query.svg?react";
import Remix from "../src/assets/tech-logos/remix.svg?react";
import Sendgrid from "../src/assets/tech-logos/sendgrid.svg?react";
import Stylelint from "../src/assets/tech-logos/stylelint.svg?react";
import Swc from "../src/assets/tech-logos/swc.svg?react";
import Takealot from "../src/assets/tech-logos/takealot.svg?react";
import Trpc from "../src/assets/tech-logos/trpc.svg?react";
import Turborepo from "../src/assets/tech-logos/turborepo.svg?react";
import Vend from "../src/assets/tech-logos/vend_pos.svg?react";

export type TechIconProps = { className?: string };

export const TECH = {
  shopify: {
    name: "Shopify",
    Icon: ({ className }: TechIconProps) => <SiShopify className={className} />,
  },
  shopify_polaris: {
    name: "Shopify Polaris",
    Icon: ({ className }: TechIconProps) => <SiShopify className={className} />,
  },
  vend: {
    name: "Vend POS",
    Icon: ({ className }: TechIconProps) => <Vend className={className} />,
  },
  typescript: {
    name: "TypeScript",
    Icon: ({ className }: TechIconProps) => <SiTypescript className={className} />,
  },
  vercel: {
    name: "Vercel",
    Icon: ({ className }: TechIconProps) => <IoLogoVercel className={className} />,
  },
  netlify: {
    name: "Netlify",
    Icon: ({ className }: TechIconProps) => <SiNetlify className={className} />,
  },
  sass: {
    name: "Sass",
    Icon: ({ className }: TechIconProps) => <IoLogoSass className={className} />,
  },
  liquid: {
    name: "Liquid",
    Icon: ({ className }: TechIconProps) => <Liquid className={className} />,
  },
  nextjs: {
    name: "Next.js",
    Icon: ({ className }: TechIconProps) => <NextJs className={className} />,
  },
  markdown: {
    name: "Markdown",
    Icon: ({ className }: TechIconProps) => <SiMarkdown className={className} />,
  },
  mdx: {
    name: "Mdx",
    Icon: ({ className }: TechIconProps) => <Mdx className={className} />,
  },
  graphql: {
    name: "GraphQL",
    Icon: ({ className }: TechIconProps) => <SiGraphql className={className} />,
  },
  reactjs: {
    name: "React.js",
    Icon: ({ className }: TechIconProps) => <SiReact className={className} />,
  },
  tailwind: {
    name: "TailwindCSS",
    Icon: ({ className }: TechIconProps) => <SiTailwindcss className={className} />,
  },
  prisma: {
    name: "Prisma",
    Icon: ({ className }: TechIconProps) => <Prisma className={className} />,
  },
  planetscale: {
    name: "PlanetScale",
    Icon: ({ className }: TechIconProps) => <PlanetScale className={className} />,
  },
  trpc: {
    name: "Trpc",
    Icon: ({ className }: TechIconProps) => <Trpc className={className} />,
  },
  aws: {
    name: "AWS",
    Icon: ({ className }: TechIconProps) => <FaAws className={className} />,
  },
  aws_amplify: {
    name: "Aws Amplify",
    Icon: ({ className }: TechIconProps) => <AwsAmplify className={className} />,
  },
  aws_lambda: {
    name: "Aws Lambda",
    Icon: ({ className }: TechIconProps) => <AwsLambda className={className} />,
  },
  axios: {
    name: "Axios",
    Icon: ({ className }: TechIconProps) => <Axios className={className} />,
  },
  chrome: {
    name: "Chrome",
    Icon: ({ className }: TechIconProps) => <SiGooglechrome className={className} />,
  },
  css_3: {
    name: "CSS",
    Icon: ({ className }: TechIconProps) => <SiCss3 className={className} />,
  },
  emmet: {
    name: "Emmet",
    Icon: ({ className }: TechIconProps) => <Emmet className={className} />,
  },
  eslint: {
    name: "Eslint",
    Icon: ({ className }: TechIconProps) => <SiEslint className={className} />,
  },
  facebook: {
    name: "Facebook",
    Icon: ({ className }: TechIconProps) => <SiFacebook className={className} />,
  },
  figma: {
    name: "Figma",
    Icon: ({ className }: TechIconProps) => <SiFigma className={className} />,
  },
  sketch: {
    name: "Sketch",
    Icon: ({ className }: TechIconProps) => <SiSketch className={className} />,
  },
  firebase: {
    name: "Firebase",
    Icon: ({ className }: TechIconProps) => <SiFirebase className={className} />,
  },
  framer: {
    name: "Framer",
    Icon: ({ className }: TechIconProps) => <SiFramer className={className} />,
  },
  git: {
    name: "Git",
    Icon: ({ className }: TechIconProps) => <SiGit className={className} />,
  },
  github: {
    name: "Github",
    Icon: ({ className }: TechIconProps) => <SiGithub className={className} />,
  },
  headlessui: {
    name: "Headless Ui",
    Icon: ({ className }: TechIconProps) => <HeadlessUi className={className} />,
  },
  html_5: {
    name: "HTML",
    Icon: ({ className }: TechIconProps) => <SiHtml5 className={className} />,
  },
  intellij_idea: {
    name: "Intellij Idea",
    Icon: ({ className }: TechIconProps) => <SiIntellijidea className={className} />,
  },
  ionic: {
    name: "Ionic",
    Icon: ({ className }: TechIconProps) => <SiIonic className={className} />,
  },
  javascript: {
    name: "JavaScript",
    Icon: ({ className }: TechIconProps) => <SiJavascript className={className} />,
  },
  jest: {
    name: "Jest",
    Icon: ({ className }: TechIconProps) => <SiJest className={className} />,
  },
  jsdom: {
    name: "Jsdom",
    Icon: ({ className }: TechIconProps) => <Jsdom className={className} />,
  },
  mysql: {
    name: "MySQL",
    Icon: ({ className }: TechIconProps) => <SiMysql className={className} />,
  },
  nodejs: {
    name: "Node.js",
    Icon: ({ className }: TechIconProps) => <SiNodeDotJs className={className} />,
  },
  express: {
    name: "Express",
    Icon: ({ className }: TechIconProps) => <Express className={className} />,
  },
  preact: {
    name: "Preact",
    Icon: ({ className }: TechIconProps) => <Preact className={className} />,
  },
  prettier: {
    name: "Prettier",
    Icon: ({ className }: TechIconProps) => <SiPrettier className={className} />,
  },
  react: {
    name: "React.js",
    Icon: ({ className }: TechIconProps) => <SiReact className={className} />,
  },
  dev_tools: {
    name: "Dev Tools",
    Icon: ({ className }: TechIconProps) => <MdDesktopMac className={className} />,
  },
  office: {
    name: "MS Office",
    Icon: ({ className }: TechIconProps) => <SiMicrosoftoffice className={className} />,
  },
  react_query: {
    name: "React Query",
    Icon: ({ className }: TechIconProps) => <ReactQuery className={className} />,
  },
  redis: {
    name: "Redis",
    Icon: ({ className }: TechIconProps) => <SiRedis className={className} />,
  },
  remix: {
    name: "Remix",
    Icon: ({ className }: TechIconProps) => <Remix className={className} />,
  },
  sendgrid: {
    name: "SendGrid",
    Icon: ({ className }: TechIconProps) => <Sendgrid className={className} />,
  },
  stylelint: {
    name: "Stylelint",
    Icon: ({ className }: TechIconProps) => <Stylelint className={className} />,
  },
  swc: {
    name: "SWC",
    Icon: ({ className }: TechIconProps) => <Swc className={className} />,
  },
  tailwindcss: {
    name: "Tailwindcss",
    Icon: ({ className }: TechIconProps) => <SiTailwindcss className={className} />,
  },
  takealot: {
    name: "Takealot",
    Icon: ({ className }: TechIconProps) => <Takealot className={className} />,
  },
  turborepo: {
    name: "Turborepo",
    Icon: ({ className }: TechIconProps) => <Turborepo className={className} />,
  },
  webpack: {
    name: "Webpack",
    Icon: ({ className }: TechIconProps) => <SiWebpack className={className} />,
  },
  yarn: {
    name: "Yarn",
    Icon: ({ className }: TechIconProps) => <SiYarn className={className} />,
  },
  npm: {
    name: "NPM",
    Icon: ({ className }: TechIconProps) => <SiNpm className={className} />,
  },
  sql: {
    name: "SQL",
    Icon: ({ className }: TechIconProps) => <AiOutlineConsoleSql className={className} />,
  },
  ruby: {
    name: "Ruby",
    Icon: ({ className }: TechIconProps) => <SiRuby className={className} />,
  },
  php: {
    name: "PHP",
    Icon: ({ className }: TechIconProps) => <SiPhp className={className} />,
  },
  illustrator: {
    name: "Illustrator",
    Icon: ({ className }: TechIconProps) => <SiAdobeillustrator className={className} />,
  },
  photoshop: {
    name: "Photoshop",
    Icon: ({ className }: TechIconProps) => <SiAdobephotoshop className={className} />,
  },
  postman: {
    name: "Postman",
    Icon: ({ className }: TechIconProps) => <SiPostman className={className} />,
  },
  erply: {
    Icon: null,
    name: "Erply POS",
  },
  dear: {
    Icon: null,
    name: "Dear POS",
  },
  micros: {
    Icon: null,
    name: "Micros POS",
  },
  wordpress: {
    name: "WordPress",
    Icon: ({ className }: TechIconProps) => <SiWordpress className={className} />,
  },
  ftp: {
    name: "Ftp",
    Icon: ({ className }: TechIconProps) => <ImUpload className={className} />,
  },
  meta: {
    name: "Meta Ads & Facebook Business suite",
    Icon: ({ className }: TechIconProps) => <ImUpload className={className} />,
  },
  google: {
    name: "Google Ads, Merchant & Analytics",
    Icon: ({ className }: TechIconProps) => <ImUpload className={className} />,
  },
  instagram: {
    name: "Instagram",
    Icon: ({ className }: TechIconProps) => <SiInstagram className={className} />,
  },
  omnisend: {
    name: "Omnisend Email Marketing",
    Icon: ({ className }: TechIconProps) => <SiInstagram className={className} />,
  },
  asana: {
    name: "Asana",
    Icon: ({ className }: TechIconProps) => <SiInstagram className={className} />,
  },
  clockify: {
    name: "Clockify",
    Icon: ({ className }: TechIconProps) => <SiInstagram className={className} />,
  },
  msTeams: {
    name: "Microsoft Teams",
    Icon: ({ className }: TechIconProps) => <SiMicrosoftteams className={className} />,
  },
  zoom: {
    name: "Zoom",
    Icon: ({ className }: TechIconProps) => <SiInstagram className={className} />,
  },
  slack: {
    name: "Slack",
    Icon: ({ className }: TechIconProps) => <SiInstagram className={className} />,
  },
} as const;
