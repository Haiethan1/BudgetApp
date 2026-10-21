import { sql } from "drizzle-orm";
import { check, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { sheets } from "./sheet-schema";
export const cycleChanges = sqliteTable("cycle_changes", {
  sheetId: text("sheet_id").notNull().references(() => sheets.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  transitionFrom: text("transition_from").notNull(),
  recurringFrom: text("recurring_from").notNull(),
  startDay: integer("start_day").notNull(),
}, (table) => [primaryKey({ columns: [table.sheetId, table.version] }), check("cycle_changes_day", sql`${table.startDay} BETWEEN 1 AND 31`)]);
