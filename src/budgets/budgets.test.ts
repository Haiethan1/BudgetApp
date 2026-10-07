import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "../db/client";
import { migrateDatabase } from "../db/migrate";
import { budgets, sheetMembers, user } from "../db/schema";
import { createSheet, readSheet } from "../sheets/service";
import { mutateSettings } from "../sheets/settings";
import { calculateSpending, deleteTransaction, saveTransaction } from "../ledger/service";
import { mutateBudget, readBudgets } from "./service";
import { parseLimit } from "./input";
const resources: { connection: ReturnType<typeof openDatabase>; directory: string }[] = [];
afterEach(() => { for (const { connection, directory } of resources.splice(0)) { connection.sqlite.close(); fs.rmSync(directory, { recursive: true, force: true }); } });
function fixture(currency = "USD") {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "homebooks-budgets-"));
  const filename = path.join(directory, "budget.sqlite"); migrateDatabase(filename);
  const connection = openDatabase(filename); resources.push({ connection, directory });
  const owner = randomUUID(); const member = randomUUID(); const other = randomUUID();
  for (const id of [owner, member, other]) connection.db.insert(user).values({ id, name: id, email: `${id}@example.test`, emailVerified: false, createdAt: new Date(), updatedAt: new Date() }).run();
  const sheet = createSheet(owner, { name: "Budgets", currency }, connection).sheet;
  connection.db.insert(sheetMembers).values({ sheetId: sheet.id, userId: member, acceptedAt: new Date() }).run();
  for (const name of ["Groceries", "Other"]) mutateSettings(owner, sheet.id, { kind: "create", entity: "category", name }, connection);
  mutateSettings(owner, sheet.id, { kind: "create", entity: "account", name: "Card", sourceType: "credit_card" }, connection);
  const organization = readSheet(owner, sheet.id, connection);
  const category = organization.categories.find((row) => row.name === "Groceries");
  const otherCategory = organization.categories.find((row) => row.name === "Other");
  const bucket = organization.buckets[0]; const account = organization.accounts[0];
  if (!category || !otherCategory || !bucket || !account) throw new Error("Missing fixture organization.");
  const save = (amount: string, version = 0, month = "2026-10", categoryId = category.id, actor = owner) => mutateBudget(actor, sheet.id, { kind: "save", categoryId, month, version, amount }, connection);
  const spend = (amount: string, date = "2026-10-01", kind = "expense") => saveTransaction(owner, sheet.id, { accountId: account.id, date, kind, payee: "Purchase", amount, splits: [{ amount, categoryId: category.id, bucketId: bucket.id }] }, undefined, connection);
  const read = (month = "2026-10") => readBudgets(owner, sheet.id, month, connection);
  return { connection, filename, owner, member, other, sheet, category, otherCategory, bucket, account, save, spend, read };
}
describe("monthly category limits", () => {
  it("shares exact spending, gives $70 remaining and $30 overspent, preserves negative net refunds and empty months", () => {
    const f = fixture(); f.spend("-100"); f.spend("20", "2026-10-31", "refund");
    f.spend("2000", "2026-10-01", "income"); f.spend("-100", "2026-10-01", "transfer");
    f.save("150");
    expect(f.read()).toMatchObject({ total: 8000, budgetedSpent: 8000, totalLimits: 15000, remaining: 7000 });
    f.save("50", 1);
    expect(f.read().rows.find((row) => row.categoryId === f.category.id)).toMatchObject({ spent: 8000, limit: 5000, remaining: -3000 });
    f.spend("120", "2026-11-01", "refund");
    expect(f.read("2026-11")).toMatchObject({ total: -12000, totalLimits: 0, budgetedSpent: 0, remaining: 0 });
    f.save("0", 0, "2026-11");
    expect(f.read("2026-11")).toMatchObject({ total: -12000, budgetedSpent: -12000, remaining: 12000 });
    expect(f.read("2026-12")).toMatchObject({ total: 0, totalLimits: 0, budgetedSpent: 0 });
    const spending = calculateSpending(f.owner, f.sheet.id, "2026-10", f.connection);
    expect(f.read()).toMatchObject(spending);
  });
  it("distinguishes missing and zero, retains unbudgeted spending and excludes tombstoned transactions", () => {
    const f = fixture(); const transaction = f.spend("-100");
    expect(f.read().rows.find((row) => row.categoryId === f.category.id)).toMatchObject({ version: 0, limit: null, remaining: null, spent: 10000 });
    expect(f.read()).toMatchObject({ total: 10000, totalLimits: 0, budgetedSpent: 0 });
    f.save("0"); expect(f.read()).toMatchObject({ totalLimits: 0, budgetedSpent: 10000, remaining: -10000 });
    deleteTransaction(f.owner, f.sheet.id, transaction.id, { version: 1 }, f.connection);
    expect(f.read()).toMatchObject({ total: 0, budgetedSpent: 0, remaining: 0 });
  });
  it("rejects stale saves, removals, and create/remove/recreate ABA races", () => {
    const f = fixture(); f.save("100");
    expect(() => f.save("200")).toThrow("Someone updated");
    f.save("150", 1);
    const remove = (version: number) => mutateBudget(f.owner, f.sheet.id, { kind: "remove", month: "2026-10", categoryId: f.category.id, version }, f.connection);
    expect(() => remove(1)).toThrow("Someone updated"); remove(2);
    expect(f.read().rows.find((row) => row.categoryId === f.category.id)).toMatchObject({ limit: null, version: 3 });
    expect(() => f.save("200", 2)).toThrow("Someone updated");
    expect(() => f.save("200", 0)).toThrow("Someone updated");
    expect(() => remove(3)).toThrow("Someone removed");
    f.save("250", 3);
    expect(() => remove(3)).toThrow("Someone updated");
    expect(f.read()).toMatchObject({ totalLimits: 25000 });
  });
  it("allows members, denies outsiders/revoked members, rejects foreign categories and enforces database integrity", () => {
    const f = fixture(); f.save("10", 0, "2026-10", f.category.id, f.member);
    expect(() => readBudgets(f.other, f.sheet.id, "2026-10", f.connection)).toThrow("unavailable");
    expect(() => f.save("1", 1, "2026-10", f.category.id, f.other)).toThrow("unavailable");
    f.connection.db.delete(sheetMembers).where(eq(sheetMembers.userId, f.member)).run();
    expect(() => f.save("1", 1, "2026-10", f.category.id, f.member)).toThrow("unavailable");
    const foreign = createSheet(f.owner, { name: "Foreign", currency: "USD" }, f.connection).sheet;
    const category = readSheet(f.owner, foreign.id, f.connection).categories[0]; if (!category) throw new Error();
    expect(() => f.save("1", 0, "2026-10", category.id)).toThrow("from this sheet");
    expect(() => f.connection.db.insert(budgets).values({ sheetId: f.sheet.id, categoryId: category.id, month: "2026-10", limit: 100, version: 1 }).run()).toThrow();
    for (const limit of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) expect(() => f.connection.db.insert(budgets).values({ sheetId: f.sheet.id, categoryId: f.otherCategory.id, month: "2026-10", limit, version: 1 }).run()).toThrow();
  });
  it("preserves archived historical limits/spending and persisted revisions across reopen", () => {
    const f = fixture(); f.save("150"); f.spend("-100");
    mutateSettings(f.owner, f.sheet.id, { kind: "archive", entity: "category", id: f.category.id }, f.connection);
    expect(f.read().rows.find((row) => row.categoryId === f.category.id)).toMatchObject({ archived: true, limit: 15000, spent: 10000, remaining: 5000 });
    f.save("50", 1);
    expect(() => f.save("50", 0, "2026-11")).toThrow("Restore");
    const reopened = openDatabase(f.filename);
    try { expect(readBudgets(f.owner, f.sheet.id, "2026-10", reopened)).toMatchObject({ totalLimits: 5000, remaining: -5000 }); }
    finally { reopened.sqlite.close(); }
  });
  it("uses exact currency precision, rejects invalid values and protects aggregate overflow", () => {
    expect(parseLimit("0.00", "USD")).toBe(0); expect(parseLimit("1.234", "KWD")).toBe(1234); expect(parseLimit("9", "JPY")).toBe(9);
    for (const amount of ["-1", "-0", "1.001", "0.000", "90071992547409.92", "1e2", "", ".1"]) expect(() => parseLimit(amount, "USD")).toThrow();
    const f = fixture(); f.save("90071992547409.91"); f.save("1", 0, "2026-10", f.otherCategory.id);
    expect(() => f.read()).toThrow("supported range");
    for (const month of ["2026-13", "0000-01", "2026-1", "2026-10-01"]) expect(() => f.read(month)).toThrow();
  });
});
