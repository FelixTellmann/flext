import { createFileRoute, Link } from "@tanstack/react-router";
import type { FC } from "react";
import { orpc } from "~/integrations/orpc";
import { SessionsStrip } from "./-sessions-strip";

// The lead sentence plus six earlier sittings: enough to argue with the threshold from, short enough to
// sit above the link hub without pushing it below the fold.
const SESSION_STRIP_LIMIT = 7;

const admin_links = [
  {
    to: "/admin/review",
    label: "Inbox review",
    description: "The Monday pass in one page: rules to switch on, proposals to approve, senders to unsubscribe.",
  },
  { to: "/admin/needs-action", label: "Needs Action", description: "Threads waiting on a reply from you." },
  { to: "/admin/senders", label: "Senders", description: "Who is writing in, and whether you've replied." },
  { to: "/admin/mail", label: "Mailboxes", description: "Connections, sync runs, and certificates." },
  {
    to: "/admin/promote",
    label: "Turn rules on",
    description: "Rules that have been watching and never allowed to act. Review the big ones and switch them on together.",
  },
  {
    to: "/admin/unsubscribe",
    label: "Stop mail arriving",
    description: "Senders who offer a way off their list. Every rule elsewhere only hides mail; this stops it being sent.",
  },
  { to: "/admin/shadow", label: "Shadow Report", description: "What each policy would have done — review before promoting it to auto." },
  {
    to: "/admin/journal",
    label: "Action Journal",
    description: "Every action ever decided or taken, with the state it recorded before acting — and how to reverse it.",
  },
  {
    to: "/admin/filing",
    label: "Filing Queue",
    description: "`file` actions the filing gate could not resolve on its own — confirm or correct a destination to unstick one.",
  },
] as const;

const AdminHome: FC = () => {
  const { sessions, loaded_at } = Route.useLoaderData();

  return (
    <div className="flex flex-col gap-3">
      <SessionsStrip loaded_at={loaded_at} sessions={sessions} title="Triage sessions" />
      <p className="text-zinc-600 dark:text-dark-text">
        Mail dashboards: what the engine proposes, what it did, and when it last saw you reading.
      </p>
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
  loader: async () => ({
    sessions: await orpc.mail.listRecentAttentionSessions({ limit: SESSION_STRIP_LIMIT }),
    loaded_at: new Date().toISOString(),
  }),
  component: AdminHome,
});
