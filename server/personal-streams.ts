import { db } from "@server/db/drizzle";
import { personalArea, personalProject, personalProjectWakaName } from "@server/db/schema";
import { normaliseProjectName } from "@server/wakatime/bucket-heartbeats";
import { isNull } from "drizzle-orm";

export type Stream = {
  project_id: string;
  project_name: string;
  area_id: string;
  area_name: string;
  mode: string;
  soft_floor_hours: number | null;
  palette_slot: number | null;
};

export type StreamAttributes = { mode: string; soft_floor_hours: number | null };

// The fallback rules on their own, with no query behind them, so they can be tested as a table.
export const resolveStreamAttributes = (input: {
  project: { mode: string | null; soft_floor_hours: number | null };
  area: { mode: string; soft_floor_hours: number | null };
  is_only_project: boolean;
}): StreamAttributes => {
  const mode = input.project.mode ?? input.area.mode;

  // Spec 6.3: dormant and maintenance accrue no deficit, whatever floor happens to be stored.
  if (mode === "dormant" || mode === "maintenance") {
    return { mode, soft_floor_hours: null };
  }

  // PersonalArea.soft_floor_hours survives one release as a fallback, and only for an area with a single
  // project — split across two it would charge the same hours to both.
  const inherited_floor = input.is_only_project ? input.area.soft_floor_hours : null;

  return { mode, soft_floor_hours: input.project.soft_floor_hours ?? inherited_floor };
};

// Normalised Wakapi name → project. A name whose project (or area) is archived resolves to nothing and is
// its own stream, labelled by name, until it is assigned again.
export const resolveStreams = async (): Promise<{ by_waka_name: Map<string, Stream> }> => {
  const [areas, projects, names] = await Promise.all([
    db.select().from(personalArea).where(isNull(personalArea.archived_at)),
    db.select().from(personalProject).where(isNull(personalProject.archived_at)),
    db.select().from(personalProjectWakaName),
  ]);

  const area_by_id = new Map(areas.map((area) => [area.id, area]));
  const projects_per_area = new Map<string, number>();

  for (const project of projects) {
    projects_per_area.set(project.area_id, (projects_per_area.get(project.area_id) ?? 0) + 1);
  }

  const stream_by_project = new Map<string, Stream>();

  for (const project of projects) {
    const area = area_by_id.get(project.area_id);

    if (area === undefined) {
      continue;
    }

    const attributes = resolveStreamAttributes({
      project: { mode: project.mode, soft_floor_hours: project.soft_floor_hours },
      area: { mode: area.mode, soft_floor_hours: area.soft_floor_hours },
      is_only_project: projects_per_area.get(project.area_id) === 1,
    });

    stream_by_project.set(project.id, {
      project_id: project.id,
      project_name: project.name,
      area_id: area.id,
      area_name: area.name,
      mode: attributes.mode,
      soft_floor_hours: attributes.soft_floor_hours,
      palette_slot: project.palette_slot,
    });
  }

  const by_waka_name = new Map<string, Stream>();

  for (const row of names) {
    const stream = stream_by_project.get(row.project_id);

    if (stream !== undefined) {
      by_waka_name.set(normaliseProjectName(row.waka_name), stream);
    }
  }

  return { by_waka_name };
};
