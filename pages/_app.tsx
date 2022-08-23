import { trpc } from "_client/_app/trpc";
import { ContextProviders } from "_client/_stores/_context-providers";
import { LoadInitialData } from "_client/_stores/_load-initial-data";
import DarkmodeIcon from "_client/darkmode-icon";
import { HeroIcon } from "_client/dynamic-hero-icon";
import { Link } from "_client/link";
import clsx from "clsx";
import { useTheme } from "next-themes";
import NextLink from "next/link";
import FlextLogo from "public/logo.svg";

import { AppProps } from "next/app";
import { useRouter } from "next/router";
import { FC, FocusEventHandler, Fragment, MouseEventHandler, PropsWithChildren, useCallback, useEffect, useRef, useState } from "react";
import "styles/tailwind.css";
import { getParentNodeByClass } from "utils/get-parent-node-by-class";

const Loaders: FC<PropsWithChildren> = ({ children }) => {
  return (
    <ContextProviders>
      <LoadInitialData>{children}</LoadInitialData>
    </ContextProviders>
  );
};

export const Logo = () => {
  return (
    <Link href="/">
      <FlextLogo />
    </Link>
  );
};

export const Settings = () => {
  const { theme, setTheme } = useTheme();

  return (
    <nav className="flex gap-4 pl-4">
      <div className="my-1 border-l border-l-gray-200"></div>
      <button
        type="button"
        className="rounded p-2 text-gray-700 transition-colors duration-700 hfa:bg-gray-200 dark:text-white"
        onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
      >
        <DarkmodeIcon />
      </button>
    </nav>
  );
};

const nav = [
  {
    title: "work",
    href: "/work",
  },
  {
    title: "Gallery",
    href: "/gallery",
  },
  {
    title: "Resume",
    href: "/resume",
  },
];

export const DesktopNav: FC = () => {
  const [initialNavPosition, setInitialNavPosition] = useState({
    width: 0,
    left: 0,
    opacity: 0,
    transition: "0.1s opacity",
  });
  const navHoverEffect = useRef<HTMLDivElement>();
  const router = useRouter();

  // const [navHover, setNavHover] = useState(initialNavPosition);

  const setNavHover = useCallback(({ width, left, opacity, transition }) => {
    const element = navHoverEffect.current;
    element.style.width = `${width}px`;
    element.style.left = `${left}px`;
    element.style.transition = transition;
    element.style.opacity = opacity;
  }, []);

  const handleNavHover: MouseEventHandler = useCallback((e) => {
    console.log(e.target, e.currentTarget);
    if (e.target === e.currentTarget) {
      setNavHover(initialNavPosition);
    }
    if (e.target !== e.currentTarget) {
      const navItemRef = getParentNodeByClass(e.target as HTMLElement, "nav-item");
      if (navItemRef) {
        setNavHover({
          width: navItemRef.offsetWidth,
          left: navItemRef.offsetLeft,
          opacity: 0.7,
          transition: +navHoverEffect.current.style.opacity ? "0.18s" : "0.1s opacity",
        });
      }
    }
  }, [initialNavPosition, setNavHover]);

  const handleNavFocus: FocusEventHandler<HTMLElement> = useCallback((e) => {
    if (!e?.currentTarget?.matches(":focus-within")) {
      setNavHover(initialNavPosition);
      return;
    }

    const navItemRef = getParentNodeByClass(e.target as HTMLElement, "nav-item");
    if (navItemRef) {
      setNavHover({
        width: navItemRef.offsetWidth,
        left: navItemRef.offsetLeft,
        opacity: 0.7,
        transition: +navHoverEffect.current.style.opacity ? "0.18s" : "0.1s opacity",
      });
    }
  }, [initialNavPosition, setNavHover]);

  const handleNavReset = useCallback(() => {
    setNavHover(initialNavPosition);
  }, [initialNavPosition, setNavHover]);

  return (
    <>
      <nav
        className="scrollbar-none header-nav mt-auto ml-auto hidden h-full overflow-auto px-2 md:flex"
        onBlur={handleNavFocus}
        onMouseLeave={handleNavReset}
        onMouseOver={handleNavHover}
      >
        <div
          ref={navHoverEffect}
          className="absolute top-1/2 z-0 h-8 -translate-y-1/2 transform rounded bg-sky-200/30 dark:bg-dark-card"
        />
        {nav.map((link, i) => {
          return (
            <div
              key={link.href + link.title + i}
              className={clsx(
                "nav-item relative flex py-4 text-sm",
                router.asPath.split(/[#?]/)[0] === link.href &&
                  "before:absolute b:bottom-0 b:left-3 b:h-[2px] b:w-[calc(100%-24px)] b:bg-gray-900 dark:b:bg-gray-400 "
              )}
            >
              <Link href={link.href}>
                <a
                  className="flex items-center justify-center overflow-hidden rounded py-1 px-3 text-sm font-medium hfa:text-gray-900 dark:hfa:text-white"
                  onFocus={handleNavFocus}
                >
                  {link.title}
                </a>
              </Link>
            </div>
          );
        })}
      </nav>
    </>
  );
};
const Header = () => {
  return (
    <>
      <header className="fixed inset-x-0 top-0 h-20 w-full border-b border-b-gray-100 bg-white/50 backdrop-blur">
        <div className="mx-auto flex h-full max-w-7xl items-center justify-between gap-4 px-8 py-2">
          <Logo />
          <DesktopNav />
          <Settings />
        </div>
      </header>
      <div className="pointer-events-none h-20 select-none transition" />
    </>
  );
};

const Footer = () => {
  return <>asd</>;
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
