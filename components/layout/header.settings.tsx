import { SiGithub } from "@react-icons/all-files/si/SiGithub";
import { Link } from "components/link";
import clsx from "clsx";
import DarkmodeIcon from "components/darkmode-icon";
import { useTheme } from "next-themes";
import { FC } from "react";

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
          "rounded p-2 text-gray-500 transition-colors d:text-gray-300 d:h:text-gray-50 md:h:text-gray-900",
          showNav ? "h:text-gray-200" : "h:text-gray-900"
        )}
        onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
      >
        <span className="sr-only">Switch Color Theme</span>
        <DarkmodeIcon />
      </button>
      <Link
        href="https://github.com/FelixTellmann"
        className={clsx(
          "rounded p-2 text-gray-500 transition-colors d:text-gray-300 d:h:text-gray-50 md:h:text-gray-900",
          showNav ? "h:text-gray-200" : "h:text-gray-900"
        )}
      >
        <span className="sr-only">Github</span>
        <SiGithub className="h-5 w-5" />
      </Link>
      <Link
        target="_blank"
        href="mailto:hello@flext.dev"
        className="button-rainbow ml-4 hidden whitespace-nowrap px-4 py-1.5 text-sm font-medium tracking-tight text-gray-500 md:flex"
      >
        Lets work
      </Link>
    </nav>
  );
};
