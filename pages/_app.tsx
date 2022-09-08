import { trpc } from "_client/_app/trpc";
import { ContextProviders } from "_client/_stores/_context-providers";
import { LoadInitialData } from "_client/_stores/_load-initial-data";

import { Footer } from "components/layout/footer";
import { Header } from "components/layout/header";
import { SEO } from "content/seo";
import { DefaultSeo } from "next-seo";
import { useTheme } from "next-themes";

import { AppProps } from "next/app";
import { useRouter } from "next/router";
import { FC, PropsWithChildren, useEffect, useRef, useState } from "react";
import "styles/tailwind.css";

const Loaders: FC<PropsWithChildren> = ({ children }) => {
  return (
    <ContextProviders>
      <LoadInitialData>{children}</LoadInitialData>
    </ContextProviders>
  );
};

const Stars = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const theme = useTheme();

  console.log(theme);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const canvasContext = canvas.getContext("2d") as CanvasRenderingContext2D;

    let width;
    let height;

    const setCanvasExtents = () => {
      width = document.body.clientWidth;
      height = document.body.clientHeight;
      canvas.width = width;
      canvas.height = height;
    };

    setCanvasExtents();

    window.onresize = () => {
      setCanvasExtents();
    };

    const makeStars = (count) => {
      const out: { x: number; y: number; z: number }[] = [];
      for (let i = 0; i < count; i++) {
        const star = {
          x: Math.random() * 1600 - 800,
          y: Math.random() * 900 - 450,
          z: Math.random() * 1000,
        };
        out.push(star);
      }
      return out;
    };

    const stars = makeStars(200);

    const clear = () => {
      canvasContext.fillStyle = theme.theme === "light" ? "white" : "#090d18";
      canvasContext.fillRect(0, 0, canvas.width, canvas.height);
    };

    const putPixel = (x, y, brightness) => {
      const intensity = brightness * 255;
      const rgb = `rgb(${intensity},${intensity},${intensity})`;
      canvasContext.fillStyle = rgb;
      canvasContext.fillRect(x, y, 1, 1);
    };

    const moveStars = (distance) => {
      const count = stars.length;
      for (let i = 0; i < count; i++) {
        const s = stars[i];
        s.z -= distance;
        while (s.z <= 1) {
          s.z += 2000;
        }
      }
    };

    let prevTime;
    const init = (time) => {
      prevTime = time;
      requestAnimationFrame(tick);
    };

    const tick = (time) => {
      const elapsed = time - prevTime;
      prevTime = time;

      moveStars(elapsed * 0.1);

      clear();

      const cx = width / 2;
      const cy = height / 2;

      const count = stars.length;
      for (let i = 0; i < count; i++) {
        const star = stars[i];

        const x = cx + star.x / (star.z * 0.001);
        const y = cy + star.y / (star.z * 0.001);

        if (x < 0 || x >= width || y < 0 || y >= height) {
          continue;
        }

        const d = star.z / 1000.0;
        const b = 1 - d * d;

        putPixel(x, y, b);
      }

      requestAnimationFrame(tick);
    };

    requestAnimationFrame(init);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none fixed inset-0 -z-50 h-full w-full select-none"
    />
  );
};

const App = ({ pageProps, Component }: AppProps) => {
  const router = useRouter();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (window) {
      setLoading(false);
      if (process.env.NODE_ENV !== "development") {
        console.log(
          "%cHEY YOU! I see you sneaking in my code. This Page is custom built by Felix Tellmann. I mainly used Next.js, TailwindCSS, Typescript, Vercel, and TRPC as the main tech here. It's something I've worked hard on so please do not copy it directly. LEARN FROM IT AND MAKE IT YOUR OWN. Questions? Just drop me an email at hello@flext.dev! You can find the repo learning purposes for the site here: https://github.com/FelixTellmann/flext",
          "background: rgb(0,0,0);color: #fafafa;font-size: 24px;font-weight: bold;padding: 25px 10px;text-align: center;text-shadow: 2px 2px 0 rgba(45, 45, 45);"
        );
      }
    }
  }, []);

  if (loading) {
    return <></>;
  }

  return (
    <Loaders>
      <DefaultSeo
        {...SEO}
        canonical={`${SEO.url}${router.asPath}`}
        twitter={SEO.twitter}
        title={SEO.title}
        description={SEO.description}
        openGraph={SEO.openGraph}
      />
      <Header />
      <main className="min-h-screen">
        <Component {...pageProps} />
      </main>
      <Footer />
      {/*<Stars />*/}
    </Loaders>
  );
};

export default trpc.withTRPC(App);
