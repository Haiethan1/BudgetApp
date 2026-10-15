import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { budgets, budgetDefaults, categories } from "../db/schema";
import type { openDatabase } from "../db/client";
import { budgetCycle, previewCycleChange, resolvePeriod, shiftMonth, type CycleSheet, type cycleChangeSchema } from "./cycle";
import type { z } from "zod";

export function planCycleChange(sheetId: string, sheet: CycleSheet, input: z.infer<typeof cycleChangeSchema>, connection: ReturnType<typeof openDatabase>) {
  const preview = previewCycleChange(sheet, input);
  const rows = connection.db.select().from(budgets).where(eq(budgets.sheetId, sheetId)).all().filter((row) => preview.transitionKind === "aligned" ? row.month >= preview.revision.transitionFrom : row.month > preview.revision.transitionFrom);
  const defaults = connection.db.select().from(budgetDefaults).where(eq(budgetDefaults.sheetId, sheetId)).all();
  const labels = connection.db.select().from(categories).where(eq(categories.sheetId, sheetId)).all();
  const retained = connection.db.select().from(budgets).where(and(eq(budgets.sheetId, sheetId), eq(budgets.month, preview.original.from))).all();
  const retainedLimits = labels.flatMap((category) => {
    const budget = retained.find((row) => row.categoryId === category.id);
    const fallback = defaults.find((row) => row.categoryId === category.id);
    if (!budget && fallback?.limit == null) return [];
    const inheritsDefault = !budget || budget.inheritsDefault;
    const limit = inheritsDefault ? fallback?.limit ?? null : budget.limit;
    return [{ category: category.name, limit, inheritsDefault, version: budget?.version ?? 0 }];
  });
  const ordinal = (value: string) => Number(value.slice(0, 4)) * 12 + Number(value.slice(5, 7));
  const mappings = rows.map((row) => {
    const offset = ordinal(row.month) - ordinal(preview.revision.transitionFrom);
    const key = budgetCycle(shiftMonth(preview.revision.recurringFrom.slice(0, 7), (preview.transitionKind === "aligned" ? offset : offset - 1)), input.startDay).from;
    return { category: labels.find((label) => label.id === row.categoryId)?.name ?? "Archived spending category", oldPeriod: resolvePeriod(row.month, sheet), newPeriod: resolvePeriod(key, preview.nextSheet), limit: row.limit, effectiveLimit: row.inheritsDefault ? defaults.find((fallback) => fallback.categoryId === row.categoryId)?.limit ?? null : row.limit, inheritsDefault: row.inheritsDefault, version: row.version, row };
  });
  const previewToken = createHash("sha256").update(JSON.stringify({ sheet, input: { startDay: input.startDay, effectiveDate: input.effectiveDate, transition: input.transition }, currentBefore: preview.currentBefore, retainedLimits, mappings })).digest("hex");
  return { ...preview, retainedLimits, mappings, previewToken };
}
export function moveFutureBudgets(sheetId: string, mappings: ReturnType<typeof planCycleChange>["mappings"], connection: ReturnType<typeof openDatabase>) {
  // Delete and reinsert as one transaction so a destination cannot collide with a source.
  for (const { row } of mappings) connection.db.delete(budgets).where(and(eq(budgets.sheetId, sheetId), eq(budgets.categoryId, row.categoryId), eq(budgets.month, row.month))).run();
  for (const { row, newPeriod } of mappings) connection.db.insert(budgets).values({ ...row, month: newPeriod.from }).run();
}
