// eslint-disable-next-line @next/next/no-document-import-in-page
import { Favicon } from "_client/_document/favicon";
import { Font } from "_client/_document/font";
import Document, { Head, Html, Main, NextScript } from "next/document";
import Script from "next/script";

class Root extends Document {
  render(): JSX.Element {
    // language=JavaScript
    return (
      <Html lang="en">
        <Head>
          <Favicon />
          <Font />

          <Script
            async
            defer
            src="https://flext-analytics.vercel.app/umami.js"
            strategy="lazyOnload"
            data-website-id="69aaf2ad-a456-4a0e-9d99-b31687decc50"
          />
        </Head>
        <body className="color-gray--slate bg-white [--line-color:theme(colors.gray.200/0.8)] d:bg-gray-900 d:bg-gradient-to-b d:from-black/40 d:to-black/40">
          <Main />
          <NextScript />
        </body>
      </Html>
    );
  }
}

export default Root;
