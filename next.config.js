/**
 * @type {import('next').NextConfig}
 */
const path = require("path");
const withBundleAnalyzer = require("@next/bundle-analyzer")({
  enabled: process.env.ANALYZE === "true",
});

module.exports = withBundleAnalyzer({
  swcMinify: true,
  reactStrictMode: true,
  productionBrowserSourceMaps: true,
  images: {
    dangerouslyAllowSVG: true,
    deviceSizes: [460, 640, 750, 828, 1080, 1200, 1920, 2048, 3840],
    domains: [
      "assets.vercel.com",
      "avatars1.githubusercontent.com",
      "avatars.githubusercontent.com",
      "cdn.shopify.com",
      "burst.shopifycdn.com",
      "images.unsplash.com",
      "pbs.twimg.com",
    ],
  },
  async headers() {
    return [
      {
        // matching all API routes
        source: "/api/:path*",
        headers: [
          { key: "Access-Control-Allow-Credentials", value: "true" },
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Access-Control-Allow-Methods", value: "GET,OPTIONS,PATCH,DELETE,POST,PUT" },
          {
            key: "Access-Control-Allow-Headers",
            value:
              "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version",
          },
        ],
      },
    ];
  },
  webpack: (config, { isServer, dev }) => {
    /*
    if (!dev && !isServer) {
      Object.assign(config.resolve.alias, {
        "react/jsx-runtime.js": "preact/compat/jsx-runtime",
        react: "preact/compat",
        "react-dom/test-utils": "preact/test-utils",
        "react-dom": "preact/compat",
      });
    }
    */

    if (isServer) {
      // eslint-disable-next-line node/no-missing-require
      // require("./scripts/create-components-export-index");
    }
    if (!isServer) {
      config.resolve.fallback.fs = false;
      config.resolve.fallback.tls = false;
      config.resolve.fallback.net = false;
      config.resolve.fallback.http = false;
      config.resolve.fallback.https = false;
      config.resolve.fallback.cardinal = false;
    }

    const fileLoaderRule = config.module.rules.find((rule) => rule.test && rule.test.test(".svg"));
    fileLoaderRule.exclude = /\.svg$/;
    config.module.rules.push({
      test: /\.svg$/,
      loader: require.resolve("@svgr/webpack"),
    });

    return config;
  },
  experimental: {
    externalDir: true,
    images: { allowFutureImage: true },
  },
  env: {
    ...this.env,
    NEXT_PUBLIC_APP_VERSION: require("./package.json").version,
  },
});
