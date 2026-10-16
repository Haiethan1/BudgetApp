import { and, asc, eq } from "drizzle-orm";
import { getDatabase, type openDatabase } from "../db/client";
import { budgets, budgetDefaults, budgetDefaultChanges, categories } from "../db/schema";
import { calculateSpending } from "../ledger/service";
import { resolvePeriod, adjacentPeriod, currentPeriod } from "../sheets/cycle";
import { requireSheetAccess, SheetError } from "../sheets/service";
import { budgetMutation, parseLimit } from "./input";

import { effectiveDefault } from "./defaults";
import { planningBreakdown } from "../plans/service";

type Connection = ReturnType<typeof openDatabase>;
function exact(value: bigint) {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount)) throw new SheetError("Budget totals exceed the supported range. Review the limits and spending in this sheet.", 400);
  return amount;
}
export function readBudgets(userId: string, sheetId: string, month: string, connection: Connection = getDatabase()) {

  return connection.sqlite.transaction(() => {
    const { sheet } = requireSheetAccess({ userId, sheetId }, connection);
    const selected = resolvePeriod(month, sheet).from;
    const currentStart = currentPeriod(sheet);
    const currentLimits = connection.db.select().from(budgets).where(and(eq(budgets.sheetId, sheetId), eq(budgets.month, currentStart))).all();
    const spending = calculateSpending(userId, sheetId, selected, connection);
    const planning = planningBreakdown(sheetId, spending.cycle.from, spending.cycle.to, sheet, connection);
    const limits = connection.db.select().from(budgets).where(and(eq(budgets.sheetId, sheetId), eq(budgets.month, selected))).all();
    const defaults = connection.db.select().from(budgetDefaults).where(eq(budgetDefaults.sheetId, sheetId)).all();
    const rows = connection.db.select().from(categories).where(eq(categories.sheetId, sheetId)).orderBy(asc(categories.name), asc(categories.id)).all().map((category) => {
      const budget = limits.find((limit) => limit.categoryId === category.id);
      const spent = spending.categories[category.id] ?? 0;
      const contribution = planning[category.id] ?? { planned: 0, reconciliation: 0, matched: 0 };
      const budgetUsed = exact(BigInt(spent) + BigInt(contribution.planned) + BigInt(contribution.reconciliation) - BigInt(contribution.matched));
      const fallback = defaults.find((row) => row.categoryId === category.id);
      const historical = effectiveDefault(sheetId, category.id, selected, connection);
      const currentOverride = currentLimits.find((row) => row.categoryId === category.id);
      const source = !budget || budget.inheritsDefault ? "default" as const : "month" as const;
      const limit = source === "default" ? historical?.limit ?? null : budget?.limit ?? null;
      return { ...contribution, budgetUsed, effectiveFrom: currentStart, currentVersion: currentOverride?.version ?? 0, currentSource: !currentOverride || currentOverride.inheritsDefault ? "default" as const : "month" as const, currentLimit: !currentOverride || currentOverride.inheritsDefault ? effectiveDefault(sheetId, category.id, currentStart, connection)?.limit ?? null : currentOverride.limit, periodDefaultLimit: historical?.limit ?? null, categoryId: category.id, name: category.name, archived: category.isArchived, version: budget?.version ?? 0, defaultVersion: fallback?.version ?? 0, defaultLimit: fallback?.limit ?? null, source, limit, spent, remaining: limit === null ? null : exact(BigInt(limit) - BigInt(budgetUsed)) };
    }).filter((row) => !row.archived || row.defaultLimit !== null || row.limit !== null || row.spent !== 0 || row.budgetUsed !== 0);
    const budgeted = rows.filter((row) => row.limit !== null);
    const totalLimits = budgeted.reduce((sum, row) => sum + BigInt(row.limit ?? 0), 0n);
    const budgetedSpent = budgeted.reduce((sum, row) => sum + BigInt(row.spent), 0n);
    const budgetedUsed = budgeted.reduce((sum, row) => sum + BigInt(row.budgetUsed), 0n);
    return { ...spending, rows, totalLimits: exact(totalLimits), budgetedSpent: exact(budgetedSpent), budgetedUsed: exact(budgetedUsed), remaining: exact(totalLimits - budgetedUsed) };
  })();
}
export function mutateBudget(userId: string, sheetId: string, input: unknown, connection: Connection = getDatabase()) {
  const parsed = budgetMutation.parse(input);
  return connection.sqlite.transaction(() => {
    const { sheet } = requireSheetAccess({ userId, sheetId }, connection);
    const category = connection.db.select().from(categories).where(and(eq(categories.sheetId, sheetId), eq(categories.id, parsed.categoryId))).get();
    if (!category) throw new SheetError("Choose a spending category from this sheet.", 400);
    const defaultWhere = and(eq(budgetDefaults.sheetId, sheetId), eq(budgetDefaults.categoryId, parsed.categoryId));
    const fallback = connection.db.select().from(budgetDefaults).where(defaultWhere).get();
    const actualCurrent = currentPeriod(sheet);
    const currentWhere = and(eq(budgets.sheetId, sheetId), eq(budgets.categoryId, parsed.categoryId), eq(budgets.month, actualCurrent));
    const currentOverride = connection.db.select().from(budgets).where(currentWhere).get();
    function saveDefault(limit: number | null, expected: number) {
      if (!("effectiveFrom" in parsed) || parsed.effectiveFrom !== actualCurrent || !("currentVersion" in parsed) || parsed.currentVersion !== (currentOverride?.version ?? 0) || parsed.cycleVersion !== sheet.cycleVersion) throw new SheetError("The current period, its override, or the budget cycle changed. Reload latest before saving the default.", 409);
      if ((fallback?.version ?? 0) !== expected) throw new SheetError("Someone updated this default limit. Reload latest before saving.", 409);
      if (category?.isArchived && limit !== null && fallback?.limit == null) throw new SheetError("Restore this spending category in Settings before setting a new limit.", 400);
      const version = expected + 1;
      connection.db.insert(budgetDefaultChanges).values({ sheetId, categoryId: parsed.categoryId, effectiveFrom: actualCurrent, limit, version }).run();
      if ("replaceCurrent" in parsed && parsed.replaceCurrent && currentOverride && !currentOverride.inheritsDefault) connection.db.update(budgets).set({ limit: null, inheritsDefault: true, version: currentOverride.version + 1 }).where(currentWhere).run();
      if (fallback) connection.db.update(budgetDefaults).set({ limit, version }).where(defaultWhere).run();
      else connection.db.insert(budgetDefaults).values({ sheetId, categoryId: parsed.categoryId, limit, version }).run();
    }
    function amountLimit(amount: string) {
      try { return parseLimit(amount, sheet.currency); }
      catch (error) { throw new SheetError(error instanceof Error ? error.message : "Enter a valid limit.", 400); }
    }
    if (parsed.kind === "saveDefault" || parsed.kind === "removeDefault") {
      saveDefault(parsed.kind === "saveDefault" ? amountLimit(parsed.amount) : null, parsed.version);
      return { message: parsed.kind === "saveDefault" ? "Default limit saved from the current period onward. Earlier periods and retained overrides are unchanged." : "Default limit removed from the current period onward. Earlier periods and retained overrides are unchanged." };
    }
    if (parsed.cycleVersion !== undefined && parsed.cycleVersion !== sheet.cycleVersion) throw new SheetError("The budget cycle changed. Reload latest before saving this limit.", 409);
    if (sheet.cycleHistory.revisions.length > 0 && parsed.cycleVersion === undefined) throw new SheetError("The budget cycle changed. Reload latest before saving this limit.", 409);
    const selected = resolvePeriod(parsed.month, sheet).from;
    if (parsed.month.length === 7 && (selected.slice(0, 7) !== parsed.month || (adjacentPeriod(selected, 1, sheet) !== selected && adjacentPeriod(selected, 1, sheet).slice(0, 7) === parsed.month))) throw new SheetError("Choose an exact period start before saving this limit.", 409);
    if (parsed.month.length === 10 && selected !== parsed.month) throw new SheetError("This period changed. Reload latest before saving.", 409);
    const where = and(eq(budgets.sheetId, sheetId), eq(budgets.categoryId, parsed.categoryId), eq(budgets.month, selected));
    const current = connection.db.select().from(budgets).where(where).get();
    if ((current?.version ?? 0) !== parsed.version) throw new SheetError("Someone updated this monthly limit. Reload latest before saving or removing it.", 409);
    const effective = !current || current.inheritsDefault ? effectiveDefault(sheetId, parsed.categoryId, selected, connection)?.limit ?? null : current.limit;
    if (category.isArchived && parsed.kind === "save" && effective === null) throw new SheetError("Restore this spending category in Settings before setting a new limit.", 400);
    if (parsed.kind === "remove" && effective === null) throw new SheetError("Someone removed this monthly limit. Reload latest.", 409);
    const limit = parsed.kind === "save" ? amountLimit(parsed.amount) : null;
    if (parsed.kind === "save" && parsed.makeDefault) {
      saveDefault(limit, parsed.defaultVersion ?? 0);
      if (selected === actualCurrent && current && !current.inheritsDefault && !parsed.replaceCurrent) return { message: "Default saved from the current period onward. The current override is unchanged." };
    }
    const inheritsDefault = parsed.kind === "useDefault" || (parsed.kind === "save" && parsed.makeDefault === true && selected === actualCurrent && (parsed.replaceCurrent === true || !current || current.inheritsDefault));
    const version = parsed.version + 1;
    const values = { limit: inheritsDefault ? null : limit, version, inheritsDefault };
    if (current) connection.db.update(budgets).set(values).where(where).run();
    else connection.db.insert(budgets).values({ sheetId, categoryId: parsed.categoryId, month: selected, ...values }).run();
    return { message: parsed.kind === "save" ? "Monthly limit saved." : parsed.kind === "useDefault" ? "This month now uses the default limit." : "Monthly limit removed." };
  }).immediate();
}
