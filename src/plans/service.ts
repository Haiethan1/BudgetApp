import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq, gte, isNull, lte } from "drizzle-orm";
import { getDatabase, type openDatabase } from "../db/client";
import { categories, paymentPlans, planContributions, planAdjustments, planRequests, splits, transactions } from "../db/schema";
import { parseLimit } from "../budgets/input";
import { requireSheetAccess, SheetError } from "../sheets/service";
import { currentPeriod, periodContaining, today, type CycleSheet } from "../sheets/cycle";
import { planMutation, type PlanRecord } from "./input";
import { contributionSchedule, exactPlanAmount, nextOccurrence } from "./schedule";
import { displayAmount } from "../ledger/presentation";
type Connection = ReturnType<typeof openDatabase>;
type Plan = typeof paymentPlans.$inferSelect;
const sum = (values: number[]) => exactPlanAmount(values.reduce((total, value) => total + BigInt(value), 0n));
function contributions(planId: string, connection: Connection) { return connection.db.select().from(planContributions).where(eq(planContributions.planId, planId)).orderBy(asc(planContributions.from)).all(); }
function source(plan: Plan, connection: Connection) { return plan.matchedTransactionId ? connection.db.select().from(transactions).where(and(eq(transactions.sheetId, plan.sheetId), eq(transactions.id, plan.matchedTransactionId))).get() : undefined; }
function eligible(record: typeof transactions.$inferSelect, plan: Plan, sheet: CycleSheet, connection: Connection) {
  if (record.deletedAt || record.kind !== "expense" || record.date < plan.createdDate || record.createdAt.getTime() < plan.createdAt || record.date > today() || periodContaining(record.date, sheet).from !== currentPeriod(sheet)) return false;
  const portions = connection.db.select().from(splits).where(eq(splits.transactionId, record.id)).all();
  return portions.length > 0 && portions.every(row => row.categoryId === plan.categoryId);
}
export function readPlans(userId: string, sheetId: string, connection: Connection = getDatabase()) {
  return connection.sqlite.transaction(() => {
    const { sheet } = requireSheetAccess({ userId, sheetId }, connection);
    const plans = connection.db.select().from(paymentPlans).where(eq(paymentPlans.sheetId, sheetId)).orderBy(asc(paymentPlans.dueDate), asc(paymentPlans.id)).all();
    const records: PlanRecord[] = plans.map(plan => {
      const current = source(plan, connection); const next = nextOccurrence(plan.dueDate, plan.recurrence, plan.anchorDay, today());
      return { ...plan, contributions: contributions(plan.id, connection).map(({ from, to, amount }) => ({ from, to, amount })),
        adjustments: connection.db.select().from(planAdjustments).where(eq(planAdjustments.planId, plan.id)).all().map(({ date, amount, reason }) => ({ date, amount, reason })),
        currentSourceVersion: current?.version ?? 0, needsReview: Boolean(plan.activeTransactionId && (!current || current.version !== plan.sourceVersion || current.deletedAt)),
        currentSourceDescription: current ? `${current.deletedAt ? "Deleted" : current.kind} · ${current.payee} · ${current.date} · ${displayAmount(current.amount, sheet.currency, true)} · ${connection.db.select({ name: categories.name }).from(splits).innerJoin(categories, eq(splits.categoryId, categories.id)).where(eq(splits.transactionId, current.id)).all().map(row => row.name).join(", ")}` : plan.matchedTransactionId ? "Deleted transaction" : null,
        nextDueDate: plan.status === "fulfilled" && !plan.nextPlanId && plan.activeTransactionId && current?.version === plan.sourceVersion && !current.deletedAt ? next.date : null,
        skippedOccurrences: next.skipped, overdue: plan.status === "active" && plan.dueDate < today(),
      };
    });
    const period = periodContaining(today(), sheet);
    const claimed = new Set(plans.flatMap(plan => plan.activeTransactionId ? [plan.activeTransactionId] : []));
    const candidates = connection.db.select().from(transactions).where(and(eq(transactions.sheetId, sheetId), eq(transactions.kind, "expense"), isNull(transactions.deletedAt), gte(transactions.date, period.from), lte(transactions.date, today()))).orderBy(asc(transactions.date), asc(transactions.id)).all().flatMap(record => {
      if (claimed.has(record.id)) return [];
      const portions = connection.db.select().from(splits).where(eq(splits.transactionId, record.id)).all(); const first = portions[0];
      if (!first || portions.some(row => row.categoryId !== first.categoryId)) return [];
      return [{ id: record.id, version: record.version, date: record.date, payee: record.payee, amount: -record.amount, categoryId: first.categoryId, createdAt: record.createdAt.getTime() }];
    });
    return { plans: records, candidates, currentPeriod: period.from, cycleVersion: sheet.cycleVersion };
  })();
}
function replaceSchedule(plan: Plan, sheet: CycleSheet, connection: Connection, oldCurrent = currentPeriod(sheet)) {
  const rows = contributions(plan.id, connection);
  const completed = sum(rows.filter(row => row.from < oldCurrent).map(row => row.amount));
  const schedule = contributionSchedule({ expected: plan.expected, completed, startDate: today(), dueDate: plan.dueDate, sheet });
  connection.db.delete(planContributions).where(and(eq(planContributions.planId, plan.id), gte(planContributions.from, oldCurrent))).run();
  for (const row of schedule) connection.db.insert(planContributions).values({ ...row, sheetId: plan.sheetId, planId: plan.id, categoryId: plan.categoryId }).run();
}
export function previewPlanCycle(sheetId: string, oldSheet: CycleSheet, nextSheet: CycleSheet, connection: Connection) {
  const plans = connection.db.select().from(paymentPlans).where(eq(paymentPlans.sheetId, sheetId)).all();
  const current = currentPeriod(oldSheet);
  return plans.filter(plan => plan.status === "active").map(plan => {
    const oldSchedule = contributions(plan.id, connection);
    const completed = sum(oldSchedule.filter(row => row.from < current).map(row => row.amount));
    return { id: plan.id, name: plan.name, version: plan.version, expected: plan.expected, dueDate: plan.dueDate, completed,
      oldSchedule: oldSchedule.filter(row => row.from >= current).map(({ from, to, amount }) => ({ from, to, amount })),
      newSchedule: contributionSchedule({ expected: plan.expected, completed, startDate: today(), dueDate: plan.dueDate, sheet: nextSheet }),
    };
  });
}
export function applyPlanCycle(sheetId: string, oldSheet: CycleSheet, nextSheet: CycleSheet, connection: Connection) {
  const plans = connection.db.select().from(paymentPlans).where(eq(paymentPlans.sheetId, sheetId)).all();
  for (const plan of plans) if (plan.status === "active") {
    replaceSchedule(plan, nextSheet, connection, currentPeriod(oldSheet));
    connection.db.update(paymentPlans).set({ version: plan.version + 1, updatedAt: Date.now() }).where(eq(paymentPlans.id, plan.id)).run();
  }
}
export function mutatePlan(userId: string, sheetId: string, input: unknown, connection: Connection = getDatabase()) {
  const parsed = planMutation.parse(input);
  return connection.sqlite.transaction(() => {
    const { sheet } = requireSheetAccess({ userId, sheetId }, connection);
    const hash = createHash("sha256").update(JSON.stringify(parsed)).digest("hex");
    const request = connection.db.select().from(planRequests).where(and(eq(planRequests.sheetId, sheetId), eq(planRequests.id, parsed.requestId))).get();
    if (request) { if (request.hash !== hash) throw new SheetError("This request was already used for another change.", 409); return { id: request.resultId, message: "Payment plan saved." }; }
    if (parsed.cycleVersion !== sheet.cycleVersion || parsed.currentPeriod !== currentPeriod(sheet)) throw new SheetError("The period or budget cycle changed. Reload latest before saving.", 409);
    const existing = "id" in parsed ? connection.db.select().from(paymentPlans).where(and(eq(paymentPlans.sheetId, sheetId), eq(paymentPlans.id, parsed.id))).get() : undefined;
    if ("id" in parsed && !existing) throw new SheetError("This payment plan is unavailable.", 404);
    if (existing && "version" in parsed && existing.version !== parsed.version) throw new SheetError("Someone changed this payment plan. Reload latest before saving.", 409);
    let id = existing?.id ?? randomUUID();
    const adjust = (plan: Plan, amount: number, date: string, reason: string) => connection.db.insert(planAdjustments).values({ id: randomUUID(), sheetId, planId: plan.id, categoryId: plan.categoryId, amount, date, reason }).run();
    const removeUnfinished = (plan: Plan) => connection.db.delete(planContributions).where(and(eq(planContributions.planId, plan.id), gte(planContributions.from, currentPeriod(sheet)))).run();
    const finish = (plan: Plan, values: Partial<typeof paymentPlans.$inferInsert>) => connection.db.update(paymentPlans).set({ ...values, version: plan.version + 1, updatedAt: Date.now() }).where(eq(paymentPlans.id, plan.id)).run();
    if (parsed.kind === "create" || parsed.kind === "edit" || parsed.kind === "next") {
      const category = connection.db.select().from(categories).where(and(eq(categories.sheetId, sheetId), eq(categories.id, parsed.categoryId))).get();
      if (!category || category.isArchived) throw new SheetError("Choose an active spending category from this sheet.", 400);
      if (parsed.dueDate < today()) throw new SheetError("Choose an upcoming payment date today or later.", 400);
      let expected: number;
      try { expected = parseLimit(parsed.amount, sheet.currency); } catch (error) { throw new SheetError(error instanceof Error ? error.message : "Enter a valid expected amount.", 400); }
      if (!expected) throw new SheetError("Expected amount must be greater than zero.", 400);
      if (parsed.kind === "edit" && existing) {
        if (existing.status !== "active") throw new SheetError("Only active plans can be edited.", 409);
        if (existing.categoryId !== parsed.categoryId && contributions(existing.id, connection).some(row => row.from < currentPeriod(sheet))) throw new SheetError("Keep the category after a completed contribution, or cancel and create a new plan.", 400);
        const values = { name: parsed.name, categoryId: parsed.categoryId, expected, dueDate: parsed.dueDate, recurrence: parsed.recurrence, anchorDay: Number(parsed.dueDate.slice(8)) };
        try { replaceSchedule({ ...existing, ...values }, sheet, connection); } catch (error) { throw new SheetError(error instanceof Error ? error.message : "Check the plan schedule.", 400); }
        finish(existing, values);
      } else {
        if (parsed.kind === "next" && existing && (existing.status !== "fulfilled" || existing.nextPlanId || !existing.recurrence || !existing.activeTransactionId || source(existing, connection)?.version !== existing.sourceVersion)) throw new SheetError("Reload this fulfilled plan before confirming another occurrence.", 409);
        if (parsed.kind === "next") id = randomUUID();
        const anchorDay = existing && parsed.kind === "next" && nextOccurrence(existing.dueDate, existing.recurrence, existing.anchorDay, today()).date === parsed.dueDate ? existing.anchorDay : Number(parsed.dueDate.slice(8));
        const plan: typeof paymentPlans.$inferInsert = { id, sheetId, name: parsed.name, categoryId: parsed.categoryId, expected, dueDate: parsed.dueDate, recurrence: parsed.recurrence, anchorDay, createdDate: today(), createdAt: Date.now(), updatedAt: Date.now() };
        connection.db.insert(paymentPlans).values(plan).run();
        const saved = connection.db.select().from(paymentPlans).where(eq(paymentPlans.id, id)).get();
        if (!saved) throw new Error("Missing saved payment plan.");
        replaceSchedule(saved, sheet, connection);
        if (existing && parsed.kind === "next") finish(existing, { nextPlanId: id });
      }
    } else if (existing) {
      if (parsed.kind === "match") {
        if (existing.status !== "active") throw new SheetError("This plan is no longer awaiting payment.", 409);
        const record = connection.db.select().from(transactions).where(and(eq(transactions.sheetId, sheetId), eq(transactions.id, parsed.transactionId))).get();
        if (!record || record.version !== parsed.sourceVersion) throw new SheetError("The payment changed. Reload latest before matching.", 409);
        if (!eligible(record, existing, sheet, connection)) throw new SheetError("Match a whole expense recorded after this plan was created, dated in the current period through today, with every split in this plan's category.", 400);
        if (connection.db.select().from(paymentPlans).where(and(eq(paymentPlans.sheetId, sheetId), eq(paymentPlans.activeTransactionId, record.id))).get()) throw new SheetError("This payment already fulfills another plan.", 409);
        connection.db.delete(planContributions).where(and(eq(planContributions.planId, existing.id), gte(planContributions.from, periodContaining(record.date, sheet).from))).run();
        // The current contribution remains planned even for an early payment.
        const currentRows = contributionSchedule({ expected: existing.expected, completed: sum(contributions(existing.id, connection).map(row => row.amount)), startDate: today(), dueDate: existing.dueDate, sheet });
        const currentRow = currentRows[0];
        if (currentRow && currentRow.from === currentPeriod(sheet)) connection.db.insert(planContributions).values({ ...currentRow, sheetId, planId: existing.id, categoryId: existing.categoryId }).run();
        const retained = sum(contributions(existing.id, connection).map(row => row.amount));
        adjust(existing, exactPlanAmount(-BigInt(record.amount) - BigInt(retained)), record.date, "Payment difference and uncovered cost");
        finish(existing, { status: "fulfilled", matchedTransactionId: record.id, activeTransactionId: record.id, matchedAmount: -record.amount, matchedDate: record.date, matchedPayee: record.payee, sourceVersion: record.version });
      } else if (parsed.kind === "release") {
        if (existing.status !== "fulfilled" || !existing.activeTransactionId) throw new SheetError("This match was already released.", 409);
        if ((source(existing, connection)?.version ?? 0) !== parsed.sourceVersion) throw new SheetError("The payment changed again. Reload latest before releasing.", 409);
        const previous = connection.db.select().from(planAdjustments).where(eq(planAdjustments.planId, existing.id)).all();
        adjust(existing, exactPlanAmount(-BigInt(sum(contributions(existing.id, connection).map(row => row.amount))) - BigInt(sum(previous.map(row => row.amount)))), today(), "Released match; recorded spending applies");
        finish(existing, { status: "cancelled", activeTransactionId: null });
      } else {
        if (existing.status !== "active") throw new SheetError("This plan is no longer active.", 409);
        removeUnfinished(existing);
        adjust(existing, -sum(contributions(existing.id, connection).map(row => row.amount)), today(), parsed.kind === "skip" ? "Skipped payment; contributions released" : "Cancelled plan; contributions released");
        finish(existing, { status: parsed.kind === "skip" ? "skipped" : "cancelled" });
      }
    }
    connection.db.insert(planRequests).values({ sheetId, id: parsed.requestId, hash, resultId: id }).run();
    return { id, message: "Payment plan saved." };
  }).immediate();
}
export function planningBreakdown(sheetId: string, from: string, to: string, sheet: CycleSheet, connection: Connection) {
  const result = new Map<string, { planned: bigint; reconciliation: bigint; matched: bigint }>();
  function row(id: string) { const existing = result.get(id); if (existing) return existing; const created = { planned: 0n, reconciliation: 0n, matched: 0n }; result.set(id, created); return created; }
  for (const entry of connection.db.select().from(planContributions).where(and(eq(planContributions.sheetId, sheetId), eq(planContributions.from, from))).all()) row(entry.categoryId).planned += BigInt(entry.amount);
  for (const entry of connection.db.select().from(planAdjustments).where(eq(planAdjustments.sheetId, sheetId)).all()) if (periodContaining(entry.date, sheet).from === from) row(entry.categoryId).reconciliation += BigInt(entry.amount);
  const linked = connection.db.select().from(paymentPlans).where(eq(paymentPlans.sheetId, sheetId)).all();
  for (const plan of linked) {
    if (!plan.activeTransactionId) continue;
    const record = source(plan, connection);
    if (!record || record.deletedAt || record.kind !== "expense" || record.date < from || record.date > to) continue;
    for (const split of connection.db.select().from(splits).where(eq(splits.transactionId, record.id)).all()) row(split.categoryId).matched -= BigInt(split.amount);
  }
  return Object.fromEntries([...result].map(([id, value]) => [id, { planned: exactPlanAmount(value.planned), reconciliation: exactPlanAmount(value.reconciliation), matched: exactPlanAmount(value.matched) }]));
}
