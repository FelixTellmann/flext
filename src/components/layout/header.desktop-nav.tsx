import { useLocation } from "@tanstack/react-router";
import clsx from "clsx";
import { HEADER } from "content/layout";
import type { FC } from "react";
import { HoverEffect } from "~/components/layout/header.desktop-nav.hover-effect";
import { Link } from "~/components/link";

export const DesktopNav: FC = () => {
  const location = useLocation();
  return (
    <>
      <nav className="sm:scrollbar-none header-nav group relative isolate mt-auto hidden h-full justify-center overflow-auto px-2 md:flex">
        <HoverEffect />
        {HEADER.nav
          .filter(({ desktop }) => desktop)
          .map((link, i) => {
            const isActive = location.pathname.split(/[#?]/)[0] === link.href;
            return (
              <div className="my-auto flex h-full items-center px-2" key={link.href + link.title + i}>
                <Link
                  href={link.href}
                  className={clsx(
                    "relative z-10 flex rounded-md border-2 border-transparent px-4 py-1.5 d:hfa:text-gray-50 d:text-gray-300 hfa:text-gray-900 text-gray-500 hfa:outline-none outline-none transition-all",
                    isActive && "border-gray-700/5 d:border-gray-50/10 bg-gray-100 d:bg-gray-800 bg-clip-padding group-hfa:bg-gray-200/30",
                  )}
                >
                  <span className="font-medium text-sm">{link.title}</span>
                </Link>
              </div>
            );
          })}
      </nav>
    </>
  );
};
