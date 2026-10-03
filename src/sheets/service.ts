import { randomUUID } from "node:crypto";
import { and, eq, or } from "drizzle-orm";
import { z } from "zod";
import { getDatabase, type openDatabase } from "../db/client";
import { buckets, categories, sheetMembers, sheets } from "../db/schema";
import { createSheetSchema, referencesSchema, sheetIdSchema } from "./input";

type Connection = ReturnType<typeof openDatabase>;
export class SheetError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export function requireSheetAccess({ userId, sheetId, ownerOnly = false }: {
  userId: string; sheetId: string; ownerOnly?: boolean;
}, connection: Connection = getDatabase()) {
  const id = sheetIdSchema.parse(sheetId);
  const sheet = connection.db.select().from(sheets).where(eq(sheets.id, id)).get();
  if (!sheet) throw new SheetError("This sheet is unavailable. Choose another sheet.", 404);
  if (sheet.ownerId === userId) return { sheet, role: "owner" as const };
  const member = connection.db.select().from(sheetMembers)
    .where(and(eq(sheetMembers.sheetId, id), eq(sheetMembers.userId, userId))).get();
  if (!member) throw new SheetError("This sheet is unavailable. Choose another sheet.", 404);
  if (ownerOnly) throw new SheetError("Only the sheet owner can do this.", 403);
  return { sheet, role: "member" as const };
}

export function listSheets(userId: string, connection: Connection = getDatabase()) {
  const rows = connection.db.select({ sheet: sheets }).from(sheets).leftJoin(sheetMembers,
    and(eq(sheetMembers.sheetId, sheets.id), eq(sheetMembers.userId, userId)))
    .where(or(eq(sheets.ownerId, userId), eq(sheetMembers.userId, userId))).all();
  return rows.map(({ sheet }) => ({ id: sheet.id, name: sheet.name, currency: sheet.currency,
    role: sheet.ownerId === userId ? "owner" : "member" }));
}

export function createSheet(userId: string, input: unknown, connection: Connection = getDatabase()) {
  const parsed = createSheetSchema.parse(input);
  const id = randomUUID();
  connection.sqlite.transaction(() => {
    connection.db.insert(sheets).values({ id, ...parsed, ownerId: userId, createdAt: new Date() }).run();
    connection.db.insert(categories).values({ id: randomUUID(), sheetId: id, name: "Uncategorized", isProtected: true }).run();
    connection.db.insert(buckets).values({ id: randomUUID(), sheetId: id, name: "Unassigned", isProtected: true }).run();
  }).immediate();
  return requireSheetAccess({ userId, sheetId: id }, connection);
}

export function readSheet(userId: string, sheetId: string, connection: Connection = getDatabase()) {
  const access = requireSheetAccess({ userId, sheetId }, connection);
  return { id: access.sheet.id, name: access.sheet.name, currency: access.sheet.currency, role: access.role,
    categories: connection.db.select().from(categories).where(eq(categories.sheetId, sheetId)).all(),
    buckets: connection.db.select().from(buckets).where(eq(buckets.sheetId, sheetId)).all() };
}

export function requireSheetReferences({ userId, sheetId, references }: {
  userId: string; sheetId: string; references: z.infer<typeof referencesSchema>;
}, connection: Connection = getDatabase()) {
  requireSheetAccess({ userId, sheetId }, connection);
  for (const reference of references) {
    const table = reference.kind === "category" ? categories : buckets;
    const row = connection.db.select().from(table).where(and(eq(table.id, reference.id), eq(table.sheetId, sheetId))).get();
    if (!row) throw new SheetError("A selected item does not belong to this sheet.", 400);
  }
}

export function accessibleSelection(userId: string, selectedId: string | undefined, connection: Connection = getDatabase()) {
  const available = listSheets(userId, connection);
  return available.find((sheet) => sheet.id === selectedId) ?? available[0];
}
