import { sql } from "drizzle-orm";
import { check, foreignKey, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sheets, categories } from "./sheet-schema";

export const paymentPlans = sqliteTable("payment_plans", {
  id: text("id").primaryKey(), sheetId: text("sheet_id").notNull().references(() => sheets.id, { onDelete: "cascade" }),
  name: text("name").notNull(), categoryId: text("category_id").notNull(), expected: integer("expected").notNull(), dueDate: text("due_date").notNull(),
  recurrence: integer("recurrence").notNull(), anchorDay: integer("anchor_day").notNull(), createdDate: text("created_date").notNull(),
  status: text("status", { enum: ["active", "fulfilled", "cancelled", "skipped"] }).notNull().default("active"), version: integer("version").notNull().default(1),
  matchedTransactionId: text("matched_transaction_id"), activeTransactionId: text("active_transaction_id"), sourceVersion: integer("source_version"),
  matchedAmount: integer("matched_amount"), matchedDate: text("matched_date"), matchedPayee: text("matched_payee"),
  nextPlanId: text("next_plan_id"), createdAt: integer("created_at").notNull(), updatedAt: integer("updated_at").notNull(),
}, t => [uniqueIndex("payment_plans_sheet_id").on(t.sheetId, t.id), uniqueIndex("payment_plans_active_source").on(t.sheetId, t.activeTransactionId),
  foreignKey({ columns: [t.sheetId, t.categoryId], foreignColumns: [categories.sheetId, categories.id] }),
  check("payment_plans_expected", sql`typeof(${t.expected}) = 'integer' AND ${t.expected} > 0 AND ${t.expected} <= 9007199254740991`),
  check("payment_plans_recurrence", sql`${t.recurrence} IN (0, 1, 6, 12)`), check("payment_plans_anchor", sql`${t.anchorDay} BETWEEN 1 AND 31`)]);
export const planContributions = sqliteTable("plan_contributions", {
  sheetId: text("sheet_id").notNull(), planId: text("plan_id").notNull(), categoryId: text("category_id").notNull(),
  from: text("period_from").notNull(), to: text("period_to").notNull(), amount: integer("amount").notNull(),
}, t => [foreignKey({ columns: [t.sheetId, t.planId], foreignColumns: [paymentPlans.sheetId, paymentPlans.id] }).onDelete("cascade"),
  uniqueIndex("plan_contributions_period").on(t.planId, t.from), check("plan_contributions_amount", sql`typeof(${t.amount}) = 'integer' AND ${t.amount} >= 0 AND ${t.amount} <= 9007199254740991`)]);
export const planAdjustments = sqliteTable("plan_adjustments", {
  id: text("id").primaryKey(), sheetId: text("sheet_id").notNull(), planId: text("plan_id").notNull(), categoryId: text("category_id").notNull(),
  date: text("date").notNull(), amount: integer("amount").notNull(), reason: text("reason").notNull(),
}, t => [foreignKey({ columns: [t.sheetId, t.planId], foreignColumns: [paymentPlans.sheetId, paymentPlans.id] }).onDelete("cascade"), check("plan_adjustments_amount", sql`typeof(${t.amount}) = 'integer' AND abs(${t.amount}) <= 9007199254740991`)]);
export const planRequests = sqliteTable("plan_requests", {
  sheetId: text("sheet_id").notNull().references(() => sheets.id, { onDelete: "cascade" }), id: text("id").notNull(), hash: text("hash").notNull(), resultId: text("result_id").notNull(),
}, t => [uniqueIndex("plan_requests_identity").on(t.sheetId, t.id)]);
