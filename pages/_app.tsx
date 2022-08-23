import { trpc } from "_client/_app/trpc";
import { ContextProviders } from "_client/_stores/_context-providers";
import { LoadInitialData } from "_client/_stores/_load-initial-data";
import DarkmodeIcon from "_client/darkmode-icon";
import { HeroIcon } from "_client/dynamic-hero-icon";
import { ReactIcon } from "_client/dynamic-react-icon";
import { Link } from "_client/link";
import clsx from "clsx";
import { SOCIAL } from "content/social";
import { useTheme } from "next-themes";
import NextLink from "next/link";
import FlextLogo from "public/logo.svg";

import { AppProps } from "next/app";
import { useRouter } from "next/router";
import { FC, FocusEventHandler, Fragment, MouseEventHandler, PropsWithChildren, useCallback, useEffect, useRef, useState } from "react";
import "styles/tailwind.css";
import { getParentNodeByClass, getParentNodeByTag } from "utils/get-parent-node-by-class";

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
    <nav className="flex gap-1 pl-4">
      <button className="button-hero">Lets work together</button>
      <div className="my-2 mx-4 border-l border-l-gray-200"></div>
      <button
        type="button"
        className="rounded p-2 text-gray-500 transition-colors h:text-gray-900 dark:text-white"
        onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
      >
        <DarkmodeIcon />
      </button>
      <Link
        href={SOCIAL.github.href}
        className="rounded p-2 text-gray-500 transition-colors h:text-gray-900 dark:text-white"
      >
        <span className="sr-only">Github</span>
        <ReactIcon name="FaGithub" className="h-5 w-5" />
      </Link>
    </nav>
  );
};

const nav = [
  {
    title: "Work",
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

const HoverEffect: FC<{ className?: string }> = ({
  className = "bg-slate-200/75 dark:bg-dark-card",
}) => {
  const [initialNavPosition, setInitialNavPosition] = useState({
    width: 0,
    height: 0,
    left: 0,
    opacity: 0,
    transition: "0.1s opacity",
    borderRadius: 0,
  });
  const navHoverEffect = useRef<HTMLDivElement>();

  // const [navHover, setNavHover] = useState(initialNavPosition);

  const setNavHover = useCallback(({ width, left, opacity, transition, height, borderRadius }) => {
    const element = navHoverEffect.current;
    element.style.width = `${width}px`;
    element.style.height = `${height}px`;
    element.style.left = `${left}px`;
    element.style.transition = transition;
    element.style.opacity = opacity;
    element.style.borderRadius = borderRadius;
  }, []);

  const handleNavHover = useCallback((e) => {
    if (e.target === e.currentTarget) {
      setNavHover(initialNavPosition);
    }
    if (e.target !== e.currentTarget) {
      const navItemRef = getParentNodeByTag(e.target as HTMLElement, "A");

      if (navItemRef) {
        setNavHover({
          width: navItemRef.offsetWidth,
          height: navItemRef.offsetHeight,
          left: navItemRef.offsetLeft,
          opacity: 0.7,
          borderRadius: getComputedStyle(navItemRef).borderRadius,
          transition: +navHoverEffect.current.style.opacity ? "0.18s" : "0.1s opacity",
        });
      }
    }
  }, [initialNavPosition, setNavHover]);

  const handleNavFocus = useCallback((e) => {
    if (!e?.currentTarget?.matches(":focus-within")) {
      setNavHover(initialNavPosition);
      return;
    }

    const navItemRef = getParentNodeByTag(e.target as HTMLElement, "A");
    if (navItemRef) {
      setNavHover({
        width: navItemRef.offsetWidth,
        height: navItemRef.offsetHeight,
        left: navItemRef.offsetLeft,
        borderRadius: getComputedStyle(navItemRef).borderRadius,
        opacity: 0.7,
        transition: +navHoverEffect.current.style.opacity ? "0.18s" : "0.1s opacity",
      });
    }
  }, [initialNavPosition, setNavHover]);

  const handleNavReset = useCallback(() => {
    setNavHover(initialNavPosition);
  }, [initialNavPosition, setNavHover]);

  useEffect(() => {
    const parent = navHoverEffect.current.parentElement;
    const links = navHoverEffect.current.parentElement.querySelectorAll("a");
    parent.addEventListener("blur", handleNavFocus);
    parent.addEventListener("mouseover", handleNavHover);
    parent.addEventListener("mouseleave", handleNavReset);
    links.forEach((link) => {
      link.addEventListener("focus", handleNavFocus);
    });

    return () => {
      parent.removeEventListener("blur", handleNavFocus);
      parent.removeEventListener("mouseover", handleNavHover);
      parent.removeEventListener("mouseleave", handleNavReset);
      links.forEach((link) => {
        link.removeEventListener("focus", handleNavFocus);
      });
    };
  }, [handleNavFocus, handleNavHover, handleNavReset]);

  return (
    <div
      ref={navHoverEffect}
      className={clsx(
        "pointer-events-none absolute top-1/2 -z-20 -translate-y-1/2 transform select-none",
        className
      )}
    />
  );
};

export const DesktopNav: FC = () => {
  const router = useRouter();
  return (
    <>
      <nav className="scrollbar-none header-nav relative isolate mt-auto hidden h-full overflow-auto px-2 md:flex">
        <HoverEffect />
        {nav.map((link, i) => {
          return (
            <div className="my-auto flex h-full items-center px-2" key={link.href + link.title + i}>
              <Link
                href={link.href}
                className={clsx(
                  "relative relative z-10 my-auto flex rounded-full border border-transparent py-1.5 px-4 text-gray-600  [--rainbow-width:1px] before:absolute hfa:text-gray-900",
                  router.asPath.split(/[#?]/)[0] === link.href && "border-gray-200 bg-gray-100/40"
                )}
              >
                <span className="text-sm font-medium ">{link.title}</span>
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
        <div className="mx-auto flex h-full max-w-7xl items-center justify-between gap-4 px-8">
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
