import { readSession } from "@server/auth/session";
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import type { FC } from "react";

const fetchSession = createServerFn({ method: "GET" }).handler(async () => {
  return readSession();
});

const AdminLayout: FC = () => {
  const { session } = Route.useRouteContext();

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
