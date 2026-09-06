import { createFileRoute, Outlet } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { orpc } from "~/integrations/orpc";
import { CaptureOverlay, CaptureProvider, useCaptureStore } from "./-capture";
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
  return (
    <CaptureProvider>
      <PersonalOsShell />
    </CaptureProvider>
  );
}

function PersonalOsShell() {
  const { pool_count, today_count } = Route.useLoaderData();
  const [capture_open, setCaptureOpen] = useCaptureStore();
  const [palette_open, setPaletteOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key.toLowerCase() !== "k" || !(event.metaKey || event.ctrlKey)) {
        return;
      }

      event.preventDefault();

      // Capture gets its own key rather than living only behind the palette: two seconds is the budget,
      // and "open the palette, find the action, then type" spends most of it before the thought lands.
      if (event.shiftKey) {
        setPaletteOpen(false);
        setCaptureOpen((open) => !open);
        return;
      }

      setCaptureOpen(false);
      setPaletteOpen((open) => !open);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [setCaptureOpen]);

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
        {palette_open && (
          <CommandPalette
            actions={[{ id: "capture", label: "Capture a thought", run: () => setCaptureOpen(true) }]}
            onClose={() => setPaletteOpen(false)}
          />
        )}
        {capture_open && <CaptureOverlay />}
      </div>
    </div>
  );
}
