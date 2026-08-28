import { createFileRoute, useRouter } from "@tanstack/react-router";
import { type FC, useState } from "react";
import { orpc } from "~/integrations/orpc";
import type { OutcomeBanner } from "../-outcome-banner";
import { Banner, toFailureBanner } from "../-outcome-banner";
import { OsPanel } from "./-task-row";

type Area = Awaited<ReturnType<typeof orpc.personalTasks.listAreas>>[number];

const AREA_MODES = ["always_on", "sprint", "maintenance", "dormant"] as const;

// Four modes rather than four comparable budgets: the work genuinely arrives in bursts, so a steady
// weekly allocation would warn most weeks and be dismissed most weeks until it meant nothing.
const MODE_EXPLANATIONS: readonly { mode: string; text: string }[] = [
  { mode: "always_on", text: "Carries a soft floor, surfaced rather than enforced." },
  { mode: "sprint", text: "Two or three days on, then a week or two off." },
  { mode: "maintenance", text: "Reactive — arrives as requests do." },
  { mode: "dormant", text: "Accrues no deficit while it sleeps." },
];

export const Route = createFileRoute("/admin/os/areas")({
  loader: async () => orpc.personalTasks.listAreas(),
  component: PersonalOsAreasPage,
});

const OpenCount: FC<{ count: number }> = ({ count }) => {
  if (count === 0) {
    return null;
  }

  return <span className="text-[13px] text-gray-500 dark:text-dark-text">{count} open</span>;
};

function PersonalOsAreasPage() {
  const areas = Route.useLoaderData();
  const router = useRouter();

  const [banner, setBanner] = useState<OutcomeBanner | null>(null);
  const [busy, setBusy] = useState(false);
  const [new_area_name, setNewAreaName] = useState("");
  const [new_project_name, setNewProjectName] = useState<Record<string, string>>({});

  const run = async (prefix: string, work: () => Promise<void>) => {
    setBusy(true);
    setBanner(null);
    try {
      await work();
      await router.invalidate();
    } catch (error) {
      setBanner(toFailureBanner(prefix, error));
    } finally {
      setBusy(false);
    }
  };

  const addArea = () => {
    const name = new_area_name.trim();

    if (name === "") {
      return;
    }

    return run("Could not add the area", async () => {
      await orpc.personalTasks.createArea({ name, mode: "always_on", sort_order: areas.length });
      setNewAreaName("");
    });
  };

  const addProject = (area_id: string) => {
    const name = (new_project_name[area_id] ?? "").trim();

    if (name === "") {
      return;
    }

    return run("Could not add the project", async () => {
      await orpc.personalTasks.createProject({ area_id, name, waka_project: null });
      setNewProjectName((current) => ({ ...current, [area_id]: "" }));
    });
  };

  return (
    <>
      <div>
        <p className="font-bold text-gray-900 text-xl dark:text-dark-headings">Areas &amp; projects</p>
        <p className="mt-0.5 text-gray-500 text-sm dark:text-dark-text">
          Five areas. Listify sits at the top level, not inside Work &amp; Growth.
        </p>
      </div>

      {banner !== null && <Banner banner={banner} className="" />}

      <OsPanel title="The tree">
        {areas.length === 0 && (
          <p className="text-gray-500 text-sm dark:text-dark-text">
            No areas yet. Seed the five with <code>bun scripts/seed-personal-areas.ts --apply</code>, or add one below.
          </p>
        )}

        {areas.map((area: Area) => (
          <div key={area.id}>
            <div className="flex items-center gap-2.5 border-gray-200 border-b border-dotted py-1.5 dark:border-dark-border">
              <span className="flex-grow font-bold text-gray-900 text-sm dark:text-dark-headings">{area.name}</span>
              <select
                className="rounded-sm border border-gray-300 bg-bg px-1.5 text-gray-500 text-xs dark:border-dark-border dark:bg-dark-bg dark:text-dark-text"
                disabled={busy}
                onChange={(event) =>
                  run("Could not change the mode", async () => {
                    await orpc.personalTasks.updateArea({ id: area.id, mode: event.target.value as (typeof AREA_MODES)[number] });
                  })
                }
                value={area.mode}
              >
                {AREA_MODES.map((mode) => (
                  <option key={mode} value={mode}>
                    {mode}
                  </option>
                ))}
              </select>
              <OpenCount count={area.open_count} />
              <button
                className="text-gray-400 text-xs hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info disabled:cursor-not-allowed disabled:opacity-50 dark:text-dark-text"
                disabled={busy}
                onClick={() => run("Could not archive the area", async () => void (await orpc.personalTasks.archiveArea({ id: area.id })))}
                type="button"
              >
                archive
              </button>
            </div>

            {area.projects.map((project) => (
              <div
                className="flex items-center gap-2.5 border-gray-200 border-b border-dotted py-1.5 pl-[18px] dark:border-dark-border"
                key={project.id}
              >
                <span className="flex-grow text-gray-600 text-sm dark:text-dark-text">{project.name}</span>
                {project.waka_project !== null && (
                  <span className="rounded-sm border border-gray-300 px-1.5 text-gray-500 text-xs dark:border-dark-border dark:text-dark-text">
                    {project.waka_project}
                  </span>
                )}
                <OpenCount count={project.open_count} />
                <button
                  className="text-gray-400 text-xs hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info disabled:cursor-not-allowed disabled:opacity-50 dark:text-dark-text"
                  disabled={busy}
                  onClick={() =>
                    run("Could not archive the project", async () => void (await orpc.personalTasks.archiveProject({ id: project.id })))
                  }
                  type="button"
                >
                  archive
                </button>
              </div>
            ))}

            <form
              className="flex gap-2 py-1.5 pl-[18px]"
              onSubmit={(event) => {
                event.preventDefault();
                addProject(area.id);
              }}
            >
              <input
                className="flex-grow rounded border border-gray-300 bg-bg px-2 py-1 text-gray-900 text-xs outline-none placeholder:text-gray-400 focus-visible:ring-2 focus-visible:ring-info dark:border-dark-border dark:bg-dark-bg dark:text-dark-headings dark:placeholder:text-dark-text"
                onChange={(event) => setNewProjectName((current) => ({ ...current, [area.id]: event.target.value }))}
                placeholder={`add a project to ${area.name}…`}
                value={new_project_name[area.id] ?? ""}
              />
              <button
                className="rounded border border-gray-300 px-2 py-1 text-gray-600 text-xs disabled:cursor-not-allowed disabled:opacity-50 dark:border-dark-border dark:text-dark-text"
                disabled={busy || (new_project_name[area.id] ?? "").trim() === ""}
                type="submit"
              >
                add
              </button>
            </form>
          </div>
        ))}

        <form
          className="mt-3 flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            addArea();
          }}
        >
          <input
            className="flex-grow rounded border border-gray-300 bg-bg px-2 py-1.5 text-gray-900 text-sm outline-none placeholder:text-gray-400 focus-visible:ring-2 focus-visible:ring-info dark:border-dark-border dark:bg-dark-bg dark:text-dark-headings dark:placeholder:text-dark-text"
            onChange={(event) => setNewAreaName(event.target.value)}
            placeholder="add an area&hellip;"
            value={new_area_name}
          />
          <button
            className="rounded border border-gray-300 px-3 py-1.5 text-gray-900 text-sm disabled:cursor-not-allowed disabled:opacity-50 dark:border-dark-border dark:text-dark-headings"
            disabled={busy || new_area_name.trim() === ""}
            type="submit"
          >
            add area
          </button>
        </form>
      </OsPanel>

      <OsPanel title="Stream modes — why four comparable budgets would be wrong">
        <dl className="flex flex-col">
          {MODE_EXPLANATIONS.map((explanation) => (
            <div className="flex gap-3 border-gray-200 border-b border-dotted py-1.5 dark:border-dark-border" key={explanation.mode}>
              <dt className="w-[108px] flex-shrink-0 text-[13px] text-gray-500 dark:text-dark-text">{explanation.mode}</dt>
              <dd className="flex-grow text-[13px] text-gray-600 dark:text-dark-text">{explanation.text}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-2.5 text-[13px] text-gray-600 dark:text-dark-text">
          You work in sprints, so a steady weekly allocation would fire a warning most weeks and be dismissed most weeks. Modes let a
          legitimate zero-hour fortnight read as normal.
        </p>
      </OsPanel>
    </>
  );
}
