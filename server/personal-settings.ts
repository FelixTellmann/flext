import { db } from "@server/db/drizzle";
import { personalSetting } from "@server/db/schema";
import { eq } from "drizzle-orm";

// Missing row, empty value and unparseable value all fall back the same way: a setting that cannot be
// read is the same as one that was never written, and the constant it shadows is still a sane number.
export const readSetting = async (key: string, fallback: number): Promise<number> => {
  const [row] = await db.select({ value: personalSetting.value }).from(personalSetting).where(eq(personalSetting.key, key)).limit(1);

  if (row === undefined || row.value.trim() === "") {
    return fallback;
  }

  const parsed = Number(row.value);

  return Number.isNaN(parsed) ? fallback : parsed;
};

export const writeSetting = async (key: string, value: number): Promise<void> => {
  const now = new Date();
  const stored = String(value);

  await db
    .insert(personalSetting)
    .values({ key, value: stored, updatedAt: now })
    .onDuplicateKeyUpdate({ set: { value: stored, updatedAt: now } });
};
