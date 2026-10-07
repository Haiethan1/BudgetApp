import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { user } from "./auth-schema";
import { sheets } from "./sheet-schema";

export const sheetInvites = sqliteTable("sheet_invites", {
  id: text("id").primaryKey(),
  sheetId: text("sheet_id").notNull().references(() => sheets.id, { onDelete: "cascade" }),
  inviterId: text("inviter_id").notNull().references(() => user.id),
  inviteeId: text("invitee_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  state: text("state", { enum: ["pending", "accepted", "declined", "revoked"] }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [
  uniqueIndex("sheet_invites_pending_unique").on(table.sheetId, table.inviteeId).where(sql`${table.state} = 'pending'`),
  index("sheet_invites_recipient_idx").on(table.inviteeId),
  check("sheet_invites_state_check", sql`${table.state} IN ('pending', 'accepted', 'declined', 'revoked')`),
]);

export const sharingRateLimits = sqliteTable("sharing_rate_limits", {
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  kind: text("kind", { enum: ["search", "invite"] }).notNull(),
  windowStart: integer("window_start").notNull(),
  count: integer("count").notNull(),
}, (table) => [primaryKey({ columns: [table.userId, table.kind] })]);
