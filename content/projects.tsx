import { TECH } from "content/tech-stack";

export const PROJECTS = [
  {
    name: "Kids Living",
    type: ["ecommerce", "integration"],
    tech: [TECH.shopify, TECH.typescript, TECH.sass, TECH.vend, TECH.vercel],
    url: "https://kidsliving.co.za",
    repository: "",
    description: `I have worked with Kids Living since 2017 as their ecommerce success partner covering everything from web development, inventory management, and marketing to custom API integrations.`,
    content: (
      <>
        <p>
          I have worked with Kids Living since 2017 as their Ecommerce success partner covering
          everything from web development, inventory management, and marketing to custom API
          integrations.
        </p>
      </>
    ),
    featuredImage: "",
    date: "2017-06-01",
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
    date: "2020-10-01",
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
    date: "2022-02-01",
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
    date: "2022-02-01",
  },
  {
    name: "Lunalemon",
    type: ["Website"],
  },
  {
    name: "Shopify-ftp-access",
    type: ["Devtool"],
  },
  {
    name: "Shopify-cms",
    type: ["Devtool"],
  },
  {
    name: "fx-style",
    type: ["Devtool"],
  },
  {
    name: "shopify-typed-node-api",
    type: ["Devtool"],
  },
  {
    name: "Erply Takealot API Integration",
    type: ["Integration"],
  },
  {
    name: "Shopify Vend POS API Integration",
    type: ["Integration"],
  },
  {
    name: "Erply Egypt eInvoicing API Integration",
    type: ["Integration"],
  },
  {
    name: "Shopify Courier Guy API Integration",
    type: ["Integration"],
  },
  {
    name: "Shopify DEARsystems API Integration",
    type: ["Integration"],
  },
  {
    name: "Vend Takealot API Integration",
    type: ["Integration"],
  },
  {
    name: "Vend Shopify Omnisend API Integration",
    type: ["Integration"],
  },
  {
    name: "Aiko",
    type: ["Ecommerce"],
  },
  {
    name: "Zoom Printing",
    type: ["Ecommerce"],
  },
  {
    name: "AlphabetPIX",
    type: ["Ecommerce"],
  },
  {
    name: "BushScarf",
    type: ["Ecommerce"],
  },
  {
    name: "Broadway Jewellers",
    type: ["Ecommerce"],
  },
  {
    name: "Waraq Health",
    type: ["Ecommerce"],
  },
];
