import { operatorDateOf } from "@server/operator-day";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import clsx from "clsx";
import { type FC, type ReactNode, useEffect, useState } from "react";
import { orpc } from "~/integrations/orpc";
import { Banner } from "../-outcome-banner";
import { formatDay } from "./-format";
import { OsPanel, type PersonalTask } from "./-task-row";
import { useTaskAction } from "./-use-task-action";

type UpdatePatch = Omit<Parameters<typeof orpc.personalTasks.updateTask>[0], "id">;

const TASK_STATES = ["open", "someday", "completed", "cancelled"] as const;

// The editable fields in the shape the inputs hold them: dates as the operator's calendar day, numbers as
// text, so a half-typed estimate never has to round-trip through a number to stay on screen.
type Draft = {
  title: string;
  notes: string;
  area_id: string | null;
  project_id: string | null;
  when_date: string;
  deadline: string;
  estimate_minutes: string;
  focus: boolean;
  state: string;
};

const toDay = (iso: string | null): string => (iso === null ? "" : operatorDateOf(new Date(iso)));

const toDraft = (task: PersonalTask): Draft => ({
  title: task.title,
  notes: task.notes ?? "",
  area_id: task.area_id,
  project_id: task.project_id,
  when_date: toDay(task.when_date),
  deadline: toDay(task.deadline),
  estimate_minutes: task.estimate_minutes === null ? "" : String(task.estimate_minutes),
  focus: task.focus,
  state: task.state,
});

export const Route = createFileRoute("/admin/os/task/$taskId")({
  loader: async ({ params }) => {
    const [detail, areas] = await Promise.all([orpc.personalTasks.getTask({ id: params.taskId }), orpc.personalTasks.listAreas()]);

    if (detail === null) {
      throw notFound();
    }

    return { ...detail, areas };
  },
  component: PersonalOsTaskPage,
});

const field_class =
  "rounded border border-gray-300 bg-bg px-2 py-1 text-gray-900 text-sm outline-none focus-visible:ring-2 focus-visible:ring-info dark:border-dark-border dark:bg-dark-bg dark:text-dark-headings";

type DraftField = keyof Draft;

const copyField = <Field extends DraftField>(target: Partial<Draft>, source: Draft, field: Field): void => {
  target[field] = source[field];
};

const Gloss: FC<{ children: ReactNode; danger?: boolean }> = ({ children, danger }) => (
  <span className={clsx("text-[13px]", danger === true ? "text-danger" : "text-gray-500 dark:text-dark-text")}>&mdash; {children}</span>
);

// The mockup's inspector row: a fixed label column, then the value and its one-line gloss side by side.
const FieldRow: FC<{ children: ReactNode; label: string }> = ({ children, label }) => (
  <>
    <div className="pt-1 text-gray-500 text-sm dark:text-dark-text">{label}</div>
    <div className="flex min-w-0 flex-wrap items-center gap-2 text-gray-900 text-sm dark:text-dark-headings">{children}</div>
  </>
);

function PersonalOsTaskPage() {
  const { area_name, areas, deferral_limit, deferrals, project_name, task } = Route.useLoaderData();
  const { banner, run } = useTaskAction();

  const [draft, setDraft] = useState<Draft>(toDraft(task));
  // A field is dirty from the first keystroke until its own save has landed (or its blur found nothing to
  // save). Nothing is disabled while a save runs — a blur-save must not kill the focus of the field being
  // tabbed into — so the resync below has to know which fields the operator still owns.
  const [dirty, setDirty] = useState<ReadonlySet<DraftField>>(() => new Set<DraftField>());

  const markDirty = (...fields: DraftField[]) => setDirty((current) => new Set([...current, ...fields]));

  const clearDirty = (...fields: DraftField[]) =>
    setDirty((current) => {
      const next = new Set(current);

      for (const field of fields) {
        next.delete(field);
      }

      return next;
    });

  // Every save invalidates the loader, so this resynchronises the fields nobody is holding with what the
  // server actually stored. `dirty` is a dependency on purpose: the reload lands while the saved field is
  // still dirty, and it is the flag clearing afterwards that lets the stored value through — which, after
  // a failed save, is the rollback.
  useEffect(() => {
    const fresh = toDraft(task);

    setDraft((current) => {
      const kept: Partial<Draft> = {};

      for (const field of dirty) {
        copyField(kept, current, field);
      }

      return { ...fresh, ...kept };
    });
  }, [task, dirty]);

  const save = async (label: string, patch: UpdatePatch, optimistic: Partial<Draft>) => {
    const fields = Object.keys(optimistic) as DraftField[];

    markDirty(...fields);
    setDraft((current) => ({ ...current, ...optimistic }));

    await run(label, `Could not save the ${label}`, async () => {
      await orpc.personalTasks.updateTask({ id: task.id, ...patch });
    });

    clearDirty(...fields);
  };

  const edit = (patch: Partial<Draft>) => {
    markDirty(...(Object.keys(patch) as DraftField[]));
    setDraft((current) => ({ ...current, ...patch }));
  };

  const saveTitle = () => {
    const title = draft.title.trim();

    if (title === "" || title === task.title) {
      setDraft((current) => ({ ...current, title: task.title }));
      clearDirty("title");
      return;
    }

    void save("title", { title }, { title });
  };

  const saveNotes = () => {
    const notes = draft.notes.trim();

    if (notes === (task.notes ?? "")) {
      clearDirty("notes");
      return;
    }

    void save("notes", { notes: notes === "" ? null : notes }, { notes });
  };

  const saveEstimate = () => {
    const raw = draft.estimate_minutes.trim();
    const estimate_minutes = raw === "" ? null : Number.parseInt(raw, 10);
    const invalid = estimate_minutes !== null && (Number.isNaN(estimate_minutes) || estimate_minutes < 0);

    if (invalid || estimate_minutes === task.estimate_minutes) {
      setDraft((current) => ({ ...current, estimate_minutes: task.estimate_minutes === null ? "" : String(task.estimate_minutes) }));
      clearDirty("estimate_minutes");
      return;
    }

    void save("estimate", { estimate_minutes }, { estimate_minutes: estimate_minutes === null ? "" : String(estimate_minutes) });
  };

  // Typed fields save on blur, selects on change. A date input fires change on every keystroke of a typed
  // year, and "0002-09-06" is a valid day the schema would accept.
  const saveDay = (field: "when_date" | "deadline") => {
    const value = draft[field];

    if (value === toDay(task[field])) {
      clearDirty(field);
      return;
    }

    void save(field === "when_date" ? "when" : "deadline", { [field]: value === "" ? null : value }, { [field]: value });
  };

  const chosen_area = areas.find((area) => area.id === draft.area_id);
  const project_options = chosen_area?.projects ?? [];
  const area_is_listed = draft.area_id === null || chosen_area !== undefined;
  const project_is_listed = draft.project_id === null || project_options.some((project) => project.id === draft.project_id);
  const deadline_due = draft.deadline !== "" && draft.deadline <= operatorDateOf();

  return (
    <>
      <div>
        <Link
          className="text-[13px] text-gray-500 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info dark:text-dark-text dark:hover:text-dark-headings"
          to="/admin/os"
        >
          &larr; Today
        </Link>
        <input
          aria-label="Title"
          className="mt-1 w-full border-0 bg-transparent p-0 font-bold text-gray-900 text-xl outline-none focus-visible:ring-2 focus-visible:ring-info dark:text-dark-headings"
          onBlur={() => saveTitle()}
          onChange={(event) => edit({ title: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.currentTarget.blur();
            }
          }}
          value={draft.title}
        />
        <p className="mt-0.5 text-gray-500 text-sm dark:text-dark-text">Two dates, two different jobs</p>
      </div>

      {banner !== null && <Banner banner={banner} className="" />}

      <OsPanel title="Fields">
        <div className="grid grid-cols-[170px_1fr] gap-x-4 gap-y-2.5">
          <FieldRow label="area">
            <select
              className={field_class}
              onChange={(event) => {
                const area_id = event.target.value === "" ? null : event.target.value;
                void save("area", { area_id, project_id: null }, { area_id, project_id: null });
              }}
              value={draft.area_id ?? ""}
            >
              <option value="">none</option>
              {!area_is_listed && draft.area_id !== null && <option value={draft.area_id}>{area_name ?? "archived area"}</option>}
              {areas.map((area) => (
                <option key={area.id} value={area.id}>
                  {area.name}
                </option>
              ))}
            </select>
            {draft.area_id === null && <Gloss>not filed yet</Gloss>}
          </FieldRow>

          {draft.area_id !== null && (
            <FieldRow label="project">
              <select
                className={field_class}
                onChange={(event) => {
                  const project_id = event.target.value === "" ? null : event.target.value;
                  void save("project", { project_id }, { project_id });
                }}
                value={draft.project_id ?? ""}
              >
                <option value="">directly under the area</option>
                {!project_is_listed && draft.project_id !== null && (
                  <option value={draft.project_id}>{project_name ?? "archived project"}</option>
                )}
                {project_options.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </FieldRow>
          )}

          <FieldRow label="when">
            <input
              className={field_class}
              onBlur={() => saveDay("when_date")}
              onChange={(event) => edit({ when_date: event.target.value })}
              type="date"
              value={draft.when_date}
            />
            <Gloss>hides until this date</Gloss>
          </FieldRow>

          <FieldRow label="deadline">
            <input
              className={field_class}
              onBlur={() => saveDay("deadline")}
              onChange={(event) => edit({ deadline: event.target.value })}
              type="date"
              value={draft.deadline}
            />
            <Gloss danger={deadline_due}>{deadline_due ? "due, and it still hides nothing" : "hides nothing, schedules nothing"}</Gloss>
          </FieldRow>

          <FieldRow label="estimate">
            <input
              className={clsx(field_class, "w-24")}
              inputMode="numeric"
              min={0}
              onBlur={() => saveEstimate()}
              onChange={(event) => edit({ estimate_minutes: event.target.value })}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.currentTarget.blur();
                }
              }}
              placeholder="—"
              type="number"
              value={draft.estimate_minutes}
            />
            <Gloss>minutes</Gloss>
          </FieldRow>

          <FieldRow label="notes">
            <textarea
              className={clsx(field_class, "min-h-[72px] w-full resize-y")}
              onBlur={() => saveNotes()}
              onChange={(event) => edit({ notes: event.target.value })}
              placeholder="nothing yet"
              value={draft.notes}
            />
          </FieldRow>

          <FieldRow label="focus">
            <button
              aria-pressed={draft.focus}
              className={clsx(
                "rounded-sm border px-1.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info",
                draft.focus
                  ? "border-accent text-accent dark:border-accent-dark dark:text-accent-dark"
                  : "border-gray-300 text-gray-500 dark:border-dark-border dark:text-dark-text",
              )}
              onClick={() => void save("focus", { focus: !draft.focus }, { focus: !draft.focus })}
              type="button"
            >
              {draft.focus ? "focus" : "not focus"}
            </button>
          </FieldRow>

          <FieldRow label="state">
            {draft.state === "inbox" && (
              <>
                <span className="rounded-sm border border-gray-300 px-1.5 text-gray-500 text-xs dark:border-dark-border dark:text-dark-text">
                  inbox
                </span>
                <Gloss>leaves through triage on Today</Gloss>
              </>
            )}
            {draft.state !== "inbox" && (
              <select
                className={field_class}
                onChange={(event) => {
                  const state = event.target.value as (typeof TASK_STATES)[number];
                  void save("state", { state }, { state });
                }}
                value={draft.state}
              >
                {TASK_STATES.map((state) => (
                  <option key={state} value={state}>
                    {state}
                  </option>
                ))}
              </select>
            )}
          </FieldRow>

          <FieldRow label="deferral_count">
            <span>{task.deferral_count}</span>
            <Gloss>of {deferral_limit} before it blocks</Gloss>
          </FieldRow>

          <FieldRow label="plan_week">
            <span>{task.plan_week ?? "—"}</span>
            {task.plan_week === null && <Gloss>not in a week pool</Gloss>}
          </FieldRow>

          <FieldRow label="goal">
            <Gloss>arrives with goals</Gloss>
          </FieldRow>
        </div>
      </OsPanel>

      <OsPanel title="Deferral history">
        {deferrals.length === 0 && <p className="text-gray-500 text-sm dark:text-dark-text">Never pushed out.</p>}
        <div className="flex flex-col gap-1.5">
          {deferrals.map((deferral) => (
            <div
              className="flex flex-wrap items-center gap-3 border-gray-200 border-b border-dotted py-1 dark:border-dark-border"
              key={deferral.id}
            >
              <span className="text-gray-500 text-xs tabular-nums dark:text-dark-text">{formatDay(deferral.created_at)}</span>
              <span className="text-gray-900 text-sm dark:text-dark-headings">
                {deferral.to_date === null ? "pushed out" : `rescheduled to ${formatDay(deferral.to_date)}`}
                {deferral.from_date !== null && ` from ${formatDay(deferral.from_date)}`}
              </span>
              <span className="flex-grow text-[13px] text-gray-500 dark:text-dark-text">
                {deferral.reason === null ? "no reason given" : deferral.reason}
              </span>
            </div>
          ))}
        </div>
      </OsPanel>
    </>
  );
}
