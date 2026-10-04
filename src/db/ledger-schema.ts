import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { user } from "./auth-schema";
import { buckets, categories, financialAccounts, sheets } from "./sheet-schema";

export const transactions = sqliteTable("transactions", {
  id: text("id").primaryKey(), sheetId: text("sheet_id").notNull().references(() => sheets.id, { onDelete: "cascade" }),
  accountId: text("account_id").notNull(), date: text("date").notNull(), payee: text("payee").notNull(),
  kind: text("kind", { enum: ["expense", "refund", "income", "transfer"] }).notNull(),
  amount: integer("amount").notNull(), creatorId: text("creator_id").notNull().references(() => user.id),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(), updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  version: integer("version").notNull().default(1), deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
}, (table) => [uniqueIndex("transactions_sheet_id_unique").on(table.sheetId, table.id),
  index("transactions_sheet_date_idx").on(table.sheetId, table.date, table.id),
  foreignKey({ columns: [table.sheetId, table.accountId], foreignColumns: [financialAccounts.sheetId, financialAccounts.id] }),
  check("transactions_amount", sql`typeof(${table.amount}) = 'integer' AND ${table.amount} != 0 AND abs(${table.amount}) <= 9007199254740991`),
  check("transactions_kind_sign", sql`(${table.kind} = 'expense' AND ${table.amount} < 0) OR (${table.kind} IN ('refund', 'income') AND ${table.amount} > 0) OR ${table.kind} = 'transfer'`),
  check("transactions_version", sql`${table.version} > 0`)]);

export const splits = sqliteTable("splits", {
  id: text("id").primaryKey(), sheetId: text("sheet_id").notNull(), transactionId: text("transaction_id").notNull(),
  categoryId: text("category_id").notNull(), bucketId: text("bucket_id").notNull(), amount: integer("amount").notNull(),
  position: integer("position").notNull(),
}, (table) => [
  foreignKey({ columns: [table.sheetId, table.transactionId], foreignColumns: [transactions.sheetId, transactions.id] }).onDelete("cascade"),
  foreignKey({ columns: [table.sheetId, table.categoryId], foreignColumns: [categories.sheetId, categories.id] }),
  foreignKey({ columns: [table.sheetId, table.bucketId], foreignColumns: [buckets.sheetId, buckets.id] }),
  uniqueIndex("splits_transaction_position").on(table.transactionId, table.position),
  check("splits_amount", sql`typeof(${table.amount}) = 'integer' AND ${table.amount} != 0 AND abs(${table.amount}) <= 9007199254740991`),
]);

// Immutable normalized input survives edits and tombstones. Import review/batches are added by the import stage.
export const transactionSources = sqliteTable("transaction_sources", {
  id: text("id").primaryKey(), sheetId: text("sheet_id").notNull(), transactionId: text("transaction_id").notNull(),
  accountId: text("account_id").notNull(), sourceProfile: text("source_profile").notNull(),
  sourceId: text("source_id"), date: text("date").notNull(), payee: text("payee").notNull(), amount: integer("amount").notNull(),
  fingerprint: text("fingerprint").notNull(), createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [
  foreignKey({ columns: [table.sheetId, table.transactionId], foreignColumns: [transactions.sheetId, transactions.id] }).onDelete("cascade"),
  foreignKey({ columns: [table.sheetId, table.accountId], foreignColumns: [financialAccounts.sheetId, financialAccounts.id] }),
  index("transaction_sources_identity_idx").on(table.sheetId, table.accountId, table.sourceProfile, table.sourceId),
  index("transaction_sources_fingerprint_idx").on(table.sheetId, table.accountId, table.sourceProfile, table.fingerprint),
]);
