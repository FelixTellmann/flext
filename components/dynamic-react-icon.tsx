import dynamic from "next/dynamic";
import { ComponentType, FC } from "react";
import type * as Icons from "react-icons/all";

export type ReactIconProps = Omit<JSX.IntrinsicElements["svg"], "name"> & {
  name: keyof typeof Icons | LocalSVGIcons;
};

export const ReactIcon: FC<ReactIconProps> = ({ name, ...props }) => {
  const Icon: ComponentType<JSX.IntrinsicElements["svg"]> = dynamic(
    async () => {
      try {
        const asyncImport = {
          FaGithub: import("@react-icons/all-files/fa/FaGithub"),
          FaShopify: import("@react-icons/all-files/fa/FaShopify"),
          SiNextdotjs: import("@react-icons/all-files/si/SiNextDotJs"),
          SiTailwindcss: import("@react-icons/all-files/si/SiTailwindcss"),
          SiReact: import("@react-icons/all-files/si/SiReact"),
          SiShopify: import("@react-icons/all-files/si/SiShopify"),
          SiMarkdown: import("@react-icons/all-files/si/SiMarkdown"),
          SiGraphql: import("@react-icons/all-files/si/SiGraphql"),
          IoLogoVercel: import("@react-icons/all-files/io5/IoLogoVercel"),
          IoLogoSass: import("@react-icons/all-files/io5/IoLogoSass"),
          SiTypescript: import("@react-icons/all-files/si/SiTypescript"),
          SiNodedotjs: import("@react-icons/all-files/si/SiNodeDotJs"),
          FiCopy: import("@react-icons/all-files/fi/FiCopy"),
          FaFacebook: import("@react-icons/all-files/fa/FaFacebook"),
          FaGoogle: import("@react-icons/all-files/fa/FaGoogle"),
          FaTwitter: import("@react-icons/all-files/fa/FaTwitter"),
          FaInstagram: import("@react-icons/all-files/fa/FaInstagram"),
          BsThreeDotsVertical: import("@react-icons/all-files/bs/BsThreeDotsVertical"),

          // amp: import("public/icons/tech-logos/amp.svg"),
          // android: import("public/icons/tech-logos/android.svg"),
          // apple: import("public/icons/tech-logos/apple.svg"),
          // awesome: import("public/icons/tech-logos/awesome.svg"),
          aws: import("public/icons/tech-logos/aws.svg"),
          // aws_amplify: import("public/icons/tech-logos/aws_amplify.svg"),
          aws_lambda: import("public/icons/tech-logos/aws_lambda.svg"),
          axios: import("public/icons/tech-logos/axios.svg"),
          /*babel: import("public/icons/tech-logos/babel.svg"),*/
          // chrome: import("public/icons/tech-logos/chrome.svg"),
          // css_3: import("public/icons/tech-logos/css_3.svg"),
          // emmet: import("public/icons/tech-logos/emmet.svg"),
          eslint: import("public/icons/tech-logos/eslint.svg"),
          // facebook: import("public/icons/tech-logos/facebook.svg"),
          figma: import("public/icons/tech-logos/figma.svg"),
          // firebase: import("public/icons/tech-logos/firebase.svg"),
          // framer: import("public/icons/tech-logos/framer.svg"),
          // git: import("public/icons/tech-logos/git.svg"),
          // github: import("public/icons/tech-logos/github.svg"),
          // github_copilot: import("public/icons/tech-logos/github_copilot.svg"),
          // google_analytics: import("public/icons/tech-logos/google_analytics.svg"),
          // google_cloud_functions: import("public/icons/tech-logos/google_cloud_functions.svg"),
          // google_tag_manager: import("public/icons/tech-logos/google_tag_manager.svg"),
          graphql: import("public/icons/tech-logos/graphql.svg"),
          // grunt: import("public/icons/tech-logos/grunt.svg"),
          // gulp: import("public/icons/tech-logos/gulp.svg"),
          headlessui: import("public/icons/tech-logos/headlessui.svg"),
          // heroku: import("public/icons/tech-logos/heroku.svg"),
          // html_5: import("public/icons/tech-logos/html_5.svg"),
          // intellij_idea: import("public/icons/tech-logos/intellij_idea.svg"),
          // ionic: import("public/icons/tech-logos/ionic.svg"),
          javascript: import("public/icons/tech-logos/javascript.svg"),
          // jest: import("public/icons/tech-logos/jest.svg"),
          jsdom: import("public/icons/tech-logos/jsdom.svg"),
          markdown: import("public/icons/tech-logos/markdown.svg"),
          mdx: import("public/icons/tech-logos/mdx.svg"),
          // microsoft_windows: import("public/icons/tech-logos/microsoft_windows.svg"),
          // mysql: import("public/icons/tech-logos/mysql.svg"),
          nextjs: import("public/icons/tech-logos/nextjs.svg"),
          nodejs: import("public/icons/tech-logos/nodejs.svg"),
          // postcss: import("public/icons/tech-logos/postcss.svg"),
          // postgresql: import("public/icons/tech-logos/postgresql.svg"),
          planetscale: import("public/icons/tech-logos/planetscale.svg"),
          // postman: import("public/icons/tech-logos/postman.svg"),
          // preact: import("public/icons/tech-logos/preact.svg"),
          prettier: import("public/icons/tech-logos/prettier.svg"),
          prisma: import("public/icons/tech-logos/prisma.svg"),
          react: import("public/icons/tech-logos/react.svg"),
          // react_query: import("public/icons/tech-logos/react_query.svg"),
          // redis: import("public/icons/tech-logos/redis.svg"),
          // remix: import("public/icons/tech-logos/remix.svg"),
          sass: import("public/icons/tech-logos/sass.svg"),
          // sendgrid: import("public/icons/tech-logos/sendgrid.svg"),
          shopify: import("public/icons/tech-logos/shopify.svg"),
          // stylelint: import("public/icons/tech-logos/stylelint.svg"),
          // svg: import("public/icons/tech-logos/svg.svg"),
          swc: import("public/icons/tech-logos/swc.svg"),
          tailwindcss: import("public/icons/tech-logos/tailwindcss.svg"),
          // tailwindcss_long: import("public/icons/tech-logos/tailwindcss_long.svg"),
          // takealot: import("public/icons/tech-logos/takealot.svg"),
          trpc: import("public/icons/tech-logos/trpc.svg"),
          turborepo: import("public/icons/tech-logos/turborepo.svg"),
          typescript: import("public/icons/tech-logos/typescript.svg"),
          // uafrica: import("public/icons/tech-logos/uafrica.svg"),
          vend_pos: import("public/icons/tech-logos/vend_pos.svg"),
          vercel: import("public/icons/tech-logos/vercel.svg"),
          // vercelLong: import("public/icons/tech-logos/vercelLong.svg"),
          // vitejs: import("public/icons/tech-logos/vitejs.svg"),
          // web_dev: import("public/icons/tech-logos/web_dev.svg"),
          // webpack: import("public/icons/tech-logos/webpack.svg"),
          // yarn: import("public/icons/tech-logos/yarn.svg"),
        }[name];

        if (asyncImport) {
          // console.log(asyncImport, name);
          const mod = await asyncImport;
          console.log(mod);
          return asyncImport?.then((mod) => {
            if (Object.keys(mod).length === 1) {
              console.log("modkeys =1");
              return mod;
            }
            return mod[Object.keys(mod)[0]];
          });
        }
      } catch (err) {
        console.log(err.message);
        return null;
      }
    },
    {
      ssr: false,
    }
  );

  return <Icon {...props} />;
};

export type LocalSVGIcons =
  | "amp"
  | "android"
  | "apple"
  | "awesome"
  | "aws"
  | "aws_amplify"
  | "aws_lambda"
  | "axios"
  | "babel"
  | "chrome"
  | "css_3"
  | "emmet"
  | "eslint"
  | "facebook"
  | "figma"
  | "firebase"
  | "framer"
  | "git"
  | "github"
  | "github_copilot"
  | "google_analytics"
  | "google_cloud_functions"
  | "google_tag_manager"
  | "graphql"
  | "grunt"
  | "gulp"
  | "headlessui"
  | "heroku"
  | "html_5"
  | "intellij_idea"
  | "ionic"
  | "javascript"
  | "jest"
  | "jsdom"
  | "markdown"
  | "mdx"
  | "microsoft_windows"
  | "mysql"
  | "nextjs"
  | "nodejs"
  | "postcss"
  | "postgresql"
  | "planetscale"
  | "postman"
  | "preact"
  | "prettier"
  | "prisma"
  | "react"
  | "react_query"
  | "redis"
  | "remix"
  | "sass"
  | "sendgrid"
  | "shopify"
  | "stylelint"
  | "svg"
  | "swc"
  | "tailwindcss"
  | "tailwindcss_long"
  | "takealot"
  | "trpc"
  | "turborepo"
  | "typescript"
  | "uafrica"
  | "vend_pos"
  | "vercel"
  | "vercelLong"
  | "vitejs"
  | "web_dev"
  | "webpack"
  | "yarn";
