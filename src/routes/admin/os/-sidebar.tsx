import {
  ArchiveBoxIcon,
  CalendarDaysIcon,
  ChartBarIcon,
  ClockIcon,
  MagnifyingGlassIcon,
  RectangleStackIcon,
  Squares2X2Icon,
  SunIcon,
} from "@heroicons/react/24/outline";
import { Link, useMatchRoute } from "@tanstack/react-router";
import clsx from "clsx";
import type { FC } from "react";

// The sidebar and the command palette both read this, so the two surfaces cannot disagree about which
// screens exist. Week, Goals and Habits are drawn in the design canvas but have no
// route yet — they arrive with the phases that give them something to show.
export const os_screens = [
  { Icon: SunIcon, label: "Today", to: "/admin/os" },
  { Icon: RectangleStackIcon, label: "Week pool", to: "/admin/os/pool" },
  { Icon: Squares2X2Icon, label: "Areas", to: "/admin/os/areas" },
  { Icon: ChartBarIcon, label: "Ledger", to: "/admin/os/ledger" },
  { Icon: CalendarDaysIcon, label: "Weekly review", to: "/admin/os/review" },
  // Not on the design canvas, which predates it. Added because "cancel to logbook" is only a real
  // exit if the logbook is reachable — otherwise the fourth disposition looks like deletion.
  { Icon: ArchiveBoxIcon, label: "Logbook", to: "/admin/os/logbook" },
] as const;

// A count is the reason the sidebar earns 240px over a row of tabs: it says how much is waiting without
// asking you to go and look. A screen with nothing to count is a plain link, and that is fine.
export const Sidebar: FC<{ onOpenPalette: () => void; pool_count: number; today_count: number }> = ({
  onOpenPalette,
  pool_count,
  today_count,
}) => {
  const matchRoute = useMatchRoute();
  const counts: Partial<Record<(typeof os_screens)[number]["to"], number>> = {
    "/admin/os": today_count,
    "/admin/os/pool": pool_count,
  };

  return (
    <nav className="flex w-60 flex-shrink-0 flex-col border-gray-200 border-r bg-bg-secondary px-3 py-5 dark:border-dark-border dark:bg-dark-bg">
      <div className="flex items-center gap-2 px-2 pb-5">
        <ClockIcon className="h-[18px] w-[18px] text-accent dark:text-accent-dark" />
        <span className="font-bold text-gray-900 text-sm dark:text-dark-headings">Personal OS</span>
      </div>

      <button
        className="mx-1 mb-3.5 flex items-center gap-2 rounded border border-gray-300 bg-bg px-2.5 py-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info dark:border-dark-border dark:bg-dark-bg"
        onClick={() => onOpenPalette()}
        type="button"
      >
        <MagnifyingGlassIcon className="h-3.5 w-3.5 text-gray-500 dark:text-dark-text" />
        <span className="flex-grow text-left text-[13px] text-gray-400 dark:text-dark-text">Jump to&hellip;</span>
        <span className="rounded-sm border border-gray-200 px-1 text-[11px] text-gray-500 dark:border-dark-border dark:text-dark-text">
          &#8984;K
        </span>
      </button>

      <div className="flex flex-col gap-0.5">
        {os_screens.map((screen) => {
          const active = matchRoute({ fuzzy: false, to: screen.to }) !== false;
          const count = counts[screen.to];

          return (
            <Link
              className={clsx(
                "flex items-center gap-2.5 rounded px-2 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info",
                active ? "bg-accent font-medium text-white dark:bg-accent-dark dark:text-dark-bg" : "text-gray-600 dark:text-dark-text",
              )}
              key={screen.to}
              to={screen.to}
            >
              <screen.Icon className="h-[18px] w-[18px]" />
              <span className="flex-grow">{screen.label}</span>
              {count !== undefined && (
                <span className={clsx("text-xs", active ? "text-white/85 dark:text-dark-bg/85" : "text-gray-500 dark:text-dark-text")}>
                  {count}
                </span>
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
};
