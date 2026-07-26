import { relations } from "drizzle-orm";
import { account, session, user } from "./schema";

// ─── User relations ──────────────────────────────────────────────────────────
export const userRelations = relations(user, ({ many }) => ({
  accounts: many(account),
  sessions: many(session),
}));

// ─── Account relations ───────────────────────────────────────────────────────
export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id],
  }),
}));

// ─── Session relations ───────────────────────────────────────────────────────
export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id],
  }),
}));
