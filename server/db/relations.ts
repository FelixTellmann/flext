import { relations } from "drizzle-orm";
import {
  account,
  comment,
  food,
  foodMethod,
  foodRated,
  foodUnit,
  foodUnitConversion,
  habits,
  habitTracking,
  post,
  session,
  user,
} from "./schema";

// ─── User relations ──────────────────────────────────────────────────────────
export const userRelations = relations(user, ({ many }) => ({
  accounts: many(account),
  sessions: many(session),
  comments: many(comment),
  habits: many(habits),
}));

// ─── Post relations ──────────────────────────────────────────────────────────
export const postRelations = relations(post, ({ many }) => ({
  comments: many(comment),
}));

// ─── Comment relations ───────────────────────────────────────────────────────
export const commentRelations = relations(comment, ({ one }) => ({
  user: one(user, {
    fields: [comment.userId],
    references: [user.id],
  }),
  post: one(post, {
    fields: [comment.postId],
    references: [post.id],
  }),
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

// ─── Habits relations ────────────────────────────────────────────────────────
export const habitsRelations = relations(habits, ({ one }) => ({
  user: one(user, {
    fields: [habits.userId],
    references: [user.id],
  }),
}));

// ─── HabitTracking relations ─────────────────────────────────────────────────
export const habitTrackingRelations = relations(habitTracking, ({ many }) => ({
  food: many(foodRated),
}));

// ─── Food relations ──────────────────────────────────────────────────────────
export const foodRelations = relations(food, ({ one, many }) => ({
  defaultUnit: one(foodUnit, {
    fields: [food.defaultUnitId],
    references: [foodUnit.id],
  }),
  foodRated: many(foodRated),
}));

// ─── FoodUnit relations ──────────────────────────────────────────────────────
export const foodUnitRelations = relations(foodUnit, ({ many }) => ({
  food: many(food),
  fromConversion: many(foodUnitConversion, { relationName: "fromUnit" }),
  toConversion: many(foodUnitConversion, { relationName: "toUnit" }),
  foodRated: many(foodRated),
}));

// ─── FoodUnitConversion relations ────────────────────────────────────────────
export const foodUnitConversionRelations = relations(foodUnitConversion, ({ one }) => ({
  fromUnit: one(foodUnit, {
    fields: [foodUnitConversion.fromUnitId],
    references: [foodUnit.id],
    relationName: "fromUnit",
  }),
  toUnit: one(foodUnit, {
    fields: [foodUnitConversion.toUnitId],
    references: [foodUnit.id],
    relationName: "toUnit",
  }),
}));

// ─── FoodMethod relations ────────────────────────────────────────────────────
export const foodMethodRelations = relations(foodMethod, ({ many }) => ({
  foodRated: many(foodRated),
}));

// ─── FoodRated relations ─────────────────────────────────────────────────────
export const foodRatedRelations = relations(foodRated, ({ one }) => ({
  food: one(food, {
    fields: [foodRated.foodId],
    references: [food.id],
  }),
  unit: one(foodUnit, {
    fields: [foodRated.unitId],
    references: [foodUnit.id],
  }),
  foodMethod: one(foodMethod, {
    fields: [foodRated.foodMethodId],
    references: [foodMethod.id],
  }),
  habitTracking: one(habitTracking, {
    fields: [foodRated.habitTrackingId],
    references: [habitTracking.id],
  }),
}));
