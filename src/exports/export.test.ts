import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, expect, it } from "vitest";
import { openDatabase } from "../db/client";
import { migrateDatabase } from "../db/migrate";
import { user, sheets, transactions, debtLegacyMetadata, budgetDefaultChanges, budgets, planContributions, planAdjustments, paymentPlans, debts, debtPayments, sheetMembers } from "../db/schema";
import { readBudgets } from "../budgets/service";
import { readOverview } from "../overview/service";
import { createSheet, readSheet } from "../sheets/service";
import { mutateSettings } from "../sheets/settings";
import { saveTransaction } from "../ledger/service";
import { readExport, exportScope, exportSheet } from "./service";
import { writeWorkbook, type Tab } from "./workbook";

const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); });
function fixture(currency = "USD") {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "homebooks-export-")), filename = path.join(directory, "db.sqlite");
  migrateDatabase(filename);
  const connection = openDatabase(filename);
  cleanups.push(() => { connection.sqlite.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const owner = randomUUID(), outsider = randomUUID();
  connection.db.insert(user).values([{ id: owner, name: "Owner", email: `${owner}@example.test` }, { id: outsider, name: "Private profile sentinel", email: `${outsider}@example.test` }]).run();
  const { sheet } = createSheet(owner, { name: "Exports", currency }, connection);
  mutateSettings(owner, sheet.id, { kind: "create", entity: "account", name: "=SUM(1,2)", sourceType: "cash" }, connection);
  const records = readSheet(owner, sheet.id, connection), account = records.accounts[0], category = records.categories[0], group = records.buckets[0];
  if (!account || !category || !group) throw new Error("Fixture organization missing");
  function transaction(date: string, amount: string, kind = "expense", description = "Literal = + - @\t\n\r\u0001 Unicode 雪") {
    return saveTransaction(owner, sheet.id, { date, amount, kind, accountId: account.id, payee: description, splits: [{ amount, categoryId: category.id, bucketId: group.id }] }, undefined, connection);
  }
  return { connection, owner, outsider, sheet, category, group, account, transaction };
}
function rows(tabs: Tab[], name: string) { const tab = tabs.find(t => t.name === name); if (!tab) return []; return tab.rows.map(row => Object.fromEntries(tab.headers.map((header, i) => [header, row[i]]))); }

it("exports every matching transaction and split past UI limits without repeating parent totals", () => {
  const f = fixture();
  for (let n = 0; n < 105; n++) f.transaction("2026-10-04", "-1.01");
  f.transaction("2026-09-30", "-999.00");
  f.transaction("2026-10-05", "0.01", "refund");
  const tabs = readExport(f.owner, f.sheet.id, { kind: "range", from: "2026-10-04", to: "2026-10-04" }, f.connection);
  const summaries = rows(tabs, "Transactions"), details = rows(tabs, "Splits");
  expect(summaries).toHaveLength(105); expect(details).toHaveLength(105);
  expect(summaries.reduce((sum, row) => sum + BigInt(String(row["Signed total exact minor units"])), 0n)).toBe(-10605n);
  expect(details.reduce((sum, row) => sum + BigInt(String(row["Signed split exact minor units"])), 0n)).toBe(-10605n);
  expect(details[0]).not.toHaveProperty("Signed total");
  expect(new Set(details.map(row => row["Transaction ID"])) ).toEqual(new Set(summaries.map(row => row["Transaction ID"])));
  expect(rows(tabs, "Budgets")[0]).toMatchObject({ "Period start": "2026-10-01", "Period end inclusive": "2026-10-31", "Recorded spending exact minor units": "10604" });
});

it("preserves MAX precision for supported currencies and authorizes the selected sheet for members", () => {
  for (const [currency, amount] of [["USD", "-90071992547409.91"], ["JPY", "-9007199254740991"], ["KWD", "-9007199254740.991"]]) {
    const f = fixture(currency); f.transaction("0001-01-01", amount);
    expect(() => readExport(f.outsider, f.sheet.id, { kind: "all" }, f.connection)).toThrow("unavailable");
    f.connection.db.insert(sheetMembers).values({ sheetId: f.sheet.id, userId: f.outsider, acceptedAt: new Date() }).run();
    const tabs = readExport(f.outsider, f.sheet.id, { kind: "range", from: "0001-01-01", to: "0001-01-01" }, f.connection);
    expect(rows(tabs, "Transactions")[0]).toMatchObject({ Date: "0001-01-01", "Signed total": null, "Signed total exact decimal": amount, "Signed total exact minor units": "-9007199254740991" });
    expect(JSON.stringify(tabs)).not.toContain("Private profile sentinel");
    expect(exportSheet(f.owner, f.sheet.id, { kind: "range", from: "0001-01-01", to: "0001-01-01" }, f.connection).subarray(0, 2).toString()).toBe("PK");
  }
});

it("reconciles budgets with contributions, adjustments and matched exclusion while retaining override states", () => {
  const f = fixture(), planId = randomUUID();
  const saved = f.transaction("2026-10-04", "-100.00");
  f.connection.db.insert(budgetDefaultChanges).values({ sheetId: f.sheet.id, categoryId: f.category.id, effectiveFrom: "0001-01-01", limit: 20000, version: 1 }).run();
  f.connection.db.insert(budgets).values([{ sheetId: f.sheet.id, categoryId: f.category.id, month: "2026-10-01", limit: 0, version: 1 }, { sheetId: f.sheet.id, categoryId: f.category.id, month: "2026-11-01", limit: null, version: 2 }, { sheetId: f.sheet.id, categoryId: f.category.id, month: "2026-12-01", limit: null, inheritsDefault: true, version: 3 }]).run();
  f.connection.db.insert(paymentPlans).values({ id: planId, sheetId: f.sheet.id, categoryId: f.category.id, name: "Annual", expected: 10000, dueDate: "2026-10-10", recurrence: 0, anchorDay: 10, createdDate: "2026-09-01", status: "fulfilled", matchedTransactionId: saved.id, activeTransactionId: saved.id, createdAt: Date.now(), updatedAt: Date.now() }).run();
  f.connection.db.insert(planContributions).values({ sheetId: f.sheet.id, planId, categoryId: f.category.id, from: "2026-10-01", to: "2026-10-31", amount: 2500 }).run();
  f.connection.db.insert(planAdjustments).values({ id: randomUUID(), sheetId: f.sheet.id, planId, categoryId: f.category.id, date: "2026-10-04", amount: 1500, reason: "Reconciliation" }).run();
  const tabs = readExport(f.owner, f.sheet.id, { kind: "all" }, f.connection), budget = rows(tabs, "Budgets");
  expect(budget.find(r => r["Period start"] === "2026-10-01")).toMatchObject({ "Limit state": "zero", "Recorded spending exact minor units": "10000", "Planned contributions exact minor units": "2500", "Reconciliation exact minor units": "1500", "Matched expense excluded exact minor units": "10000", "Budget used exact minor units": "4000", "Remaining exact minor units": "-4000" });
  expect(budget.find(r => r["Period start"] === "2026-11-01")).toMatchObject({ "Limit state": "no limit", "Limit source": "override", "Remaining": null });
  expect(budget.find(r => r["Period start"] === "2026-12-01")).toMatchObject({ "Limit source": "default", "Explicit inheritance": true, "Limit exact minor units": "20000" });
  expect(budget.length).toBeLessThan(24);
  expect(rows(tabs, "Budget defaults")[0]?.["Effective from"]).toBe("0001-01-01");
  for (const start of ["2026-10-01", "2026-11-01", "2026-12-01"]) {
    const exported = budget.find(r => r["Period start"] === start), app = readBudgets(f.owner, f.sheet.id, start, f.connection).rows.find(r => r.categoryId === f.category.id), overview = readOverview(f.owner, f.sheet.id, start, f.connection);
    expect(exported).toMatchObject({ "Recorded spending exact minor units": String(app?.spent), "Planned contributions exact minor units": String(app?.planned), "Reconciliation exact minor units": String(app?.reconciliation), "Matched expense excluded exact minor units": String(app?.matched), "Budget used exact minor units": String(app?.budgetUsed), "Remaining exact minor units": app?.remaining === null ? null : String(app?.remaining) });
    expect(exported?.["Recorded spending exact minor units"]).toBe(String(overview.categories[f.category.id] ?? 0));
  }
});

it("uses the same clamped custom period boundaries and historical defaults as Budgets and Overview", () => {
  const f = fixture();
  f.connection.db.update(sheets).set({ cycleStartDay: 31, cycleBaselineDay: 31 }).where(eq(sheets.id, f.sheet.id)).run();
  f.connection.db.insert(budgetDefaultChanges).values([{ sheetId: f.sheet.id, categoryId: f.category.id, effectiveFrom: "2026-08-31", limit: 20000, version: 1 }, { sheetId: f.sheet.id, categoryId: f.category.id, effectiveFrom: "2026-10-31", limit: 30000, version: 2 }]).run();
  f.transaction("2026-09-30", "-10.01"); f.transaction("2026-10-30", "-20.02"); f.transaction("2026-10-31", "-99.99");
  const tabs = readExport(f.owner, f.sheet.id, { kind: "range", from: "2026-10-04", to: "2026-10-04" }, f.connection);
  const budget = rows(tabs, "Budgets")[0], app = readBudgets(f.owner, f.sheet.id, "2026-09-30", f.connection), overview = readOverview(f.owner, f.sheet.id, "2026-09-30", f.connection);
  expect(budget).toMatchObject({ "Period start": app.cycle.from, "Period end inclusive": app.cycle.to, "Effective default exact minor units": "20000", "Recorded spending exact minor units": "3003", "Remaining exact minor units": "16997" });
  expect(budget?.["Recorded spending exact minor units"]).toBe(String(overview.categories[f.category.id]));
  expect(rows(tabs, "Transactions")).toHaveLength(0);
});

it("keeps all-time debt totals and required correction originals outside the requested event range", () => {
  const f = fixture(), debtId = randomUUID(), originalId = randomUUID(), correctionId = randomUUID();
  f.connection.db.insert(debts).values({ id: debtId, sheetId: f.sheet.id, description: "=Debt", debtor: "+Debtor", recipient: "@Recipient", total: 10000, createdAt: Date.now(), updatedAt: Date.now() }).run();
  f.connection.db.insert(debtPayments).values([{ id: originalId, sheetId: f.sheet.id, debtId, kind: "opening", amount: 2000, date: "2026-09-01", comment: "Original", createdAt: 1 }, { id: correctionId, sheetId: f.sheet.id, debtId, kind: "correction", amount: -1000, replacementAmount: 1000, replaces: originalId, date: "2026-10-04", comment: "Corrected", reason: "Correction", createdAt: 2 }]).run();
  const tabs = readExport(f.owner, f.sheet.id, { kind: "range", from: "2026-10-04", to: "2026-10-04" }, f.connection);
  expect(rows(tabs, "Debts")[0]).toMatchObject({ "Who owes": "+Debtor", "Who receives repayment": "@Recipient", "Repaid all time exact minor units": "1000", "Remaining all time exact minor units": "9000" });
  expect(rows(tabs, "Repayments")).toEqual(expect.arrayContaining([expect.objectContaining({ "Event ID": originalId, "Context only": true, "Matches requested dates": false }), expect.objectContaining({ "Event ID": correctionId, "Replaces event ID": originalId, "Context only": false, "Replacement amount exact minor units": "1000" })]));
  expect(tabs.map(t => t.name)).not.toContain("Transactions");
});

it("rejects invalid date scopes and Excel cell limits explicitly", () => {
  expect(exportScope.safeParse({ kind: "range", from: "2026-02-30", to: "2026-03-01" }).success).toBe(false);
  expect(exportScope.safeParse({ kind: "range", from: "2026-10-02", to: "2026-10-01" }).success).toBe(false);
  expect(() => writeWorkbook([{ name: "Data", headers: ["Text"], rows: [["a".repeat(32768)]] }])).toThrow("cell limit");
  expect(() => writeWorkbook([{ name: "Invalid/name", headers: ["Text"], rows: [] }])).toThrow("Invalid workbook");
});

it("retains untracked and deleted legacy repayment metadata as non-counting context outside the date range", () => {
  const f = fixture(), untracked = f.transaction("2026-09-01", "-10.00"), deleted = f.transaction("2026-09-02", "-20.00");
  f.connection.db.insert(debtLegacyMetadata).values([{ transactionId: untracked.id, sheetId: f.sheet.id, date: "2026-09-10", comment: "=Original untracked repayment\n雪" }, { transactionId: deleted.id, sheetId: f.sheet.id, date: "2026-09-11", comment: "Deleted transaction original comment" }]).run();
  f.connection.db.update(transactions).set({ deletedAt: new Date() }).where(eq(transactions.id, deleted.id)).run();
  const tabs = readExport(f.owner, f.sheet.id, { kind: "range", from: "2026-10-04", to: "2026-10-04" }, f.connection);
  expect(rows(tabs, "Legacy repayment metadata")).toEqual(expect.arrayContaining([
    expect.objectContaining({ "Transaction ID": untracked.id, "Current transaction exists": true, "Current transaction date": "2026-09-01", "Current transaction kind": "expense", "Current transaction deleted": false, "Transaction included in summary": false, "Original repayment date": "2026-09-10", "Original repayment comment": "=Original untracked repayment\n雪", "Counts as repayment": false }),
    expect.objectContaining({ "Transaction ID": deleted.id, "Current transaction exists": true, "Current transaction date": "2026-09-02", "Current transaction kind": "expense", "Current transaction deleted": true, "Transaction included in summary": false, "Original repayment date": "2026-09-11", "Original repayment comment": "Deleted transaction original comment", "Counts as repayment": false }),
  ]));
  expect(rows(tabs, "Transactions")).toHaveLength(0);
  expect(rows(tabs, "Debts")).toHaveLength(0);
  expect(rows(tabs, "Repayments")).toHaveLength(0);
  expect(rows(tabs, "Legacy repayment metadata")).toHaveLength(2);
});
