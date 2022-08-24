import { trpc } from "_client/_app/trpc";
import { ContextProviders } from "_client/_stores/_context-providers";
import { LoadInitialData } from "_client/_stores/_load-initial-data";
import { Link } from "_client/link";

import { Footer } from "components/layout/footer";
import { Header } from "components/layout/header";

import { AppProps } from "next/app";
import { useRouter } from "next/router";
import FlextLogo from "public/logo.svg";
import { FC, PropsWithChildren, useEffect, useState } from "react";
import "styles/tailwind.css";

const Loaders: FC<PropsWithChildren> = ({ children }) => {
  return (
    <ContextProviders>
      <LoadInitialData>{children}</LoadInitialData>
    </ContextProviders>
  );
};

const App = ({ pageProps, Component }: AppProps) => {
  const router = useRouter();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (window) {
      setLoading(false);
    }
  }, []);

  if (loading) {
    return <></>;
  }
  console.log(pageProps);

  return (
    <Loaders>
      <Header />
      <main className="min-h-[200vh]">
        <Component {...pageProps} />
      </main>
      <Footer />
    </Loaders>
  );
};

export default trpc.withTRPC(App);
