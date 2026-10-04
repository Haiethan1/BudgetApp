import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDatabase, type openDatabase } from "../db/client";
import { buckets, categories, financialAccounts, sheets, user } from "../db/schema";
import { requireSheetAccess, SheetError } from "./service";

import { settingsMutation, displayNameSchema } from "./settings-input";
type Connection = ReturnType<typeof openDatabase>;
const normalizedName = (name: string) => name.normalize("NFKC").toLocaleLowerCase("en-US");

export function mutateSettings(userId: string, sheetId: string, input: unknown, connection: Connection = getDatabase()) {
  const mutation = settingsMutation.parse(input);
  return connection.sqlite.transaction(() => {
    const access = requireSheetAccess({ userId, sheetId, ownerOnly: mutation.kind === "renameSheet" || mutation.kind === "deleteSheet" }, connection);
    if (mutation.kind === "renameSheet") {
      connection.db.update(sheets).set({ name: mutation.name }).where(eq(sheets.id, sheetId)).run(); return;
    }
    if (mutation.kind === "deleteSheet") {
      if (mutation.confirmation !== access.sheet.name) throw new SheetError("Type the sheet name exactly to delete it.", 400);
      connection.db.delete(sheets).where(eq(sheets.id, sheetId)).run(); return;
    }
    const table = mutation.entity === "account" ? financialAccounts : mutation.entity === "category" ? categories : buckets;
    const records = connection.db.select().from(table).where(eq(table.sheetId, sheetId)).all();
    if (mutation.kind === "create" || mutation.kind === "rename") {
      if (records.some((row) => normalizedName(row.name) === normalizedName(mutation.name) && (mutation.kind === "create" || row.id !== mutation.id))) {
        throw new SheetError("This name is already used in this sheet, including archived items. Choose another name.", 409);
      }
    }
    if (mutation.kind === "create") {
      const values = { id: randomUUID(), sheetId, name: mutation.name };
      if (mutation.entity === "account") {
        if (!mutation.sourceType) throw new SheetError("Choose an account source type.", 400);
        connection.db.insert(financialAccounts).values({ ...values, sourceType: mutation.sourceType, createdAt: new Date(), updatedAt: new Date() }).run();
      } else if (mutation.entity === "category") connection.db.insert(categories).values(values).run();
      else connection.db.insert(buckets).values(values).run();
      return;
    }
    const record = records.find((row) => row.id === mutation.id);
    if (!record) throw new SheetError("This item is unavailable in this sheet. Reload Settings.", 404);
    if ("isProtected" in record && record.isProtected) throw new SheetError("Protected defaults cannot be renamed or archived.", 400);
    const values = mutation.kind === "rename" ? { name: mutation.name } : { isArchived: mutation.kind === "archive" };
    connection.db.update(table).set({ ...values, ...(mutation.entity === "account" ? { updatedAt: new Date() } : {}) })
      .where(and(eq(table.id, mutation.id), eq(table.sheetId, sheetId))).run();
  }).immediate();
}

export function updateDisplayName(userId: string, input: unknown, connection: Connection = getDatabase()) {
  const parsed = displayNameSchema.parse(input);
  connection.db.update(user).set({ name: parsed.name, updatedAt: new Date() }).where(eq(user.id, userId)).run();
}

export function activeOrganization(userId: string, sheetId: string, connection: Connection = getDatabase()) {
  requireSheetAccess({ userId, sheetId }, connection);
  return {
    accounts: connection.db.select().from(financialAccounts).where(and(eq(financialAccounts.sheetId, sheetId), eq(financialAccounts.isArchived, false))).all(),
    categories: connection.db.select().from(categories).where(and(eq(categories.sheetId, sheetId), eq(categories.isArchived, false))).all(),
    buckets: connection.db.select().from(buckets).where(and(eq(buckets.sheetId, sheetId), eq(buckets.isArchived, false))).all(),
  };
}


