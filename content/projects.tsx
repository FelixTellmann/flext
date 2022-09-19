import { TECH } from "content/tech-stack";
import Aiko from "../public/images/projects/Aiko.jpg";
import AlphabetPIX from "../public/images/projects/AlphabetPix.jpg";
import BroadwayJewellers from "../public/images/projects/BroadwayJewellers.jpg";
import BushScarf from "../public/images/projects/BushScarf.jpg";
import ClickUpload from "../public/images/projects/ClickUpload.jpg";
import ErplyEgypt from "../public/images/projects/Erply Egypt.png";
import ErplyTakealot from "../public/images/projects/Erply Takealot.png";
import FxStyle from "../public/images/projects/fx-style.png";
import KidsLiving from "../public/images/projects/kidsliving.jpg";
import Lunalemon from "../public/images/projects/Lunalemon.jpg";
import Lunatag from "../public/images/projects/Lunatag.jpg";
import ShopifyCourierGuy from "../public/images/projects/Shopify CourierGuy.png";
import ShopifyDear from "../public/images/projects/Shopify Dear Systems.png";
import VendShopifyOmnisend from "../public/images/projects/Shopify Vend Omnisend.png";
import ShopifyVend from "../public/images/projects/Shopify Vend.png";
import ShopifyCms from "../public/images/projects/Shopify-cms.png";
import ShopifyFtp from "../public/images/projects/shopify-ftp.png";
import ShopifyTypedNodeApi from "../public/images/projects/shopify-typed-node-api.png";
import Tellmann from "../public/images/projects/Tellmann.jpg";
import VendTakealot from "../public/images/projects/Vend Takealot.png";
import WaraqHealth from "../public/images/projects/Waraq.jpg";
import ZoomPrinting from "../public/images/projects/ZoomPringing.jpg";

export const PROJECTS = [
  {
    name: "Lunatag",
    type: ["Shopify Apps"],
    tech: [
      TECH.typescript,
      TECH.vercel,
      TECH.nextjs,
      TECH.reactjs,
      TECH.tailwindcss,
      TECH.prisma,
      TECH.planetscale,
      TECH.trpc,
      TECH.jsdom,
    ],
    url: "https://apps.shopify.com/lunatag",
    repository: "",
    description: `I've created a Shopify App that allows users to add Tags to any image on their Shopify site to upsell products. The app is available on the Shopify App store and works for all Shopify themes.`,
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
    name: "Tellmann",
    type: ["Marketing Sites"],
    tech: [TECH.typescript, TECH.vercel, TECH.nextjs, TECH.reactjs],
    url: "https://tellmann.co.za",
    repository: "https://github.com/FelixTellmann/tellmann.co.za",
    description: `Tellmann Shopify Ecommerce Agency Website. I've built the site to establish a basis to find new Web Development projects and promote Shopify services.`,
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
    name: "ClickUpload",
    type: ["Shopify Apps"],
    tech: [
      TECH.typescript,
      TECH.vercel,
      TECH.nextjs,
      TECH.reactjs,
      TECH.tailwindcss,
      TECH.prisma,
      TECH.planetscale,
      TECH.trpc,
      TECH.aws,
      TECH.turborepo,
    ],
    url: "https://apps.shopify.com/click-upload",
    repository: "",
    description: `ClickUpload enables Shopify store owners to let customers upload files to their orders. The Shopify App supports all file types and sizes. All files are linked to the order and can be downloaded easily.`,
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
    name: "Kids Living",
    type: ["Ecommerce Sites", "Integrations"],
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
    name: "Lunalemon",
    type: ["Marketing Sites"],
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
    description:
      "Headless Web agency site utilizing Shopify's theme editor as a custom CMS. The site showcases my client oriented projects and promotes web development services.",
    featuredImage: Lunalemon,
    year: "2022",
    url: "https://kidsliving.co.za",
    repository: "https://github.com/FelixTellmann/lunalemon.dev",
  },
  {
    name: "shopify-ftp-access",
    type: ["Devtools"],
    tech: [TECH.typescript, TECH.swc, TECH.shopify],
    year: "2017",
    repository: "https://github.com/FelixTellmann/shopify-ftp-access",
    description:
      "Shopify-ftp-access is an Open Source utility which acts as a proxy that allows you to use any FTP program while running the CLI to connect upload/download any shopify Theme files",
    featuredImage: ShopifyFtp,
  },
  {
    name: "Erply Egypt eInvoicing API",
    type: ["Integrations"],
    tech: [TECH.nextjs, TECH.aws_lambda, TECH.axios],
    year: "2022",
    description:
      "This custom App runs on 5 min Cron Job to process any incoming sales data for a retail chain in Egypt, processing each invoice on the eInvoicing portal. The app includes an internal dashboard for any manual processing required.",
    featuredImage: ErplyEgypt,
  },
  {
    name: "Zoom Printing",
    type: ["Ecommerce Sites"],
    tech: [TECH.shopify, TECH.typescript, TECH.tailwindcss],
    year: "2021",
    url: "https://www.zoomprinting.ca/",
    description:
      "I've built the Shopify site based on the Warehouse theme, with lots of custom integrations to enable up to 1000 product variants and add-on sales. I've migrated the client from a old legacy self-hosted server, building my own web-scrapers along the way.",
    featuredImage: ZoomPrinting,
  },
  {
    name: "Vend Takealot API",
    type: ["Integrations"],
    tech: [TECH.nextjs, TECH.aws_lambda, TECH.axios, TECH.vend],
    year: "2021",
    description:
      "Similar to the Erply Takealot integration, this app runs a scheduled script to ensure that sales & inventory levels are synchronized between two sales channels.",
    featuredImage: VendTakealot,
  },
  {
    name: "Aiko",
    type: ["Ecommerce Sites"],
    tech: [TECH.figma, TECH.shopify, TECH.tailwindcss, TECH.typescript],
    year: "2022",
    url: "https://aikoplanet.com/",
    description:
      "I built a fully custom designed Shopify site, utilizing shopify-cms in a non-headless way, to ensure type safety throughout the project using Shopify Liquid templates.",
    featuredImage: Aiko,
  },
  {
    name: "Shopify Courier Guy API",
    type: ["Integrations"],
    tech: [TECH.nextjs, TECH.aws_lambda, TECH.axios, TECH.shopify],
    year: "2021",
    description:
      "An integration to connect sales directly to the popular shipping provided Courier Guy, reducing the need to manually process incoming orders for fulfillment.",
    featuredImage: ShopifyCourierGuy,
  },
  {
    name: "shopify-cms",
    type: ["Devtools"],
    tech: [TECH.shopify, TECH.typescript, TECH.graphql, TECH.reactjs, TECH.tailwindcss],
    year: "2022",
    repository: "https://github.com/FelixTellmann/shopify-cms",
    description:
      "Shopify-cms is another Open Source CLI that I've built. The package helps building a site with the Shopify Theme Editor as a Headless CMS and get fully typed data.",
    featuredImage: ShopifyCms,
  },
  {
    name: "Erply Takealot sales API",
    type: ["Integrations"],
    tech: [TECH.nextjs, TECH.aws_lambda, TECH.axios],
    year: "2021",
    description:
      "I've built an API integration to process inventory levels and sales between the two POS/Ecommerce platforms for an internal client.",
    featuredImage: ErplyTakealot,
  },
  {
    name: "AlphabetPIX",
    type: ["Ecommerce Sites"],
    tech: [TECH.shopify, TECH.javascript, TECH.sass],
    year: "2017",
    url: "https://alphabetpix.com/",
    description:
      "Custom build Shopify-site / Web-app that allows customers to create their own named picture frame and generate image files on the fly for their checkout.",
    featuredImage: AlphabetPIX,
  },
  {
    name: "shopify-typed-node-api",
    type: ["Devtools"],
    tech: [TECH.shopify, TECH.typescript, TECH.graphql, TECH.reactjs, TECH.nodejs],
    year: "2021",
    repository: "https://github.com/FelixTellmann/shopify-typed-node-api/",
    description:
      "Shopify-typed-node-api is an extension to the popular shopify-node-api, adding typescript support for all Rest & GraphQL endpoints provided by Shopify.",
    featuredImage: ShopifyTypedNodeApi,
  },
  {
    name: "Shopify Vend product API",
    type: ["Integrations"],
    tech: [TECH.nextjs, TECH.aws_lambda, TECH.axios, TECH.graphql, TECH.shopify, TECH.vend],
    year: "2020",
    description:
      "A custom integration, ensuring that relevant product data is kept synchronized between Vend POS and Shopify, based on a webhook architecture to push updates.",
    featuredImage: ShopifyVend,
  },
  {
    name: "BushScarf",
    type: ["Ecommerce Sites"],
    tech: [TECH.shopify, TECH.javascript, TECH.sass],
    year: "2016",
    url: "https://originalthings-za.myshopify.com/",
    description:
      "I worked with Bushscarf to develop their Shopify Website covering aspects from product photography, product image editing and product content creation.",
    featuredImage: BushScarf,
  },
  {
    name: "Broadway Jewellers",
    type: ["Ecommerce Sites"],
    tech: [TECH.shopify, TECH.typescript, TECH.sass, TECH.aws],
    year: "2020",
    url: "https://broadwayjewellers.co.za/",
    description:
      "My work with Broadway Jewellers started with migrating their site form WordPress to Shopify, I also covered an array of aspects from inventory management, digital marketing, SEO web solutions, web design upgrade to custom API solutions.",
    featuredImage: BroadwayJewellers,
  },
  {
    name: "fx-style",
    type: ["Devtools"],
    tech: [TECH.prettier, TECH.eslint, TECH.typescript],
    year: "2020",
    repository: "https://github.com/FelixTellmann/fx-style",
    description:
      "I've created fx-style as a package to standardize my own code style across all projects, while minimizing devDependencies for each project.",
    featuredImage: FxStyle,
  },
  {
    name: "Shopify DearSystems API",
    type: ["Integrations"],
    tech: [TECH.nextjs, TECH.aws_lambda, TECH.axios, TECH.shopify],
    year: "2022",
    description:
      "This integration allows my client to effectively synchronize their inventory between Dear and Shopify with multiple store locations and a complex VAT setup.",
    featuredImage: ShopifyDear,
  },
  {
    name: "Waraq Health",
    type: ["Ecommerce Sites"],
    tech: [TECH.shopify, TECH.typescript, TECH.sass, TECH.aws],
    year: "2021",
    url: "https://waraqhealth.com/",
    description:
      "I worked with Waraq to successfully develop their Shopify site, covering aspects from product image editing and content research and creation.",
    featuredImage: WaraqHealth,
  },
  {
    name: "Vend Shopify Omnisend API",
    type: ["Integrations"],
    tech: [TECH.nextjs, TECH.aws_lambda, TECH.axios, TECH.vend],
    year: "2020",
    description:
      "A custom integration to collect & update customer information for OmniSend email marketing, utilizing in-store (via QR code) and online sign-ups.",
    featuredImage: VendShopifyOmnisend,
  },
];
