import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { user } from "./auth-schema";

export * from "./auth-schema";
export * from "./sheet-schema";

export const instanceSetup = sqliteTable("instance_setup", {
  key: text("key").primaryKey(),
  adminId: text("admin_id").notNull().references(() => user.id),
  completedAt: integer("completed_at", { mode: "timestamp_ms" }).notNull(),
});

/** A harmless record used to prove that a mounted database survives restarts. */
export const foundationRecords = sqliteTable("foundation_records", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});
export * from "./ledger-schema";
export * from "./import-schema";
export * from "./budget-schema";
