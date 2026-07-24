import { SiGithub } from "@react-icons/all-files/si/SiGithub";
import clsx from "clsx";
import type { FC } from "react";
import DarkmodeIcon from "~/components/darkmode-icon";
import { Link } from "~/components/link";
import { useTheme } from "~/components/theme-provider";

type ProfileNavProps = {
  showNav: boolean;
};

export const ProfileNav: FC<ProfileNavProps> = ({ showNav }) => {
  const { theme, setTheme } = useTheme();

  return (
    <nav className="z-10 ml-auto flex gap-1 pl-4">
      {/*<div className="my-2 mx-4 border-l border-l-gray-200"></div>*/}
      <button
        type="button"
        className={clsx(
          "rounded p-2 d:h:text-gray-50 d:text-gray-300 text-gray-500 transition-colors md:h:text-gray-900",
          showNav ? "h:text-gray-200" : "h:text-gray-900",
        )}
        onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
      >
        <span className="sr-only">Switch Color Theme</span>
        <DarkmodeIcon />
      </button>
      <Link
        href="https://github.com/FelixTellmann"
        className={clsx(
          "rounded p-2 d:h:text-gray-50 d:text-gray-300 text-gray-500 transition-colors md:h:text-gray-900",
          showNav ? "h:text-gray-200" : "h:text-gray-900",
        )}
      >
        <span className="sr-only">Github</span>
        <SiGithub className="h-5 w-5" />
      </Link>
      <Link
        target="_blank"
        href="mailto:hello@flext.dev"
        className="button-rainbow ml-4 hidden whitespace-nowrap px-4 py-1.5 font-medium text-gray-500 text-sm tracking-tight md:flex"
      >
        Lets work
      </Link>
    </nav>
  );
};
