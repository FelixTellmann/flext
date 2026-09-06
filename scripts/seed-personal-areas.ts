import { db } from "@server/db/drizzle";
import { personalArea } from "@server/db/schema";
import { isNull } from "drizzle-orm";

// Seeds the five life areas of the personal OS.
//
//   bun scripts/seed-personal-areas.ts             # dry run — prints the plan, writes nothing
//   bun scripts/seed-personal-areas.ts --apply     # writes the areas (operator only)
//
// Listify is an area in its own right, not a project under Work & Growth. It is the one stream with a
// standing claim on the week, and burying it a level down would make it compete for attention with a
// client engagement that ends.

type SeedArea = {
  mode: "dormant" | "maintenance" | "sprint" | "always_on";
  name: string;
  soft_floor_hours: number | null;
};

const SEED_AREAS: readonly SeedArea[] = [
  { mode: "always_on", name: "Health & Fitness", soft_floor_hours: null },
  { mode: "always_on", name: "Personal Life", soft_floor_hours: null },
  { mode: "sprint", name: "Work & Growth", soft_floor_hours: null },
  { mode: "always_on", name: "Listify", soft_floor_hours: 12 },
  { mode: "maintenance", name: "Admin & Other", soft_floor_hours: null },
];

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");

  console.log(apply ? "Seeding personal areas — APPLYING" : "Seeding personal areas — DRY RUN (pass --apply to write)");

  const existing = await db.select({ name: personalArea.name }).from(personalArea).where(isNull(personalArea.archived_at));
  const existing_names = new Set(existing.map((row) => row.name.toLowerCase()));
  const missing = SEED_AREAS.filter((area) => !existing_names.has(area.name.toLowerCase()));

  console.log(`\n${existing.length} area(s) already present, ${missing.length} to write\n`);

  for (const [index, area] of SEED_AREAS.entries()) {
    const present = existing_names.has(area.name.toLowerCase());
    const floor = area.soft_floor_hours === null ? "no floor" : `${area.soft_floor_hours}h floor`;
    console.log(`  ${index}. ${area.name} — ${area.mode}, ${floor}${present ? "  [already present, skipping]" : ""}`);
  }

  if (!apply) {
    console.log("\ndry run only — nothing was written. Re-run with --apply to write these areas.");
    process.exit(0);
  }

  if (missing.length === 0) {
    console.log("\nnothing to do: every area already exists.");
    process.exit(0);
  }

  console.log("");
  for (const area of missing) {
    // Matched by name rather than upserted on the primary key: ids are UUIDs generated per insert, so
    // there is no stable key to upsert against and re-running must not produce a second "Listify".
    const sort_order = SEED_AREAS.findIndex((seed) => seed.name === area.name);

    await db.insert(personalArea).values({
      id: crypto.randomUUID(),
      name: area.name,
      mode: area.mode,
      soft_floor_hours: area.soft_floor_hours,
      sort_order,
      updatedAt: new Date(),
    });
    console.log(`inserted ${area.name}`);
  }

  console.log(`\ndone: ${missing.length} area(s) inserted.`);
  process.exit(0);
}

await main();
