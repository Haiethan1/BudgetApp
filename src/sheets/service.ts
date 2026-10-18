import { randomUUID } from "node:crypto";
import { and, eq, or } from "drizzle-orm";
import { z } from "zod";
import { getDatabase, type openDatabase } from "../db/client";
import { buckets, categories, cycleChanges, financialAccounts, sheetMembers, sheets, user, importProfiles } from "../db/schema";
import { effectiveDefault } from "../budgets/defaults";
import { currentPeriod } from "./cycle";
import { createSheetSchema, referencesSchema, sheetIdSchema } from "./input";

type Connection = ReturnType<typeof openDatabase>;
import { SheetError } from "./error";
export { SheetError } from "./error";

export function requireSheetAccess({ userId, sheetId, ownerOnly = false }: {
  userId: string; sheetId: string; ownerOnly?: boolean;
}, connection: Connection = getDatabase()) {
  const id = sheetIdSchema.parse(sheetId);
  const stored = connection.db.select().from(sheets).where(eq(sheets.id, id)).get();
  const sheet = stored ? { ...stored, cycleHistory: { baselineDay: stored.cycleBaselineDay, revisions: connection.db.select().from(cycleChanges).where(eq(cycleChanges.sheetId, id)).orderBy(cycleChanges.version).all().map(({ transitionFrom, recurringFrom, startDay }) => ({ transitionFrom, recurringFrom, startDay })) } } : undefined;
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
    connection.db.insert(buckets).values({ id: randomUUID(), sheetId: id, name: "Me", isProtected: true }).run();
  }).immediate();
  return requireSheetAccess({ userId, sheetId: id }, connection);
}

export function readSheet(userId: string, sheetId: string, connection: Connection = getDatabase()) {
  const access = requireSheetAccess({ userId, sheetId }, connection);
  const accounts = connection.db.select().from(financialAccounts).where(eq(financialAccounts.sheetId, sheetId)).all();
  const categoryRows = connection.db.select().from(categories).where(eq(categories.sheetId, sheetId)).all();
  const groupRows = connection.db.select().from(buckets).where(eq(buckets.sheetId, sheetId)).all();
  const activeAccounts = accounts.filter((row) => !row.isArchived);
  const period = currentPeriod(access.sheet);
  const setup = { accounts: activeAccounts.length, categories: categoryRows.filter((row) => !row.isArchived && !row.isProtected).length,
    groups: groupRows.filter((row) => !row.isArchived && !row.isProtected).length,
    budgets: categoryRows.filter((row) => !row.isArchived && effectiveDefault(sheetId, row.id, period, connection)?.limit != null).length,
    formats: connection.db.select().from(importProfiles).where(and(eq(importProfiles.sheetId, sheetId), eq(importProfiles.reusable, true))).all().filter((row) => activeAccounts.some((account) => account.id === row.accountId)).length,
    cycleDay: access.sheet.cycleStartDay, completed: access.sheet.setupCompleted };
  if (!setup.completed && setup.accounts > 0 && [setup.categories, setup.groups, setup.budgets, setup.formats].every(count => count > 0)) {
    connection.db.update(sheets).set({ setupCompleted: true }).where(eq(sheets.id, sheetId)).run();
    setup.completed = true;
  }
  return { id: access.sheet.id, name: access.sheet.name, currency: access.sheet.currency, role: access.role, cycleStartDay: access.sheet.cycleStartDay, cycleVersion: access.sheet.cycleVersion, cycleHistory: access.sheet.cycleHistory,
    setup, accounts,
    people: connection.db.select({ id: user.id, name: user.name, username: user.username }).from(user).where(eq(user.id, access.sheet.ownerId)).all().map((person) => ({ ...person, role: "owner" } )).concat(connection.db.select({ id: user.id, name: user.name, username: user.username }).from(sheetMembers).innerJoin(user, eq(user.id, sheetMembers.userId)).where(eq(sheetMembers.sheetId, sheetId)).all().map((person) => ({ ...person, role: "member" }))),
    categories: categoryRows, buckets: groupRows };
}

export function requireSheetReferences({ userId, sheetId, references }: {
  userId: string; sheetId: string; references: z.infer<typeof referencesSchema>;
}, connection: Connection = getDatabase()) {
  requireSheetAccess({ userId, sheetId }, connection);
  for (const reference of references) {
    const table = reference.kind === "account" ? financialAccounts : reference.kind === "category" ? categories : buckets;
    const row = connection.db.select().from(table).where(and(eq(table.id, reference.id), eq(table.sheetId, sheetId))).get();
    if (!row) throw new SheetError("A selected item does not belong to this sheet.", 400);
    if (row.isArchived) throw new SheetError("Choose an active item for a new allocation.", 400);
  }
}

export function accessibleSelection(userId: string, selectedId: string | undefined, connection: Connection = getDatabase()) {
  const available = listSheets(userId, connection);
  return available.find((sheet) => sheet.id === selectedId) ?? available[0];
}
