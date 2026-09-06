import { db } from "@server/db/drizzle";
import { filingBinding } from "@server/db/schema";
import { eq } from "drizzle-orm";

export type FilingBindingRow = { logical_path: string; folder: string };

export async function loadFilingBindings(input: { mailbox_id: string }): Promise<FilingBindingRow[]> {
  return db
    .select({ logical_path: filingBinding.logical_path, folder: filingBinding.folder })
    .from(filingBinding)
    .where(eq(filingBinding.mailbox_id, input.mailbox_id));
}
