import { foreignKey, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { user } from "./auth-schema";
import { financialAccounts, sheets } from "./sheet-schema";
import { transactions } from "./ledger-schema";

export const importProfiles = sqliteTable("import_profiles", {
  id: text("id").primaryKey(), sheetId: text("sheet_id").notNull().references(() => sheets.id, { onDelete: "cascade" }),
  accountId: text("account_id").notNull(), name: text("name").notNull(), nameKey: text("name_key").notNull(),
  mapping: text("mapping").notNull(), version: integer("version").notNull().default(1),
}, (t) => [uniqueIndex("import_profiles_scope_id").on(t.sheetId, t.accountId, t.id),
  uniqueIndex("import_profiles_name").on(t.accountId, t.nameKey),
  foreignKey({ columns: [t.sheetId, t.accountId], foreignColumns: [financialAccounts.sheetId, financialAccounts.id] })]);

export const importBatches = sqliteTable("import_batches", {
  id: text("id").primaryKey(), sheetId: text("sheet_id").notNull().references(() => sheets.id, { onDelete: "cascade" }),
  accountId: text("account_id").notNull(), profileId: text("profile_id").notNull(), mapping: text("mapping").notNull(),
  fileHash: text("file_hash").notNull(), mappingHash: text("mapping_hash").notNull(),
  state: text("state", { enum: ["review", "committed"] }).notNull().default("review"), version: integer("version").notNull().default(1),
  snapshot: text("snapshot").notNull(), result: text("result"),
  creatorId: text("creator_id").notNull().references(() => user.id), createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  committedAt: integer("committed_at", { mode: "timestamp_ms" }),
}, (t) => [uniqueIndex("import_batches_sheet_id").on(t.sheetId, t.id),
  index("import_batches_repeat").on(t.sheetId, t.accountId, t.profileId, t.fileHash, t.mappingHash, t.state),
  foreignKey({ columns: [t.sheetId, t.accountId, t.profileId], foreignColumns: [importProfiles.sheetId, importProfiles.accountId, importProfiles.id] })]);

export const importRows = sqliteTable("import_rows", {
  id: text("id").primaryKey(), sheetId: text("sheet_id").notNull(), batchId: text("batch_id").notNull(),
  sourceRow: integer("source_row").notNull(), original: text("original").notNull(), source: text("source"),
  proposed: text("proposed"), errors: text("errors").notNull(), matching: text("matching").notNull(),
  decision: text("decision", { enum: ["pending", "keep", "skip", "exclude"] }).notNull().default("pending"),
  kindReviewed: integer("kind_reviewed", { mode: "boolean" }).notNull().default(false),
  transactionId: text("transaction_id"),
}, (t) => [uniqueIndex("import_rows_position").on(t.batchId, t.sourceRow),
  foreignKey({ columns: [t.sheetId, t.batchId], foreignColumns: [importBatches.sheetId, importBatches.id] }).onDelete("cascade"),
  foreignKey({ columns: [t.sheetId, t.transactionId], foreignColumns: [transactions.sheetId, transactions.id] })]);
