import { createFileRoute } from "@tanstack/react-router";
import clsx from "clsx";
import { type FC, useState } from "react";
import { orpc } from "~/integrations/orpc";
import { Banner } from "../-outcome-banner";
import { formatLong } from "./-format";
import { PALETTE_SLOTS, paletteClassOf } from "./-palette";
import { OsPanel } from "./-task-row";
import { useTaskAction } from "./-use-task-action";

type Area = Awaited<ReturnType<typeof orpc.personalTasks.listAreas>>[number];
type Project = Area["projects"][number];
type ProjectPatch = Pick<Parameters<typeof orpc.personalTasks.updateProject>[0], "mode" | "soft_floor_hours" | "palette_slot">;

const AREA_MODES = ["always_on", "sprint", "maintenance", "dormant"] as const;

type Mode = (typeof AREA_MODES)[number];

const MAX_FLOOR_HOURS = 168;

// Four modes rather than four comparable budgets: the work genuinely arrives in bursts, so a steady
// weekly allocation would warn most weeks and be dismissed most weeks until it meant nothing.
const MODE_EXPLANATIONS: readonly { mode: string; text: string }[] = [
  { mode: "always_on", text: "Carries a soft floor, surfaced rather than enforced." },
  { mode: "sprint", text: "Two or three days on, then a week or two off." },
  { mode: "maintenance", text: "Reactive — arrives as requests do." },
  { mode: "dormant", text: "Accrues no deficit while it sleeps." },
];

const select_class =
  "rounded-sm border border-gray-300 bg-bg px-1.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info disabled:cursor-not-allowed disabled:opacity-50 dark:border-dark-border dark:bg-dark-bg";

const quiet_button_class =
  "text-gray-400 text-xs hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info disabled:cursor-not-allowed disabled:opacity-50 dark:text-dark-text";

const without = <Value,>(record: Record<string, Value>, ...keys: (string | null)[]): Record<string, Value> =>
  Object.fromEntries(Object.entries(record).filter(([key]) => !keys.includes(key)));

export const Route = createFileRoute("/admin/os/areas")({
  loader: async () => {
    const [areas, unmapped] = await Promise.all([orpc.personalTasks.listAreas(), orpc.personalTasks.listUnmappedWakaNames()]);

    return { areas, unmapped };
  },
  component: PersonalOsAreasPage,
});

const OpenCount: FC<{ count: number }> = ({ count }) => {
  if (count === 0) {
    return null;
  }

  return <span className="text-[13px] text-gray-500 dark:text-dark-text">{count} open</span>;
};

function PersonalOsAreasPage() {
  const { areas, unmapped } = Route.useLoaderData();
  const { banner, busy_key, run } = useTaskAction();

  const [new_area_name, setNewAreaName] = useState("");
  const [new_project_name, setNewProjectName] = useState<Record<string, string>>({});
  // Optimistic project edits, keyed by project id and dropped once the save has settled either way:
  // run() resolves after the reload, so dropping then is a no-op on success and the rollback on failure.
  const [overrides, setOverrides] = useState<Record<string, ProjectPatch>>({});
  // What is being typed into a floor input before its blur decides whether it is a number.
  const [floor_drafts, setFloorDrafts] = useState<Record<string, string>>({});

  const busy = busy_key !== null;
  const all_projects = areas.flatMap((area) => area.projects.map((project) => ({ ...project, ...overrides[project.id] })));

  const addArea = () => {
    const name = new_area_name.trim();

    if (name === "") {
      return;
    }

    return run("new-area", "Could not add the area", async () => {
      await orpc.personalTasks.createArea({ name, mode: "always_on", sort_order: areas.length });
      setNewAreaName("");
    });
  };

  const addProject = (area_id: string) => {
    const name = (new_project_name[area_id] ?? "").trim();

    if (name === "") {
      return;
    }

    return run(area_id, "Could not add the project", async () => {
      await orpc.personalTasks.createProject({ area_id, name });
      setNewProjectName((current) => ({ ...current, [area_id]: "" }));
    });
  };

  // One slot, one project: the server clears the slot from whoever held it, and the screen shows that
  // move at once rather than after the reload.
  const saveProject = async (project_id: string, patch: ProjectPatch) => {
    const displaced =
      patch.palette_slot === undefined || patch.palette_slot === null
        ? null
        : (all_projects.find((project) => project.id !== project_id && project.palette_slot === patch.palette_slot)?.id ?? null);

    setOverrides((current) => ({
      ...current,
      [project_id]: { ...current[project_id], ...patch },
      ...(displaced === null ? {} : { [displaced]: { ...current[displaced], palette_slot: null } }),
    }));

    await run(project_id, "Could not save the project", async () => {
      await orpc.personalTasks.updateProject({ id: project_id, ...patch });
    });

    setOverrides((current) => without(current, project_id, displaced));
  };

  // Blur decides. Empty clears the floor; anything that is not a whole number of hours in range reverts.
  const saveFloor = (project: Project) => {
    const raw = (floor_drafts[project.id] ?? "").trim();
    const hours = raw === "" ? null : Number(raw);
    const valid = hours === null || (Number.isInteger(hours) && hours >= 0 && hours <= MAX_FLOOR_HOURS);

    setFloorDrafts((current) => without(current, project.id));

    if (valid && hours !== project.soft_floor_hours) {
      void saveProject(project.id, { soft_floor_hours: hours });
    }
  };

  const unassign = (waka_name: string) =>
    run(`waka:${waka_name}`, "Could not unassign the name", async () => {
      await orpc.personalTasks.unassignWakaName({ waka_name });
    });

  const assign = (waka_name: string, project_id: string) =>
    run(`waka:${waka_name}`, "Could not assign the name", async () => {
      await orpc.personalTasks.assignWakaName({ project_id, waka_name });
    });

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
                aria-label={`Mode of ${area.name}`}
                className={clsx(select_class, "text-gray-500 dark:text-dark-text")}
                disabled={busy}
                onChange={(event) =>
                  run(area.id, "Could not change the mode", async () => {
                    await orpc.personalTasks.updateArea({ id: area.id, mode: event.target.value as Mode });
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
                className={quiet_button_class}
                disabled={busy}
                onClick={() =>
                  run(area.id, "Could not archive the area", async () => void (await orpc.personalTasks.archiveArea({ id: area.id })))
                }
                type="button"
              >
                archive
              </button>
            </div>

            {area.projects.map((stored) => {
              const project = { ...stored, ...overrides[stored.id] };
              const inherits = project.mode === null;

              return (
                <div
                  className="flex flex-wrap items-center gap-2.5 border-gray-200 border-b border-dotted py-1.5 pl-[18px] dark:border-dark-border"
                  key={project.id}
                >
                  <span className="flex-grow text-gray-600 text-sm dark:text-dark-text">{project.name}</span>

                  {project.waka_names.map((waka_name) => (
                    <span
                      className="flex items-center gap-1 rounded-sm border border-gray-300 px-1.5 text-gray-500 text-xs dark:border-dark-border dark:text-dark-text"
                      key={waka_name}
                    >
                      {waka_name}
                      <button
                        aria-label={`Unassign ${waka_name}`}
                        className={quiet_button_class}
                        disabled={busy}
                        onClick={() => unassign(waka_name)}
                        type="button"
                      >
                        &times;
                      </button>
                    </span>
                  ))}

                  <select
                    aria-label={`Mode of ${project.name}`}
                    className={clsx(select_class, inherits ? "text-gray-400 dark:text-dark-text/60" : "text-gray-500 dark:text-dark-text")}
                    onChange={(event) =>
                      void saveProject(project.id, { mode: event.target.value === "" ? null : (event.target.value as Mode) })
                    }
                    value={project.mode ?? ""}
                  >
                    <option value="">inherit &middot; {area.mode}</option>
                    {AREA_MODES.map((mode) => (
                      <option key={mode} value={mode}>
                        {mode}
                      </option>
                    ))}
                  </select>

                  <label className="flex items-center gap-1 text-gray-500 text-xs dark:text-dark-text">
                    <input
                      aria-label={`Soft floor hours of ${project.name}`}
                      className="w-14 rounded-sm border border-gray-300 bg-bg px-1.5 text-right text-gray-500 text-xs outline-none placeholder:text-gray-400 focus-visible:ring-2 focus-visible:ring-info dark:border-dark-border dark:bg-dark-bg dark:text-dark-text"
                      inputMode="numeric"
                      max={MAX_FLOOR_HOURS}
                      min={0}
                      onBlur={() => saveFloor(project)}
                      onChange={(event) => setFloorDrafts((current) => ({ ...current, [project.id]: event.target.value }))}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.currentTarget.blur();
                        }
                      }}
                      placeholder="—"
                      type="number"
                      value={floor_drafts[project.id] ?? (project.soft_floor_hours === null ? "" : String(project.soft_floor_hours))}
                    />
                    h floor
                  </label>

                  <span className="flex items-center gap-1.5">
                    <span className={clsx("h-2.5 w-2.5 rounded-sm", paletteClassOf(project.palette_slot))} />
                    <select
                      aria-label={`Palette slot of ${project.name}`}
                      className={clsx(select_class, "text-gray-500 dark:text-dark-text")}
                      onChange={(event) =>
                        void saveProject(project.id, { palette_slot: event.target.value === "" ? null : Number(event.target.value) })
                      }
                      value={project.palette_slot ?? ""}
                    >
                      <option value="">no slot</option>
                      {PALETTE_SLOTS.map((slot) => (
                        <option key={slot} value={slot}>
                          slot {slot}
                        </option>
                      ))}
                    </select>
                  </span>

                  <OpenCount count={project.open_count} />
                  <button
                    className={quiet_button_class}
                    disabled={busy}
                    onClick={() =>
                      run(
                        project.id,
                        "Could not archive the project",
                        async () => void (await orpc.personalTasks.archiveProject({ id: project.id })),
                      )
                    }
                    type="button"
                  >
                    archive
                  </button>
                </div>
              );
            })}

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

      <OsPanel title="Unmapped Wakapi names">
        {unmapped.length === 0 && (
          <p className="text-gray-500 text-sm dark:text-dark-text">every name seen in the last 90 days is mapped</p>
        )}
        {unmapped.map((row) => (
          <div
            className="flex flex-wrap items-center gap-3 border-gray-200 border-b border-dotted py-1.5 dark:border-dark-border"
            key={row.waka_name}
          >
            <span className="flex-grow text-gray-900 text-sm dark:text-dark-headings">{row.waka_name}</span>
            <span className="text-gray-500 text-xs tabular-nums dark:text-dark-text">{formatLong(row.total_seconds)} over 90 days</span>
            <select
              aria-label={`Assign ${row.waka_name} to a project`}
              className={clsx(select_class, "text-gray-500 dark:text-dark-text")}
              disabled={busy}
              onChange={(event) => {
                if (event.target.value !== "") {
                  void assign(row.waka_name, event.target.value);
                }
              }}
              value=""
            >
              <option value="">assign to project&hellip;</option>
              {areas
                .filter((area) => area.projects.length > 0)
                .map((area) => (
                  <optgroup key={area.id} label={area.name}>
                    {area.projects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
            </select>
          </div>
        ))}
        {unmapped.length > 0 && (
          <p className="mt-2.5 text-[13px] text-gray-600 dark:text-dark-text">
            Each of these is its own grey stream on the ledger until it is assigned. A name another project already holds moves.
          </p>
        )}
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
          legitimate zero-hour fortnight read as normal. A project with no mode of its own inherits its area&rsquo;s.
        </p>
      </OsPanel>
    </>
  );
}
