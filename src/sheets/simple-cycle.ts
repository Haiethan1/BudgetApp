import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDatabase, type openDatabase } from "../db/client";
import { budgetDefaultChanges, budgets, cycleChanges, paymentPlans, planContributions, sheets } from "../db/schema";
import { contributionSchedule, exactPlanAmount } from "../plans/schedule";
import { budgetCycle, currentPeriod, periodContaining, shiftDate, simpleCycleSchedule, today, cycleStartDaySchema } from "./cycle";
import { requireSheetAccess, SheetError } from "./service";

export const simpleCycleInput = z.object({ kind: z.literal("setBudgetCycle"), startDay: cycleStartDaySchema, futureOnly: z.boolean().default(false), version: z.number().int().positive(), preview: z.boolean().default(false), previewToken: z.string().optional() });
type Connection = ReturnType<typeof openDatabase>;

export function setSimpleCycle(userId: string, sheetId: string, input: unknown, c: Connection = getDatabase()) {
  const p = simpleCycleInput.parse(input);
  return c.sqlite.transaction(() => {
    const { sheet } = requireSheetAccess({ userId, sheetId, ownerOnly: true }, c);
    if (sheet.cycleVersion !== p.version) throw new SheetError("Someone changed the budget cycle. Reload latest before saving.", 409);
    const schedule = simpleCycleSchedule(sheet, p.startDay, p.futureOnly);
    const { nextSheet, cutoff } = schedule;
    const mapPeriod = (from: string) => {
      if (cutoff && from < cutoff || from === "0001-01-01") return periodContaining(from, nextSheet);
      const mapped = budgetCycle(from.slice(0, 7), p.startDay).from;
      return periodContaining(cutoff && mapped < cutoff ? cutoff : mapped, nextSheet);
    };
    const overrides = c.db.select().from(budgets).where(eq(budgets.sheetId, sheetId)).all();
    const mappings = overrides.map(row => ({ row, from: mapPeriod(row.month).from }));
    const destinations = new Set<string>();
    for (const { row, from } of mappings) {
      const key = JSON.stringify([row.categoryId, from]);
      if (destinations.has(key)) throw new SheetError("Two saved limits would land in the same cycle. Resolve those period overrides in Budgets, or choose only future cycles.", 400);
      destinations.add(key);
    }
    const defaults = c.db.select().from(budgetDefaultChanges).where(eq(budgetDefaultChanges.sheetId, sheetId)).all();
    const plans = c.db.select().from(paymentPlans).where(eq(paymentPlans.sheetId, sheetId)).all();
    const contributions = c.db.select().from(planContributions).where(eq(planContributions.sheetId, sheetId)).all();
    const planSchedules = plans.map(plan => {
      const retained = contributions.filter(row => row.planId === plan.id && (plan.status !== "active" || (p.futureOnly ? row.from <= currentPeriod(sheet) : row.from < currentPeriod(sheet))));
      const periods = new Map<string, { from: string; to: string; amount: number }>();
      for (const row of retained) {
        const period = mapPeriod(row.from);
        const prior = periods.get(period.from);
        periods.set(period.from, { from: period.from, to: period.to, amount: exactPlanAmount(BigInt(prior?.amount ?? 0) + BigInt(row.amount)) });
      }
      const history = [...periods.values()].sort((a, b) => a.from.localeCompare(b.from));
      if (plan.status !== "active") return { plan, rows: history };
      const completed = exactPlanAmount(history.reduce((sum, row) => sum + BigInt(row.amount), 0n));
      const last = history.at(-1);
      const startDate = last && last.to >= today() ? shiftDate(last.to, 1) : today();
      return { plan, rows: [...history, ...contributionSchedule({ expected: plan.expected, completed, startDate, dueDate: plan.dueDate, sheet: nextSheet })] };
    });
    const previewToken = createHash("sha256").update(JSON.stringify({ schedule, mappings, defaults, plans, contributions, planSchedules })).digest("hex");
    if (p.preview) return { previewToken, currentBefore: schedule.currentBefore, currentAfter: schedule.currentAfter, firstNewPeriod: schedule.firstNewPeriod };
    if (p.previewToken !== previewToken) throw new SheetError("The cycle or its limits changed. Review the latest setting before saving.", 409);
    c.db.delete(budgets).where(eq(budgets.sheetId, sheetId)).run();
    for (const { row, from } of mappings) c.db.insert(budgets).values({ ...row, month: from }).run();
    for (const row of defaults) c.db.update(budgetDefaultChanges).set({ effectiveFrom: mapPeriod(row.effectiveFrom).from }).where(and(eq(budgetDefaultChanges.sheetId, sheetId), eq(budgetDefaultChanges.categoryId, row.categoryId), eq(budgetDefaultChanges.version, row.version))).run();
    c.db.delete(planContributions).where(eq(planContributions.sheetId, sheetId)).run();
    for (const { plan, rows } of planSchedules) {
      for (const row of rows) c.db.insert(planContributions).values({ ...row, sheetId, planId: plan.id, categoryId: plan.categoryId }).run();
      c.db.update(paymentPlans).set({ version: plan.version + 1, updatedAt: Date.now() }).where(eq(paymentPlans.id, plan.id)).run();
    }
    c.db.delete(cycleChanges).where(eq(cycleChanges.sheetId, sheetId)).run();
    for (const [index, revision] of nextSheet.cycleHistory.revisions.entries()) c.db.insert(cycleChanges).values({ sheetId, version: index + 1, ...revision }).run();
    c.db.update(sheets).set({ cycleStartDay: p.startDay, cycleBaselineDay: nextSheet.cycleHistory.baselineDay, cycleVersion: sheet.cycleVersion + 1 }).where(eq(sheets.id, sheetId)).run();
    return { message: "Budget cycle saved." };
  }).immediate();
}
