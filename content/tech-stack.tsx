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
import { SiTailwindcss } from "@react-icons/all-files/si/SiTailwindcss";
import { SiTypescript } from "@react-icons/all-files/si/SiTypescript";
import { SiWebpack } from "@react-icons/all-files/si/SiWebpack";
import { SiWordpress } from "@react-icons/all-files/si/SiWordpress";
import { SiYarn } from "@react-icons/all-files/si/SiYarn";

import AwsAmplify from "public/icons/tech-logos/aws_amplify.svg";
import AwsLambda from "public/icons/tech-logos/aws_lambda.svg";
import Axios from "public/icons/tech-logos/axios.svg";
import Emmet from "public/icons/tech-logos/emmet.svg";
import HeadlessUi from "public/icons/tech-logos/headlessui.svg";
import Jsdom from "public/icons/tech-logos/jsdom.svg";
import Mdx from "public/icons/tech-logos/mdx.svg";
import PlanetScale from "public/icons/tech-logos/planetscale.svg";
import Preact from "public/icons/tech-logos/preact.svg";
import Prisma from "public/icons/tech-logos/prisma.svg";
import ReactQuery from "public/icons/tech-logos/react_query.svg";
import Remix from "public/icons/tech-logos/remix.svg";
import Sendgrid from "public/icons/tech-logos/sendgrid.svg";
import Stylelint from "public/icons/tech-logos/stylelint.svg";
import Swc from "public/icons/tech-logos/swc.svg";
import Takealot from "public/icons/tech-logos/takealot.svg";
import Trpc from "public/icons/tech-logos/trpc.svg";
import Turborepo from "public/icons/tech-logos/turborepo.svg";
import Vend from "public/icons/tech-logos/vend_pos.svg";
import NextJs from "public/icons/tech-logos/nextjs.svg";
import Express from "public/icons/tech-logos/express.svg";
import Liquid from "public/icons/tech-logos/liquid.svg";

export const TECH = {
  shopify: {
    name: "Shopify",
    Icon: ({ className }) => <SiShopify className={className} />,
  },
  vend: {
    name: "Vend POS",
    Icon: ({ className }) => <Vend className={className} />,
  },
  typescript: {
    name: "TypeScript",
    Icon: ({ className }) => <SiTypescript className={className} />,
  },
  vercel: {
    name: "Vercel",
    Icon: ({ className }) => <IoLogoVercel className={className} />,
  },
  netlify: {
    name: "Netlify",
    Icon: ({ className }) => <SiNetlify className={className} />,
  },
  sass: {
    name: "Sass",
    Icon: ({ className }) => <IoLogoSass className={className} />,
  },
  liquid: {
    name: "Liquid",
    Icon: ({ className }) => <Liquid className={className} />,
  },
  nextjs: {
    name: "Next.js",
    Icon: ({ className }) => <NextJs className={className} />,
  },
  markdown: {
    name: "Markdown",
    Icon: ({ className }) => <SiMarkdown className={className} />,
  },
  mdx: {
    name: "Mdx",
    Icon: ({ className }) => <Mdx className={className} />,
  },
  graphql: {
    name: "GraphQL",
    Icon: ({ className }) => <SiGraphql className={className} />,
  },
  reactjs: {
    name: "React.js",
    Icon: ({ className }) => <SiReact className={className} />,
  },
  tailwind: {
    name: "TailwindCSS",
    Icon: ({ className }) => <SiTailwindcss className={className} />,
  },
  prisma: {
    name: "Prisma",
    Icon: ({ className }) => <Prisma className={className} />,
  },
  planetscale: {
    name: "PlanetScale",
    Icon: ({ className }) => <PlanetScale className={className} />,
  },
  trpc: {
    name: "Trpc",
    Icon: ({ className }) => <Trpc className={className} />,
  },
  aws: {
    name: "AWS",
    Icon: ({ className }) => <FaAws className={className} />,
  },
  aws_amplify: {
    name: "Aws Amplify",
    Icon: ({ className }) => <AwsAmplify className={className} />,
  },
  aws_lambda: {
    name: "Aws Lambda",
    Icon: ({ className }) => <AwsLambda className={className} />,
  },
  axios: {
    name: "Axios",
    Icon: ({ className }) => <Axios className={className} />,
  },
  chrome: {
    name: "Chrome",
    Icon: ({ className }) => <SiGooglechrome className={className} />,
  },
  css_3: {
    name: "CSS",
    Icon: ({ className }) => <SiCss3 className={className} />,
  },
  emmet: {
    name: "Emmet",
    Icon: ({ className }) => <Emmet className={className} />,
  },
  eslint: {
    name: "Eslint",
    Icon: ({ className }) => <SiEslint className={className} />,
  },
  facebook: {
    name: "Facebook",
    Icon: ({ className }) => <SiFacebook className={className} />,
  },
  figma: {
    name: "Figma",
    Icon: ({ className }) => <SiFigma className={className} />,
  },
  firebase: {
    name: "Firebase",
    Icon: ({ className }) => <SiFirebase className={className} />,
  },
  framer: {
    name: "Framer",
    Icon: ({ className }) => <SiFramer className={className} />,
  },
  git: {
    name: "Git",
    Icon: ({ className }) => <SiGit className={className} />,
  },
  github: {
    name: "Github",
    Icon: ({ className }) => <SiGithub className={className} />,
  },
  headlessui: {
    name: "Headless Ui",
    Icon: ({ className }) => <HeadlessUi className={className} />,
  },
  html_5: {
    name: "HTML",
    Icon: ({ className }) => <SiHtml5 className={className} />,
  },
  intellij_idea: {
    name: "Intellij Idea",
    Icon: ({ className }) => <SiIntellijidea className={className} />,
  },
  ionic: {
    name: "Ionic",
    Icon: ({ className }) => <SiIonic className={className} />,
  },
  javascript: {
    name: "JavaScript",
    Icon: ({ className }) => <SiJavascript className={className} />,
  },
  jest: {
    name: "Jest",
    Icon: ({ className }) => <SiJest className={className} />,
  },
  jsdom: {
    name: "Jsdom",
    Icon: ({ className }) => <Jsdom className={className} />,
  },
  mysql: {
    name: "MySQL",
    Icon: ({ className }) => <SiMysql className={className} />,
  },
  nodejs: {
    name: "Node.js",
    Icon: ({ className }) => <SiNodeDotJs className={className} />,
  },
  express: {
    name: "Express",
    Icon: ({ className }) => <Express className={className} />,
  },
  preact: {
    name: "Preact",
    Icon: ({ className }) => <Preact className={className} />,
  },
  prettier: {
    name: "Prettier",
    Icon: ({ className }) => <SiPrettier className={className} />,
  },
  react: {
    name: "React.js",
    Icon: ({ className }) => <SiReact className={className} />,
  },
  dev_tools: {
    name: "Dev Tools",
    Icon: ({ className }) => <MdDesktopMac className={className} />,
  },
  office: {
    name: "MS Office",
    Icon: ({ className }) => <SiMicrosoftoffice className={className} />,
  },
  react_query: {
    name: "React Query",
    Icon: ({ className }) => <ReactQuery className={className} />,
  },
  redis: {
    name: "Redis",
    Icon: ({ className }) => <SiRedis className={className} />,
  },
  remix: {
    name: "Remix",
    Icon: ({ className }) => <Remix className={className} />,
  },
  sendgrid: {
    name: "SendGrid",
    Icon: ({ className }) => <Sendgrid className={className} />,
  },
  stylelint: {
    name: "Stylelint",
    Icon: ({ className }) => <Stylelint className={className} />,
  },
  swc: {
    name: "SWC",
    Icon: ({ className }) => <Swc className={className} />,
  },
  tailwindcss: {
    name: "Tailwindcss",
    Icon: ({ className }) => <SiTailwindcss className={className} />,
  },
  takealot: {
    name: "Takealot",
    Icon: ({ className }) => <Takealot className={className} />,
  },
  turborepo: {
    name: "Turborepo",
    Icon: ({ className }) => <Turborepo className={className} />,
  },
  webpack: {
    name: "Webpack",
    Icon: ({ className }) => <SiWebpack className={className} />,
  },
  yarn: {
    name: "Yarn",
    Icon: ({ className }) => <SiYarn className={className} />,
  },
  npm: {
    name: "NPM",
    Icon: ({ className }) => <SiNpm className={className} />,
  },
  sql: {
    name: "SQL",
    Icon: ({ className }) => <AiOutlineConsoleSql className={className} />,
  },
  ruby: {
    name: "Ruby",
    Icon: ({ className }) => <SiRuby className={className} />,
  },
  php: {
    name: "PHP",
    Icon: ({ className }) => <SiPhp className={className} />,
  },
  illustrator: {
    name: "Illustrator",
    Icon: ({ className }) => <SiAdobeillustrator className={className} />,
  },
  photoshop: {
    name: "Photoshop",
    Icon: ({ className }) => <SiAdobephotoshop className={className} />,
  },
  postman: {
    name: "Postman",
    Icon: ({ className }) => <SiPostman className={className} />,
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
    Icon: ({ className }) => <SiWordpress className={className} />,
  },
  ftp: {
    name: "Ftp",
    Icon: ({ className }) => <ImUpload className={className} />,
  },
  meta: {
    name: "Meta Ads Management & Facebook Business suite",
    Icon: ({ className }) => <ImUpload className={className} />,
  },
  google: {
    name: "Google Ads, Business, Merchant & Analytics",
    Icon: ({ className }) => <ImUpload className={className} />,
  },
  instagram: {
    name: "Instagram",
    Icon: ({ className }) => <SiInstagram className={className} />,
  },
  omnisend: {
    name: "Omnisend Email Marketing",
    Icon: ({ className }) => <SiInstagram className={className} />,
  },
  asana: {
    name: "Asana",
    Icon: ({ className }) => <SiInstagram className={className} />,
  },
  clockify: {
    name: "Clockify",
    Icon: ({ className }) => <SiInstagram className={className} />,
  },
  msTeams: {
    name: "Microsoft Teams",
    Icon: ({ className }) => <SiMicrosoftteams className={className} />,
  },
  zoom: {
    name: "Zoom",
    Icon: ({ className }) => <SiInstagram className={className} />,
  },
  slack: {
    name: "Slack",
    Icon: ({ className }) => <SiInstagram className={className} />,
  },
} as const;
