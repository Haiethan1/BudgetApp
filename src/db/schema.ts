import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** A harmless record used to prove that a mounted database survives restarts. */
export const foundationRecords = sqliteTable("foundation_records", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});
