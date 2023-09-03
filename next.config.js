/**
 * @type {import('next').NextConfig}
 */
const path = require("path");
const withBundleAnalyzer = require("@next/bundle-analyzer")({
  enabled: process.env.ANALYZE === "true",
});

module.exports = withBundleAnalyzer({
  swcMinify: true,
  reactStrictMode: false,
  productionBrowserSourceMaps: true,
  images: {
    dangerouslyAllowSVG: true,
    deviceSizes: [320, 460, 540, 640, 750, 828, 1080, 1200, 1920, 2048, 3840],
    domains: [
      "assets.vercel.com",
      "avatars1.githubusercontent.com",
      "avatars.githubusercontent.com",
      "cdn.shopify.com",
      "burst.shopifycdn.com",
      "images.unsplash.com",
      "pbs.twimg.com",
      "images-na.ssl-images-amazon.com",
      "m.media-amazon.com",
    ],
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
});
