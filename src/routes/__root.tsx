import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { SEO } from "content/seo";
import { type FC, type PropsWithChildren, useEffect } from "react";
import { Footer } from "~/components/layout/footer";
import { Header } from "~/components/layout/header";
import { ContextProviders } from "~/stores/_context-providers";
import { LoadInitialData } from "~/stores/_load-initial-data";

const RootDocument: FC<PropsWithChildren> = ({ children }) => {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta content="width=device-width, initial-scale=1" name="viewport" />
        <meta content="strict-origin-when-cross-origin" name="referrer" />
        <HeadContent />

        {/* Favicons */}
        <link href="/favicon/apple-icon-57x57.png" rel="apple-touch-icon" sizes="57x57" />
        <link href="/favicon/apple-icon-60x60.png" rel="apple-touch-icon" sizes="60x60" />
        <link href="/favicon/apple-icon-72x72.png" rel="apple-touch-icon" sizes="72x72" />
        <link href="/favicon/apple-icon-76x76.png" rel="apple-touch-icon" sizes="76x76" />
        <link href="/favicon/apple-icon-114x114.png" rel="apple-touch-icon" sizes="114x114" />
        <link href="/favicon/apple-icon-120x120.png" rel="apple-touch-icon" sizes="120x120" />
        <link href="/favicon/apple-icon-144x144.png" rel="apple-touch-icon" sizes="144x144" />
        <link href="/favicon/apple-icon-152x152.png" rel="apple-touch-icon" sizes="152x152" />
        <link href="/favicon/apple-icon-180x180.png" rel="apple-touch-icon" sizes="180x180" />
        <link href="/favicon/android-icon-192x192.png" rel="icon" sizes="192x192" type="image/png" />
        <link href="/favicon/favicon-32x32.png" rel="icon" sizes="32x32" type="image/png" />
        <link href="/favicon/favicon-96x96.png" rel="icon" sizes="96x96" type="image/png" />
        <link href="/favicon/favicon-16x16.png" rel="icon" sizes="16x16" type="image/png" />
        <link href="/favicon/manifest.json" rel="manifest" />
        <meta content="#ffffff" name="msapplication-TileColor" />
        <meta content="/ms-icon-144x144.png" name="msapplication-TileImage" />
        <meta content="#ffffff" name="theme-color" />

        {/* Font preload */}
        <link as="font" crossOrigin="anonymous" href="/fonts/inter-var-latin.woff2" rel="preload" type="font/woff2" />

        {/* Analytics (production only) */}
        {import.meta.env.PROD && (
          <script
            async
            defer
            src="https://flext-analytics.vercel.app/umami.js"
            data-website-id="69aaf2ad-a456-4a0e-9d99-b31687decc50"
            data-host-url="https://flext-analytics.vercel.app"
          />
        )}

        {/* Theme anti-flash script */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("theme");var d=t==="dark"||(t!=="light"&&window.matchMedia("(prefers-color-scheme:dark)").matches);document.documentElement.classList.toggle("dark",d)}catch(e){}})()`,
          }}
        />
      </head>
      <body className="color-gray--slate bg-white d:bg-gradient-to-b d:bg-gray-900 d:from-black/40 d:to-black/40 [--line-color:theme(colors.gray.200/0.8)]">
        {children}
        <Scripts />
      </body>
    </html>
  );
};

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { title: SEO.title },
      { name: "description", content: SEO.description },
      { property: "og:title", content: SEO.openGraph.title },
      { property: "og:type", content: SEO.openGraph.type },
      { property: "og:url", content: SEO.openGraph.url },
      { property: "og:site_name", content: SEO.openGraph.site_name },
      { property: "og:description", content: SEO.openGraph.description },
      { property: "og:image", content: SEO.openGraph.images[0].url },
      { name: "twitter:card", content: SEO.twitter.cardType },
      { name: "twitter:site", content: SEO.twitter.site },
      { name: "twitter:creator", content: SEO.twitter.handle },
    ],
  }),
  component: RootComponent,
});

function RootComponent() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") {
      console.log(
        "%cHEY YOU! I see you sneaking in my code. This Page is custom built by Felix Tellmann. I mainly used TanStack Start, TailwindCSS, Typescript, and ORPC as the main tech here. It's something I've worked hard on so please do not copy it directly. LEARN FROM IT AND MAKE IT YOUR OWN. Questions? Just drop me an email at hello@flext.dev!",
        "background: rgb(0,0,0);color: #fafafa;font-size: 24px;font-weight: bold;padding: 25px 10px;text-align: center;text-shadow: 2px 2px 0 rgba(45, 45, 45);",
      );
    }
  }, []);

  return (
    <RootDocument>
      <ContextProviders>
        <LoadInitialData>
          <Header />
          <main className="print:!mx-auto print:!w-[1024px] min-h-screen">
            <Outlet />
          </main>
          <Footer />
        </LoadInitialData>
      </ContextProviders>
    </RootDocument>
  );
}
