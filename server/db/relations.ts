import { relations } from "drizzle-orm";
import {
  account,
  mailbox,
  mailboxCursor,
  mailboxObservedAddress,
  message,
  personalArea,
  personalProject,
  personalTask,
  sender,
  session,
  syncRun,
  user,
} from "./schema";

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

// ─── Mailbox relations ───────────────────────────────────────────────────────
export const mailboxRelations = relations(mailbox, ({ many }) => ({
  cursors: many(mailboxCursor),
  messages: many(message),
  observed_addresses: many(mailboxObservedAddress),
  sync_runs: many(syncRun),
}));

// ─── MailboxCursor relations ─────────────────────────────────────────────────
export const mailboxCursorRelations = relations(mailboxCursor, ({ one }) => ({
  mailbox: one(mailbox, {
    fields: [mailboxCursor.mailbox_id],
    references: [mailbox.id],
  }),
}));

// ─── Message relations ───────────────────────────────────────────────────────
export const messageRelations = relations(message, ({ one }) => ({
  mailbox: one(mailbox, {
    fields: [message.mailbox_id],
    references: [mailbox.id],
  }),
  sender: one(sender, {
    fields: [message.sender_id],
    references: [sender.id],
  }),
}));

// ─── MailboxObservedAddress relations ────────────────────────────────────────
export const mailboxObservedAddressRelations = relations(mailboxObservedAddress, ({ one }) => ({
  mailbox: one(mailbox, {
    fields: [mailboxObservedAddress.mailbox_id],
    references: [mailbox.id],
  }),
}));

// ─── SyncRun relations ───────────────────────────────────────────────────────
export const syncRunRelations = relations(syncRun, ({ one }) => ({
  mailbox: one(mailbox, {
    fields: [syncRun.mailbox_id],
    references: [mailbox.id],
  }),
}));

// ─── PersonalArea relations ──────────────────────────────────────────────────
export const personalAreaRelations = relations(personalArea, ({ many }) => ({
  projects: many(personalProject),
  tasks: many(personalTask),
}));

// ─── PersonalProject relations ───────────────────────────────────────────────
export const personalProjectRelations = relations(personalProject, ({ one, many }) => ({
  area: one(personalArea, {
    fields: [personalProject.area_id],
    references: [personalArea.id],
  }),
  tasks: many(personalTask),
}));

// ─── PersonalTask relations ──────────────────────────────────────────────────
export const personalTaskRelations = relations(personalTask, ({ one }) => ({
  area: one(personalArea, {
    fields: [personalTask.area_id],
    references: [personalArea.id],
  }),
  project: one(personalProject, {
    fields: [personalTask.project_id],
    references: [personalProject.id],
  }),
}));
