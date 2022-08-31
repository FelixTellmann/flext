import { TECH } from "content/tech-stack";
import KidsLiving from "public/images/projects/Kidsliving.jpg";
import Tellmann from "public/images/projects/Tellmann.jpg";
import Lunatag from "public/images/projects/Lunatag.jpg";
import ClickUpload from "public/images/projects/ClickUpload.jpg";
import Lunalemon from "public/images/projects/Lunalemon.jpg";
import ShopifyFtp from "public/images/projects/shopify-ftp.png";
import ShopifyCms from "public/images/projects/Shopify-cms.png";
import FxStyle from "public/images/projects/fx-style.png";
import ShopifyTypedNodeApi from "public/images/projects/shopify-typed-node-api.png";
import ErplyTakealot from "public/images/projects/Erply Takealot.png";
import ShopifyVend from "public/images/projects/Shopify Vend.png";
import ErplyEgypt from "public/images/projects/Erply Egypt.png";
import ShopifyCourierGuy from "public/images/projects/Shopify CourierGuy.png";
import ShopifyDear from "public/images/projects/Shopify Dear Systems.png";
import VendTakealot from "public/images/projects/Vend Takealot.png";
import VendShopifyOmnisend from "public/images/projects/Shopify Vend Omnisend.png";
import Aiko from "public/images/projects/Aiko.jpg";
import ZoomPrinting from "public/images/projects/ZoomPringing.jpg";
import AlphabetPIX from "public/images/projects/AlphabetPix.jpg";
import BushScarf from "public/images/projects/BushScarf.jpg";
import BroadwayJewellers from "public/images/projects/BroadwayJewellers.jpg";
import WaraqHealth from "public/images/projects/Waraq.jpg";

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
    featuredImage: KidsLiving,
    year: "2017",
  },
  {
    name: "Tellmann",
    type: ["website"],
    tech: [TECH.typescript, TECH.vercel, TECH.nextjs, TECH.reactjs],
    url: "https://tellmann.co.za",
    repository: "https://github.com/FelixTellmann/tellmann.co.za",
    description: `Tellmann Shopify Ecommerce Agency Website. I've built the site to establish a basis to find new Web Development projects and promote Shopify services/`,
    content: (
      <>
        <p>
          I have create the Tellmann Shopify Ecommerce Agency Website in 2020 to establish a basis
          to find new Web Development projects.
        </p>
      </>
    ),
    featuredImage: Tellmann,
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
    description: `Shopify App available on the Shopify App store. The App allows users to add Tags to any image on their Shopify site to upsell products.`,
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
    featuredImage: Lunatag,
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
    featuredImage: ClickUpload,
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
    featuredImage: Lunalemon,
  },
  {
    name: "Shopify-ftp-access",
    type: ["Devtool"],
    tech: [TECH.typescript, TECH.swc, TECH.shopify],
    year: "2017",
    featuredImage: ShopifyFtp,
  },
  {
    name: "Shopify-cms",
    type: ["Devtool"],
    tech: [TECH.shopify, TECH.typescript, TECH.graphql, TECH.reactjs, TECH.tailwindcss],
    year: "2022",
    featuredImage: ShopifyCms,
  },
  {
    name: "fx-style",
    type: ["Devtool"],
    tech: [TECH.prettier, TECH.eslint, TECH.typescript],
    year: "2020",
    featuredImage: FxStyle,
  },
  {
    name: "shopify-typed-node-api",
    type: ["Devtool"],
    tech: [TECH.shopify, TECH.typescript, TECH.graphql, TECH.reactjs, TECH.nodejs],
    year: "2021",
    featuredImage: ShopifyTypedNodeApi,
  },
  {
    name: "Erply Takealot API Integration",
    type: ["Integration"],
    tech: [TECH.nextjs, TECH.aws_lambda, TECH.axios],
    year: "2021",
    featuredImage: ErplyTakealot,
  },
  {
    name: "Shopify Vend POS API Integration",
    type: ["Integration"],
    tech: [TECH.nextjs, TECH.aws_lambda, TECH.axios, TECH.graphql, TECH.shopify, TECH.vend],
    year: "2020",
    featuredImage: ShopifyVend,
  },
  {
    name: "Erply Egypt eInvoicing API Integration",
    type: ["Integration"],
    tech: [TECH.nextjs, TECH.aws_lambda, TECH.axios],
    year: "2022",
    featuredImage: ErplyEgypt,
  },
  {
    name: "Shopify Courier Guy API Integration",
    type: ["Integration"],
    tech: [TECH.nextjs, TECH.aws_lambda, TECH.axios, TECH.shopify],
    year: "2021",
    featuredImage: ShopifyCourierGuy,
  },
  {
    name: "Shopify DEARsystems API Integration",
    type: ["Integration"],
    tech: [TECH.nextjs, TECH.aws_lambda, TECH.axios, TECH.shopify],
    year: "2022",
    featuredImage: ShopifyDear,
  },
  {
    name: "Vend Takealot API Integration",
    type: ["Integration"],
    tech: [TECH.nextjs, TECH.aws_lambda, TECH.axios, TECH.vend],
    year: "2021",
    featuredImage: VendTakealot,
  },
  {
    name: "Vend Shopify Omnisend API Integration",
    type: ["Integration"],
    tech: [TECH.nextjs, TECH.aws_lambda, TECH.axios, TECH.vend],
    year: "2020",
    featuredImage: VendShopifyOmnisend,
  },
  {
    name: "Aiko",
    type: ["Ecommerce"],
    tech: [TECH.figma, TECH.shopify, TECH.tailwindcss, TECH.typescript],
    year: "2022",
    featuredImage: Aiko,
  },
  {
    name: "Zoom Printing",
    type: ["Ecommerce"],
    tech: [TECH.shopify, TECH.typescript, TECH.tailwindcss],
    year: "2021",
    featuredImage: ZoomPrinting,
  },
  {
    name: "AlphabetPIX",
    type: ["Ecommerce"],
    tech: [TECH.shopify, TECH.javascript, TECH.sass],
    year: "2017",
    featuredImage: AlphabetPIX,
  },
  {
    name: "BushScarf",
    type: ["Ecommerce"],
    tech: [TECH.shopify, TECH.javascript, TECH.sass],
    year: "2018",
    featuredImage: BushScarf,
  },
  {
    name: "Broadway Jewellers",
    type: ["Ecommerce"],
    tech: [TECH.shopify, TECH.typescript, TECH.sass, TECH.aws],
    year: "2020",
    featuredImage: BroadwayJewellers,
  },
  {
    name: "Waraq Health",
    type: ["Ecommerce"],
    tech: [TECH.shopify, TECH.typescript, TECH.sass, TECH.aws],
    year: "2021",
    featuredImage: WaraqHealth,
  },
];
