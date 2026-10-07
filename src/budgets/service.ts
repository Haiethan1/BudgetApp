import { and, asc, eq } from "drizzle-orm";
import { getDatabase, type openDatabase } from "../db/client";
import { budgets, categories } from "../db/schema";
import { calculateSpending } from "../ledger/service";
import { monthSchema } from "../ledger/input";
import { requireSheetAccess, SheetError } from "../sheets/service";
import { budgetMutation, parseLimit } from "./input";

type Connection = ReturnType<typeof openDatabase>;
function exact(value: bigint) {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount)) throw new SheetError("Budget totals exceed the supported range. Review the limits and spending in this sheet.", 400);
  return amount;
}
export function readBudgets(userId: string, sheetId: string, month: string, connection: Connection = getDatabase()) {
  const selected = monthSchema.parse(month);
  return connection.sqlite.transaction(() => {
    requireSheetAccess({ userId, sheetId }, connection);
    const spending = calculateSpending(userId, sheetId, selected, connection);
    const limits = connection.db.select().from(budgets).where(and(eq(budgets.sheetId, sheetId), eq(budgets.month, selected))).all();
    const rows = connection.db.select().from(categories).where(eq(categories.sheetId, sheetId)).orderBy(asc(categories.name), asc(categories.id)).all().map((category) => {
      const budget = limits.find((limit) => limit.categoryId === category.id);
      const spent = spending.categories[category.id] ?? 0;
      const limit = budget?.limit ?? null;
      return { categoryId: category.id, name: category.name, archived: category.isArchived, version: budget?.version ?? 0, limit, spent, remaining: limit === null ? null : exact(BigInt(limit) - BigInt(spent)) };
    }).filter((row) => !row.archived || row.limit !== null || row.spent !== 0);
    const budgeted = rows.filter((row) => row.limit !== null);
    const totalLimits = budgeted.reduce((sum, row) => sum + BigInt(row.limit ?? 0), 0n);
    const budgetedSpent = budgeted.reduce((sum, row) => sum + BigInt(row.spent), 0n);
    return { ...spending, rows, totalLimits: exact(totalLimits), budgetedSpent: exact(budgetedSpent), remaining: exact(totalLimits - budgetedSpent) };
  })();
}
export function mutateBudget(userId: string, sheetId: string, input: unknown, connection: Connection = getDatabase()) {
  const parsed = budgetMutation.parse(input);
  return connection.sqlite.transaction(() => {
    const { sheet } = requireSheetAccess({ userId, sheetId }, connection);
    const category = connection.db.select().from(categories).where(and(eq(categories.sheetId, sheetId), eq(categories.id, parsed.categoryId))).get();
    if (!category) throw new SheetError("Choose a category from this sheet.", 400);
    const where = and(eq(budgets.sheetId, sheetId), eq(budgets.categoryId, parsed.categoryId), eq(budgets.month, parsed.month));
    const current = connection.db.select().from(budgets).where(where).get();
    if ((current?.version ?? 0) !== parsed.version) throw new SheetError("Someone updated this monthly limit. Reload latest before saving or removing it.", 409);
    if (category.isArchived && parsed.kind === "save" && current?.limit == null) throw new SheetError("Restore this category in Settings before setting a new limit.", 400);
    let limit: number | null = null;
    if (parsed.kind === "save") {
      try { limit = parseLimit(parsed.amount, sheet.currency); }
      catch (error) { throw new SheetError(error instanceof Error ? error.message : "Enter a valid monthly limit.", 400); }
    } else if (current?.limit == null) throw new SheetError("Someone removed this monthly limit. Reload latest.", 409);
    const version = parsed.version + 1;
    if (current) connection.db.update(budgets).set({ limit, version }).where(where).run();
    else connection.db.insert(budgets).values({ sheetId, categoryId: parsed.categoryId, month: parsed.month, limit, version }).run();
    return { message: parsed.kind === "save" ? "Monthly limit saved." : "Monthly limit removed." };
  }).immediate();
}
