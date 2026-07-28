import { createFileRoute } from "@tanstack/react-router";
import type { FC } from "react";

const AdminHome: FC = () => {
  return <p className="text-zinc-600 dark:text-zinc-400">Mailbox management arrives in phase 1.</p>;
};

export const Route = createFileRoute("/admin/")({
  component: AdminHome,
});
