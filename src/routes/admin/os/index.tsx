import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/os/")({
  component: PersonalOsTodayPage,
});

function PersonalOsTodayPage() {
  return <h1 className="font-bold text-gray-900 text-xl dark:text-dark-headings">Today</h1>;
}
