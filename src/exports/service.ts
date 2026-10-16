import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { getDatabase, type openDatabase } from "../db/client";
import { transactions, splits, financialAccounts, categories, buckets, budgets, budgetDefaultChanges, debts, debtLegacyMetadata, planContributions, planAdjustments, paymentPlans } from "../db/schema";
import { currencyPrecision, dateSchema } from "../ledger/input";
import { requireSheetAccess, SheetError } from "../sheets/service";
import { currentPeriod, periodContaining, adjacentPeriod } from "../sheets/cycle";
import { readDebt } from "../repayments/debts";
import { type Cell, type Tab, writeWorkbook } from "./workbook";

export const exportScope = z.discriminatedUnion("kind", [z.object({ kind: z.literal("all") }).strict(), z.object({ kind: z.literal("range"), from: dateSchema, to: dateSchema }).strict()]).refine(scope => scope.kind === "all" || scope.from <= scope.to, "The start date must be on or before the end date.");
type Connection = ReturnType<typeof openDatabase>;
export function readExport(userId: string, sheetId: string, input: unknown, connection: Connection = getDatabase()) {
  const scope = exportScope.parse(input);
  return connection.sqlite.transaction(() => {
    const { sheet } = requireSheetAccess({ userId, sheetId }, connection);
    const generated = new Date().toISOString(), precision = currencyPrecision(sheet.currency);
    const inRange = (date: string) => scope.kind === "all" || date >= scope.from && date <= scope.to;
    const tabs: Tab[] = [], counts: Cell[][] = [];
    function add(name: string, headers: string[], rows: Cell[][], semantics: string) {
      counts.push([name, rows.length, semantics]);
      if (rows.length) tabs.push({ name, headers, rows });
    }
    function money(value: number | bigint | null): Cell[] {
      if (value === null) return [null, null, null];
      const units = BigInt(value), sign = units < 0 ? "-" : "", magnitude = units < 0 ? -units : units;
      const digits = magnitude.toString().padStart(precision + 1, "0");
      const decimal = sign + (precision ? `${digits.slice(0, -precision)}.${digits.slice(-precision)}` : digits);
      return [magnitude <= 999999999999999n ? Number(decimal) : null, decimal, units.toString()];
    }
    const mh = (label: string) => [label, `${label} exact decimal`, `${label} exact minor units`];
    const ledger = connection.db.select().from(transactions).where(and(eq(transactions.sheetId, sheetId), isNull(transactions.deletedAt))).orderBy(asc(transactions.date), asc(transactions.id)).all();
    const parts = connection.db.select().from(splits).where(eq(splits.sheetId, sheetId)).orderBy(asc(splits.transactionId), asc(splits.position)).all();
    const accounts = connection.db.select().from(financialAccounts).where(eq(financialAccounts.sheetId, sheetId)).all();
    const categoryRows = connection.db.select().from(categories).where(eq(categories.sheetId, sheetId)).orderBy(asc(categories.name), asc(categories.id)).all();
    const groups = connection.db.select().from(buckets).where(eq(buckets.sheetId, sheetId)).all();
    const selected = ledger.filter(t => inRange(t.date)), selectedIds = new Set(selected.map(t => t.id));
    add("Transactions", ["Transaction ID", "Date", "Description", "Kind", "Account ID", "Transaction account", "Account archived", ...mh("Signed total"), "Revision"], selected.map(t => [t.id, t.date, t.payee, t.kind, t.accountId, accounts.find(a => a.id === t.accountId)?.name ?? "", accounts.find(a => a.id === t.accountId)?.isArchived ?? false, ...money(t.amount), t.version]), "Inclusive transaction date; deleted ledger rows excluded. Parent totals occur only here.");
    add("Splits", ["Split ID", "Transaction ID", "Position", "Category ID", "Spending category", "Category archived", "Group ID", "Spending group", "Group archived", ...mh("Signed split")], parts.filter(p => selectedIds.has(p.transactionId)).map(p => [p.id, p.transactionId, p.position, p.categoryId, categoryRows.find(c => c.id === p.categoryId)?.name ?? "", categoryRows.find(c => c.id === p.categoryId)?.isArchived ?? false, p.bucketId, groups.find(g => g.id === p.bucketId)?.name ?? "", groups.find(g => g.id === p.bucketId)?.isArchived ?? false, ...money(p.amount)]), "Same selected transactions; split amounts only. Position is zero-based.");
    const overrides = connection.db.select().from(budgets).where(eq(budgets.sheetId, sheetId)).orderBy(asc(budgets.month), asc(budgets.categoryId)).all();
    const defaults = connection.db.select().from(budgetDefaultChanges).where(eq(budgetDefaultChanges.sheetId, sheetId)).orderBy(asc(budgetDefaultChanges.effectiveFrom), asc(budgetDefaultChanges.version), asc(budgetDefaultChanges.categoryId)).all();
    const contributions = connection.db.select().from(planContributions).where(eq(planContributions.sheetId, sheetId)).all();
    const adjustments = connection.db.select().from(planAdjustments).where(eq(planAdjustments.sheetId, sheetId)).all();
    const plans = connection.db.select().from(paymentPlans).where(eq(paymentPlans.sheetId, sheetId)).all();
    const dates = [currentPeriod(sheet), ...ledger.map(t => t.date), ...overrides.map(b => b.month), ...defaults.filter(d => d.effectiveFrom !== "0001-01-01").map(d => d.effectiveFrom), ...contributions.flatMap(c => [c.from, c.to]), ...adjustments.map(a => a.date)].sort();
    const start = scope.kind === "range" ? scope.from : dates[0] ?? currentPeriod(sheet);
    const end = scope.kind === "range" ? scope.to : dates.at(-1) ?? currentPeriod(sheet);
    const budgetRows: Cell[][] = [];
    let period = periodContaining(start, sheet);
    while (period.from <= end) {
      const spent = new Map<string, bigint>(), matched = new Map<string, bigint>(), planned = new Map<string, bigint>(), reconciliation = new Map<string, bigint>();
      const accumulate = (map: Map<string, bigint>, id: string, amount: bigint) => map.set(id, (map.get(id) ?? 0n) + amount);
      const periodLedger = ledger.filter(t => t.date >= period.from && t.date <= period.to);
      const kinds = new Map(periodLedger.filter(t => t.kind === "expense" || t.kind === "refund").map(t => [t.id, t.kind]));
      const claims = new Set(plans.flatMap(p => p.activeTransactionId ? [p.activeTransactionId] : []));
      for (const split of parts) {
        if (kinds.has(split.transactionId)) accumulate(spent, split.categoryId, -BigInt(split.amount));
        if (claims.has(split.transactionId) && kinds.get(split.transactionId) === "expense") accumulate(matched, split.categoryId, -BigInt(split.amount));
      }
      for (const row of contributions) if (row.from === period.from) accumulate(planned, row.categoryId, BigInt(row.amount));
      for (const row of adjustments) if (row.date >= period.from && row.date <= period.to) accumulate(reconciliation, row.categoryId, BigInt(row.amount));
      for (const category of categoryRows) {
        const override = overrides.find(o => o.month === period.from && o.categoryId === category.id);
        const fallback = defaults.filter(d => d.categoryId === category.id && d.effectiveFrom <= period.from).at(-1);
        const inherits = !override || override.inheritsDefault;
        const limit = inherits ? fallback?.limit ?? null : override.limit;
        const actual = spent.get(category.id) ?? 0n, contribution = planned.get(category.id) ?? 0n, adjustment = reconciliation.get(category.id) ?? 0n, coverage = matched.get(category.id) ?? 0n;
        const used = actual + contribution + adjustment - coverage;
        budgetRows.push([period.from, period.to, category.id, category.name, category.isArchived, inherits ? "default" : "override", override?.inheritsDefault ?? null, override?.version ?? null, fallback?.effectiveFrom ?? null, fallback?.version ?? null, ...money(fallback?.limit ?? null), limit === null ? "no limit" : limit === 0 ? "zero" : "limited", ...money(limit), ...money(actual), ...money(contribution), ...money(adjustment), ...money(coverage), ...money(used), ...money(limit === null ? null : BigInt(limit) - used)]);
      }
      if (budgetRows.length > 1048575) throw new SheetError("Budget export exceeds Excel's worksheet limit. Choose a smaller date range.", 400);
      const next = adjacentPeriod(period.from, 1, sheet);
      if (next === period.from) break;
      period = periodContaining(next, sheet);
    }
    add("Budgets", ["Period start", "Period end inclusive", "Category ID", "Spending category", "Category archived", "Limit source", "Explicit inheritance", "Override revision", "Default effective from", "Default revision", ...mh("Effective default"), "Limit state", ...mh("Limit"), ...mh("Recorded spending"), ...mh("Planned contributions"), ...mh("Reconciliation"), ...mh("Matched expense excluded"), ...mh("Budget used"), ...mh("Remaining")], budgetRows, `Whole periods overlapping ${start} through ${end}. Full-period actuals include transactions outside the requested transaction range. Budget used = recorded + planned + reconciliation - matched expense excluded.`);
    add("Budget defaults", ["Category ID", "Spending category", "Effective from", "Revision", "Limit state", ...mh("Default limit")], defaults.map(d => [d.categoryId, categoryRows.find(c => c.id === d.categoryId)?.name ?? "", d.effectiveFrom, d.version, d.limit === null ? "no limit" : d.limit === 0 ? "zero" : "limited", ...money(d.limit)]), "All effective-period revisions retained as configuration context, including migration baselines; no date filtering.");
    add("Budget overrides", ["Category ID", "Spending category", "Period start", "Period end inclusive", "Revision", "Inherits default", "Limit state", ...mh("Stored limit")], overrides.map(o => [o.categoryId, categoryRows.find(c => c.id === o.categoryId)?.name ?? "", o.month, periodContaining(o.month, sheet).to, o.version, o.inheritsDefault, o.inheritsDefault ? "inherit" : o.limit === null ? "no limit" : o.limit === 0 ? "zero" : "limited", ...money(o.limit)]), "All stored overrides retained as configuration context; no date filtering.");
    const agreements = connection.db.select().from(debts).where(eq(debts.sheetId, sheetId)).orderBy(asc(debts.createdAt), asc(debts.id)).all().map(d => readDebt(userId, sheetId, d.id, connection));
    add("Debts", ["Debt ID", "Description", "Who owes", "Who receives repayment", "Direction unresolved", "Grouped into debt ID", "Count in active totals", ...mh("Agreed total"), ...mh("Repaid all time"), ...mh("Remaining all time"), "Completion date", "Source review required", "Revision", "Created UTC", "Updated UTC"], agreements.map(d => [d.id, d.description, d.debtor, d.recipient, d.recipient === null, d.groupedInto, d.groupedInto === null, ...money(d.total), ...money(d.paid), ...money(d.remaining), d.completionDate, d.needsReview, d.version, new Date(d.createdAt).toISOString(), new Date(d.updatedAt).toISOString()]), "All-time current snapshot of every agreement, independent of date range. Sum only Count in active totals=true; grouped child agreements remain for history.");
    add("Repayments", ["Event ID", "Debt ID", "Who owes", "Who receives repayment", "Kind", "Event date", "Matches requested dates", "Context only", ...mh("Repaid delta"), "Replaces event ID", ...mh("Replacement amount"), "Comment", "Reason", "Recorded UTC"], agreements.flatMap(d => {
      const matching = d.payments.filter(p => inRange(p.date));
      const originals = new Set(matching.flatMap(p => p.replaces ? [p.replaces] : []));
      return d.payments.filter(p => inRange(p.date) || originals.has(p.id)).map(p => [p.id, d.id, d.debtor, d.recipient, p.kind, p.date, inRange(p.date), !inRange(p.date), ...money(p.amount), p.replaces, ...money(p.replacementAmount), p.comment, p.reason, new Date(p.createdAt).toISOString()]);
    }), "Inclusive repayment event date. Required original events outside the range are marked Context only. Deltas are immutable; corrections replace an original event and must not be added as a second full payment. Debt totals remain all-time.");
    add("Debt sources", ["Source ID", "Debt ID", "Transaction ID", "Split position", "Original transaction revision", "Acknowledged revision", ...mh("Original amount"), ...mh("Agreed source amount"), "Original description", "Original date", "Original group ID", "Original spending group", "Current transaction revision", "Current description", "Current date", "Current kind", "Current deleted", ...mh("Current source amount"), "Source changed", "Legacy repayment date", "Legacy repayment comment"], agreements.flatMap(d => d.sources.map(s => [s.id, d.id, s.transactionId, s.position, s.originalVersion, s.acceptedVersion, ...money(s.originalAmount), ...money(s.amount), s.payee, s.date, s.bucketId, s.bucketName, s.currentVersion, s.currentPayee, s.currentDate, s.currentKind, s.deleted, ...money(s.currentAmount), s.changed, s.legacyDate, s.legacyComment])), "All-time contextual source snapshots; transaction IDs may refer to deleted or out-of-range ledger records. Split position links a source to a split within its original transaction revision.");
    add("Debt changes", ["Change ID", "Debt ID", "Description", "Recorded UTC"], agreements.flatMap(d => d.changes.map(c => [c.id, d.id, c.description, new Date(c.createdAt).toISOString()])), "All-time contextual agreement history; no date filtering.");
    const legacyMetadata = connection.db.select().from(debtLegacyMetadata).where(eq(debtLegacyMetadata.sheetId, sheetId)).orderBy(asc(debtLegacyMetadata.transactionId)).all();
    add("Legacy repayment metadata", ["Transaction ID", "Current transaction exists", "Current transaction date", "Current transaction kind", "Current transaction deleted", "Transaction included in summary", "Original repayment date", "Original repayment comment", "Counts as repayment"], legacyMetadata.map(metadata => {
      const transaction = connection.db.select().from(transactions).where(and(eq(transactions.sheetId, sheetId), eq(transactions.id, metadata.transactionId))).get();
      return [metadata.transactionId, transaction !== undefined, transaction?.date ?? null, transaction?.kind ?? null, transaction ? transaction.deletedAt !== null : null, selectedIds.has(metadata.transactionId), metadata.date, metadata.comment, false];
    }), "Every archived whole-expense repayment date/comment from this sheet, independent of date range or debt tracking. Context only; never adds debts or repayment amounts. Transaction flags identify deleted, unavailable or out-of-range records absent from Transactions.");
    const metadata: Tab = { name: "Export info", headers: ["Property or dataset", "Value or row count", "Meaning"], rows: [
      ["Sheet ID", sheet.id, "Only this sheet"], ["Sheet name", sheet.name, "Selected sheet"], ["Currency", sheet.currency, "No conversion"], ["Currency decimal places", precision, "Minor-unit precision"], ["Generated UTC", generated, "Authorized consistent SQLite read snapshot"], ["Scope", scope.kind === "all" ? "All data" : "Date range", "Inclusive dates"], ["From", scope.kind === "range" ? scope.from : null, "Transaction and repayment dates"], ["Through", scope.kind === "range" ? scope.to : null, "Transaction and repayment dates"],
      ["Budget coverage", `${periodContaining(start, sheet).from} through ${periodContaining(end, sheet).to}`, "Finite recorded activity/configuration/planning extent plus current period for All data. Baseline year-1 defaults do not expand the extent. Future inherited periods without records are not generated."],
      ["Money", "Exact decimal and minor-unit text companions", "Primary numeric cells are blank above 15 minor-unit digits because Excel rounds larger numbers. Exact text companions always preserve source and aggregate money. Blank limits mean no limit, distinct from zero."], ["Dates", "YYYY-MM-DD text", "No timezone conversion or Excel date serials"], ["Text", "Literal spreadsheet text", "Descriptions and names never become formulas. OOXML escapes preserve controls."], ["Truncation", "None", "Every matching row is included; empty datasets have no tab. Exceeding Excel limits fails the download."], ["Unavailable datasets", "None of the required datasets", "Payment-plan record tabs, instance backups and automatic sync are outside this export."], ...counts,
    ] };
    return [metadata, ...tabs];
  })();
}
export function exportSheet(userId: string, sheetId: string, input: unknown, connection: Connection = getDatabase()) {
  const snapshot = readExport(userId, sheetId, input, connection);
  try { return writeWorkbook(snapshot); }
  catch (error) { throw new SheetError(error instanceof Error ? error.message : "Could not create the workbook.", 400); }
}
