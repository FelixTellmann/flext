// The destructive/organisational split the shadow report is built from, as the admin routes see it.
//
// It is a copy. server/mail/query/shadow.ts owns the real lists, but that module imports the db handle, so
// importing it from a route would pull mysql2 into the client bundle. Splitting the copy out of shadow.tsx
// is what lets -shadow-kinds.test.ts import both sides and fail when they disagree: a route module drags
// the orpc client (and through it the server router) into the test, and this one does not.
//
// Why it is pinned rather than tolerated: the client uses this to decide how much ceremony an approval
// needs. A kind added to the server's destructive list and missed here would be classified organisational
// and gated with a checkbox instead of a typed confirmation — the split under-gating the one operation
// that cannot be taken back.

export type KindCategory = "destructive" | "organisational" | "retained";

export const DESTRUCTIVE_KINDS = ["auto_trash", "purge"];
export const ORGANISATIONAL_KINDS = ["archive", "file"];

export function classifyKind(kind: string): KindCategory {
  if (DESTRUCTIVE_KINDS.includes(kind)) {
    return "destructive";
  }
  if (ORGANISATIONAL_KINDS.includes(kind)) {
    return "organisational";
  }
  return "retained";
}
