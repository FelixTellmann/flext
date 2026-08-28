import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/os/areas")({
  component: PersonalOsAreasPage,
});

function PersonalOsAreasPage() {
  return <h1 className="font-bold text-gray-900 text-xl dark:text-dark-headings">Areas</h1>;
}
