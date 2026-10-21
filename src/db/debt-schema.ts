import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sheets } from "./sheet-schema";
export const debts = sqliteTable("debts", {
  id: text("id").primaryKey(), sheetId: text("sheet_id").notNull().references(() => sheets.id, { onDelete: "cascade" }),
  description: text("description").notNull(), debtor: text("debtor").notNull(), recipient: text("recipient"), total: integer("total").notNull(),
  legacy: integer("legacy", { mode: "boolean" }).notNull().default(false), version: integer("version").notNull().default(1),
  groupedInto: text("grouped_into"), createdAt: integer("created_at").notNull(), updatedAt: integer("updated_at").notNull(),
}, t => [uniqueIndex("debts_sheet_id_unique").on(t.sheetId, t.id), index("debts_sheet_updated").on(t.sheetId, t.updatedAt), check("debts_total", sql`typeof(${t.total}) = 'integer' AND abs(${t.total}) <= 9007199254740991 AND ${t.total} >= 0`)]);
export const debtSources = sqliteTable("debt_sources", {
  id: text("id").primaryKey(), sheetId: text("sheet_id").notNull(), debtId: text("debt_id").notNull(), transactionId: text("transaction_id").notNull(),
  position: integer("position").notNull(), originalVersion: integer("original_version").notNull(), acceptedVersion: integer("accepted_version").notNull(),
  amount: integer("amount").notNull(), originalAmount: integer("original_amount").notNull(), payee: text("payee").notNull(), date: text("date").notNull(), bucketId: text("bucket_id").notNull(), bucketName: text("bucket_name").notNull(),
}, t => [foreignKey({ columns: [t.sheetId, t.debtId], foreignColumns: [debts.sheetId, debts.id] }).onDelete("cascade"), uniqueIndex("debt_source_exclusive").on(t.sheetId, t.transactionId, t.position)]);
export const debtPayments = sqliteTable("debt_payments", {
  id: text("id").primaryKey(), sheetId: text("sheet_id").notNull(), debtId: text("debt_id").notNull(),
  kind: text("kind", { enum: ["opening", "payment", "correction"] }).notNull(), amount: integer("amount").notNull(),
  replaces: text("replaces"), replacementAmount: integer("replacement_amount"), date: text("date").notNull(), comment: text("comment").notNull(), reason: text("reason").notNull().default(""), createdAt: integer("created_at").notNull(),
}, t => [foreignKey({ columns: [t.sheetId, t.debtId], foreignColumns: [debts.sheetId, debts.id] }).onDelete("cascade"), check("debt_payment_amount", sql`typeof(${t.amount}) = 'integer' AND abs(${t.amount}) <= 9007199254740991`)]);
export const debtChanges = sqliteTable("debt_changes", {
  id: text("id").primaryKey(), sheetId: text("sheet_id").notNull(), debtId: text("debt_id").notNull(), description: text("description").notNull(), createdAt: integer("created_at").notNull(),
}, t => [foreignKey({ columns: [t.sheetId, t.debtId], foreignColumns: [debts.sheetId, debts.id] }).onDelete("cascade")]);
export const debtRequests = sqliteTable("debt_requests", {
  id: text("id").notNull(), sheetId: text("sheet_id").notNull().references(() => sheets.id, { onDelete: "cascade" }), hash: text("hash").notNull(), debtId: text("debt_id").notNull(),
}, t => [uniqueIndex("debt_request_unique").on(t.sheetId, t.id)]);
export const debtLegacyMetadata = sqliteTable("debt_legacy_metadata", {
  transactionId: text("transaction_id").primaryKey(), sheetId: text("sheet_id").notNull().references(() => sheets.id, { onDelete: "cascade" }), date: text("date"), comment: text("comment").notNull(),
});
export const debtTrackingRequests = sqliteTable("debt_tracking_requests", {
  id: text("id").notNull(), sheetId: text("sheet_id").notNull().references(() => sheets.id, { onDelete: "cascade" }), hash: text("hash").notNull(),
}, t => [uniqueIndex("debt_tracking_request_unique").on(t.sheetId, t.id)]);

