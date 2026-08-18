import { createFileRoute, Link } from "@tanstack/react-router";
import type { FC } from "react";

const admin_links = [
  { to: "/admin/needs-action", label: "Needs Action", description: "Threads waiting on a reply from you." },
  { to: "/admin/senders", label: "Senders", description: "Who is writing in, and whether you've replied." },
  { to: "/admin/mail", label: "Mailboxes", description: "Connections, sync runs, and certificates." },
] as const;

const AdminHome: FC = () => {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-zinc-600 dark:text-dark-text">Read-only mail dashboards. Snoozing, filing and suppression arrive with phase 3.</p>
      <ul className="flex flex-col gap-2">
        {admin_links.map((link) => (
          <li key={link.to}>
            <Link
              className="block rounded border border-zinc-200 p-3 hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info dark:border-dark-border dark:hover:bg-dark-bg"
              to={link.to}
            >
              <p className="font-medium text-zinc-900 dark:text-dark-headings">{link.label}</p>
              <p className="text-sm text-zinc-600 dark:text-dark-text">{link.description}</p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
};

export const Route = createFileRoute("/admin/")({
  component: AdminHome,
});
