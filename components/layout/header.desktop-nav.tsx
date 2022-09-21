import { Link } from "components/link";
import clsx from "clsx";
import { HoverEffect } from "components/layout/header.desktop-nav.hover-effect";

import { HEADER } from "content/layout";
import { useRouter } from "next/router";
import { FC } from "react";

export const DesktopNav: FC = () => {
  const router = useRouter();
  return (
    <>
      <nav className="sm:scrollbar-none header-nav group relative isolate mt-auto hidden h-full justify-center overflow-auto px-2 md:flex">
        <HoverEffect />
        {HEADER.nav
          .filter(({ desktop }) => desktop)
          .map((link, i) => {
            const isActive = router.asPath.split(/[#?]/)[0] === link.href;
            return (
              <div
                className="my-auto flex h-full items-center px-2"
                key={link.href + link.title + i}
              >
                <Link
                  href={link.href}
                  className={clsx(
                    "relative z-10 flex rounded-md border-2 border-transparent py-1.5 px-4 text-gray-500 outline-none transition-all hfa:text-gray-900 hfa:outline-none d:text-gray-300 d:hfa:text-gray-50",
                    isActive &&
                      "border-gray-700/5 bg-gray-100 bg-clip-padding d:border-gray-50/10 d:bg-gray-800 group-hfa:bg-gray-200/30"
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
