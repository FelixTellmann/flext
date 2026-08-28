import { readSession } from "@server/auth/session";
import { createFileRoute, Outlet, redirect, useLocation } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import type { FC } from "react";

const fetchSession = createServerFn({ method: "POST" }).handler(async () => {
  return readSession();
});

const AdminLayout: FC = () => {
  const { session } = Route.useRouteContext();
  const in_personal_os = useLocation({ select: (location) => location.pathname.startsWith("/admin/os") });

  // The personal OS brings its own full-bleed shell, sidebar and identity. Stacking this centred column
  // and its "Admin" heading on top would give it two headers and pull the sidebar off the edge it needs.
  if (in_personal_os) {
    return <Outlet />;
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <header className="mb-8 flex items-baseline justify-between border-zinc-200 border-b pb-4 dark:border-dark-border">
        <h1 className="font-semibold text-lg text-zinc-800 dark:text-dark-headings">Admin</h1>
        <span className="text-sm text-zinc-500 dark:text-dark-text">{session.email}</span>
      </header>
      <Outlet />
    </div>
  );
};

export const Route = createFileRoute("/admin")({
  beforeLoad: async () => {
    const session = await fetchSession();

    if (!session) {
      throw redirect({ to: "/auth/sign-in" });
    }

    return { session };
  },
  component: AdminLayout,
});
