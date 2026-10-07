import { sql } from "drizzle-orm";
import { check, foreignKey, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { categories, sheets } from "./sheet-schema";

export const budgets = sqliteTable("budgets", {
  sheetId: text("sheet_id").notNull().references(() => sheets.id, { onDelete: "cascade" }),
  categoryId: text("category_id").notNull(), month: text("month").notNull(),
  // A null limit retains the revision after removal, so stale creations cannot overwrite a later removal.
  limit: integer("limit"), version: integer("version").notNull(),
}, (table) => [primaryKey({ columns: [table.sheetId, table.categoryId, table.month] }),
  foreignKey({ columns: [table.sheetId, table.categoryId], foreignColumns: [categories.sheetId, categories.id] }),
  check("budgets_limit", sql`${table.limit} IS NULL OR (typeof(${table.limit}) = 'integer' AND ${table.limit} >= 0 AND ${table.limit} <= 9007199254740991)`),
  check("budgets_version", sql`typeof(${table.version}) = 'integer' AND ${table.version} > 0`),
  check("budgets_month", sql`${table.month} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]' AND substr(${table.month}, 1, 4) != '0000' AND substr(${table.month}, 6, 2) BETWEEN '01' AND '12'`),
]);
