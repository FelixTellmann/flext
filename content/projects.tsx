import { TECH } from "content/tech-stack";

export const PROJECTS = [
  {
    name: "Kids Living",
    type: ["ecommerce", "integration"],
    tech: [TECH.shopify, TECH.typescript, TECH.sass, TECH.vend, TECH.vercel],
    url: "https://kidsliving.co.za",
    repository: "",
    description: `Large scale Ecommerce website for a South African based client with 3 brick & mortar locations and over 3000 products.`,
    content: (
      <>
        <p>
          I have worked with Kids Living since 2017 as their Ecommerce success partner covering
          everything from web development, inventory management, and marketing to custom API
          integrations.
        </p>
      </>
    ),
    featuredImage: "https://cdn.shopify.com/s/files/1/2196/3483/files/Website-baner.jpg",
    year: "2017",
  },
  {
    name: "Tellmann",
    type: ["website"],
    tech: [TECH.typescript, TECH.vercel, TECH.nextjs, TECH.reactjs],
    url: "https://tellmann.co.za",
    repository: "https://github.com/FelixTellmann/tellmann.co.za",
    description: `I have create the Tellmann Shopify Ecommerce Agency Website in 2020 to establish a basis to find new Web Development projects. The site has now been replaced with Lunalemon.dev.`,
    content: (
      <>
        <p>
          I have create the Tellmann Shopify Ecommerce Agency Website in 2020 to establish a basis
          to find new Web Development projects.
        </p>
      </>
    ),
    featuredImage: "",
    year: "2020",
  },
  {
    name: "Lunatag",
    type: ["Shopify App"],
    tech: [
      TECH.typescript,
      TECH.vercel,
      TECH.nextjs,
      TECH.reactjs,
      TECH.tailwind,
      TECH.prisma,
      TECH.planetscale,
      TECH.trpc,
      TECH.jsdom,
    ],
    url: "https://apps.shopify.com/lunatag",
    repository: "",
    description: `I build LunaTag together with @LizT as a solution to create shoppable images anywhere on a Shopify hosted site. The apps interface fully integrates into a Shopify backend.`,
    content: (
      <>
        <p>
          I build LunaTag together with @LizT as a solution to create shoppable images anywhere on a
          Shopify hosted site. The apps interface fully integrates into a Shopify backend.
        </p>
        <p>
          The project had several core challenges: Iframe Proxying, Image tagging stacking context,
          reverse dom selectors, serverless Shopify app authentication.
        </p>
      </>
    ),
    featuredImage: "",
    year: "2022",
  },
  {
    name: "ClickUpload",
    type: ["Shopify App"],
    tech: [
      TECH.typescript,
      TECH.vercel,
      TECH.nextjs,
      TECH.reactjs,
      TECH.tailwind,
      TECH.prisma,
      TECH.planetscale,
      TECH.trpc,
      TECH.aws,
      TECH.turborepo,
    ],
    url: "https://apps.shopify.com/click-upload",
    repository: "",
    description: `ClickUpload enables Shopify store owners to let customers upload files to their orders. The app supports all file types and sizes. All files are linked to the order and can be downloaded easily.`,
    content: (
      <>
        <p>
          I build ClickUpload together with @LizT in order to allow merchants add file Upload
          capabilities to their Shopify site. The apps interface fully integrates into a Shopify
          backend.
        </p>
      </>
    ),
    featuredImage: "",
    year: "2021",
  },
  {
    name: "Lunalemon",
    type: ["Website"],
    tech: [
      TECH.shopify,
      TECH.typescript,
      TECH.trpc,
      TECH.tailwindcss,
      TECH.nextjs,
      TECH.vercel,
      TECH.headlessui,
      TECH.planetscale,
    ],
  },
  {
    name: "Shopify-ftp-access",
    type: ["Devtool"],
    tech: [TECH.typescript, TECH.swc, TECH.shopify],
    year: "2017",
  },
  {
    name: "Shopify-cms",
    type: ["Devtool"],
    tech: [TECH.shopify, TECH.typescript, TECH.graphql, TECH.reactjs, TECH.tailwindcss],
    year: "2022",
  },
  {
    name: "fx-style",
    type: ["Devtool"],
    tech: [TECH.prettier, TECH.eslint, TECH.typescript],
    year: "2020",
  },
  {
    name: "shopify-typed-node-api",
    type: ["Devtool"],
    tech: [TECH.shopify, TECH.typescript, TECH.graphql, TECH.reactjs, TECH.nodejs],
    year: "2021",
  },
  {
    name: "Erply Takealot API Integration",
    type: ["Integration"],
    tech: [TECH.nextjs, TECH.aws_lambda, TECH.axios],
    year: "2021",
  },
  {
    name: "Shopify Vend POS API Integration",
    type: ["Integration"],
    tech: [TECH.nextjs, TECH.aws_lambda, TECH.axios, TECH.graphql, TECH.shopify, TECH.vend],
    year: "2020",
  },
  {
    name: "Erply Egypt eInvoicing API Integration",
    type: ["Integration"],
    tech: [TECH.nextjs, TECH.aws_lambda, TECH.axios],
    year: "2022",
  },
  {
    name: "Shopify Courier Guy API Integration",
    type: ["Integration"],
    tech: [TECH.nextjs, TECH.aws_lambda, TECH.axios, TECH.shopify],
    year: "2021",
  },
  {
    name: "Shopify DEARsystems API Integration",
    type: ["Integration"],
    tech: [TECH.nextjs, TECH.aws_lambda, TECH.axios, TECH.shopify],
    year: "2022",
  },
  {
    name: "Vend Takealot API Integration",
    type: ["Integration"],
    tech: [TECH.nextjs, TECH.aws_lambda, TECH.axios, TECH.vend],
    year: "2021",
  },
  {
    name: "Vend Shopify Omnisend API Integration",
    type: ["Integration"],
    tech: [TECH.nextjs, TECH.aws_lambda, TECH.axios, TECH.vend],
    year: "2020",
  },
  {
    name: "Aiko",
    type: ["Ecommerce"],
    tech: [TECH.figma, TECH.shopify, TECH.tailwindcss, TECH.typescript],
    year: "2022",
  },
  {
    name: "Zoom Printing",
    type: ["Ecommerce"],
    tech: [TECH.shopify, TECH.typescript, TECH.tailwindcss],
    year: "2021",
  },
  {
    name: "AlphabetPIX",
    type: ["Ecommerce"],
    tech: [TECH.shopify, TECH.javascript, TECH.sass],
    year: "2017",
  },
  {
    name: "BushScarf",
    type: ["Ecommerce"],
    tech: [TECH.shopify, TECH.javascript, TECH.sass],
    year: "2018",
  },
  {
    name: "Broadway Jewellers",
    type: ["Ecommerce"],
    tech: [TECH.shopify, TECH.typescript, TECH.sass, TECH.aws],
    year: "2020",
  },
  {
    name: "Waraq Health",
    type: ["Ecommerce"],
    tech: [TECH.shopify, TECH.typescript, TECH.sass, TECH.aws],
    year: "2021",
  },
];
