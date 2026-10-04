import { sql } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { user } from "./auth-schema";

export const sheets = sqliteTable("sheets", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  currency: text("currency").notNull(),
  ownerId: text("owner_id").notNull().references(() => user.id),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [index("sheets_owner_idx").on(table.ownerId)]);

// Rows represent accepted non-owner members. Pending invitations live elsewhere.
export const sheetMembers = sqliteTable("sheet_members", {
  sheetId: text("sheet_id").notNull().references(() => sheets.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  acceptedAt: integer("accepted_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [primaryKey({ columns: [table.sheetId, table.userId] }), index("sheet_members_user_idx").on(table.userId)]);

export const categories = sqliteTable("categories", {
  id: text("id").primaryKey(),
  sheetId: text("sheet_id").notNull().references(() => sheets.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  isProtected: integer("is_protected", { mode: "boolean" }).notNull().default(false),
  isArchived: integer("is_archived", { mode: "boolean" }).notNull().default(false),
}, (table) => [uniqueIndex("categories_sheet_id_unique").on(table.sheetId, table.id),
  uniqueIndex("categories_protected_default_unique").on(table.sheetId).where(sql`${table.isProtected} = 1`)]);

export const buckets = sqliteTable("buckets", {
  id: text("id").primaryKey(),
  sheetId: text("sheet_id").notNull().references(() => sheets.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  isProtected: integer("is_protected", { mode: "boolean" }).notNull().default(false),
  isArchived: integer("is_archived", { mode: "boolean" }).notNull().default(false),
}, (table) => [uniqueIndex("buckets_sheet_id_unique").on(table.sheetId, table.id),
  uniqueIndex("buckets_protected_default_unique").on(table.sheetId).where(sql`${table.isProtected} = 1`)]);

export const financialAccounts = sqliteTable("financial_accounts", {
  id: text("id").primaryKey(),
  sheetId: text("sheet_id").notNull().references(() => sheets.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  sourceType: text("source_type", { enum: ["bank", "credit_card", "cash", "other"] }).notNull(),
  isArchived: integer("is_archived", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [uniqueIndex("financial_accounts_sheet_id_unique").on(table.sheetId, table.id)]);
