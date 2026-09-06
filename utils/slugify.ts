// Mirrors the seed in migration 0023 (LOWER + " & " and " " to "-" + collapse "--") so a slug derived here
// for a new area matches what the migration wrote for the existing ones; the strip and trim only remove
// what that SQL would have let through.
export const slugify = (name: string): string =>
  name
    .toLowerCase()
    .replace(/ & /g, "-")
    .replace(/ /g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
