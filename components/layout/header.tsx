import { Link } from "components/link";
import { DesktopNav } from "components/layout/header.desktop-nav";
import { MobileNav } from "components/layout/header.mobile-nav";
import { ProfileNav } from "components/layout/header.settings";
import { HEADER } from "content/layout";
import { FC, useState } from "react";

export const Header: FC = ({}) => {
  const [showNav, setShowNav] = useState(false);

  return (
    <>
      <header className="fixed inset-x-0 top-0 z-50 h-20 w-full border-b border-gray-800/10 bg-white/50 backdrop-blur d:border-gray-100/10 d:bg-gray-900/40 print:hidden">
        <div className="mx-auto flex h-full max-w-6xl grid-cols-[210px_1fr_210px] items-center gap-1 px-4 md:grid md:gap-4 md:px-8">
          <Link
            href="/"
            className="z-10 w-min"
            data-tip={"Hi, I'm Felix. Welcome to my site."}
            data-delay-show={2000}
          >
            <span className="sr-only">Flext.dev Logo</span>
            {HEADER.logo.title}
          </Link>
          <DesktopNav />
          <ProfileNav showNav={showNav} />
          <MobileNav showNav={showNav} setShowNav={setShowNav} /> {/* md:hidden */}
        </div>
        <div className="background pointer-events-none absolute inset-0 z-0 select-none ">
          {/*<div className="absolute bottom-0 h-px w-full bg-[linear-gradient(90deg,var(--line-color),var(--line-color)_50%,transparent_0,transparent)] bg-[length:8px_1px] d:[--line-color:theme(colors.gray.700/20)]" />*/}
          {/*<div className="relative mx-auto grid h-full max-w-6xl grid-cols-4 px-4">
            <div className="h-full w-px bg-[color:var(--line-color)] bg-[length:1px_8px]" />
            <div className="h-full w-px bg-[linear-gradient(180deg,var(--line-color),var(--line-color)_50%,transparent_0,transparent)] bg-[length:1px_8px]" />
            <div className="h-full w-px bg-[linear-gradient(180deg,var(--line-color),var(--line-color)_50%,transparent_0,transparent)] bg-[length:1px_8px]" />
            <div className="h-full w-px bg-[linear-gradient(180deg,var(--line-color),var(--line-color)_50%,transparent_0,transparent)] bg-[length:1px_8px]" />
            <div className="absolute right-4 top-0 h-full w-px bg-[color:var(--line-color)] bg-[length:1px_8px]" />
          </div>*/}
        </div>
      </header>
      <div className="pointer-events-none h-20 select-none transition print:hidden" />
    </>
  );
};
