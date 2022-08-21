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
        <body className="color-gray--slate">
          <Main />
          <NextScript />
        </body>
      </Html>
    );
  }
}

export default Root;
