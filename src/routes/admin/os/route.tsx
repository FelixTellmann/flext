import { createFileRoute, Outlet } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { orpc } from "~/integrations/orpc";
import { CommandPalette } from "./-command-palette";
import { Sidebar } from "./-sidebar";

// Chrome only. `src/routes/admin/route.tsx` already refuses anyone but the admin in its beforeLoad, and
// a second gate here would be one more place for the two to drift apart.
export const Route = createFileRoute("/admin/os")({
  loader: async () => {
    const { plan_week } = await orpc.personalTasks.currentWeek();
    const [today, pool] = await Promise.all([orpc.personalTasks.listToday(), orpc.personalTasks.listPool({ plan_week })]);

    return { plan_week, pool_count: pool.length, today_count: today.committed.length };
  },
  component: PersonalOsLayout,
});

function PersonalOsLayout() {
  const { pool_count, today_count } = Route.useLoaderData();
  const [palette_open, setPaletteOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "k" || !(event.metaKey || event.ctrlKey)) {
        return;
      }

      event.preventDefault();
      setPaletteOpen((open) => !open);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // The site header is fixed at 80px and reserves its own spacer, so subtracting it is what makes this a
  // shell that fills what is left of the viewport rather than one that hangs off the bottom of it.
  return (
    <div className="flex h-[calc(100vh-theme(spacing.header))] bg-bg dark:bg-dark-bg">
      <Sidebar onOpenPalette={() => setPaletteOpen(true)} pool_count={pool_count} today_count={today_count} />
      <div className="relative flex-grow overflow-hidden">
        <div className="h-full overflow-y-auto">
          <div className="mx-auto flex max-w-4xl flex-col gap-6 p-6">
            <Outlet />
          </div>
        </div>
        {palette_open && <CommandPalette actions={[]} onClose={() => setPaletteOpen(false)} />}
      </div>
    </div>
  );
}
