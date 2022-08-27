// eslint-disable-next-line @next/next/no-document-import-in-page
import { Favicon } from "_client/_document/favicon";
import { Font } from "_client/_document/font";
import Document, { Head, Html, Main, NextScript } from "next/document";

class Root extends Document {
  render(): JSX.Element {
    // language=JavaScript
    return (
      <Html lang="en">
        <Head>
          <Favicon />
          <Font />
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
