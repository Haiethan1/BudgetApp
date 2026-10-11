import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "../db/client";
import { migrateDatabase } from "../db/migrate";
import { sheetMembers, user } from "../db/schema";
import { createSheet, readSheet } from "./service";
import { mutateSettings } from "./settings";
import { budgetCycle, currentCycleMonth } from "./cycle";
import { calculateSpending, listTransactions, saveTransaction } from "../ledger/service";
import { mutateBudget, readBudgets } from "../budgets/service";
import { readOverview } from "../overview/service";
const resources: { connection: ReturnType<typeof openDatabase>; directory: string }[] = [];
afterEach(() => { for (const { connection, directory } of resources.splice(0)) { connection.sqlite.close(); fs.rmSync(directory, { recursive: true, force: true }); } });
function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "homebooks-cycles-"));
  const filename = path.join(directory, "cycles.sqlite"); migrateDatabase(filename);
  const connection = openDatabase(filename); resources.push({ connection, directory });
  const owner = randomUUID(), member = randomUUID(), other = randomUUID();
  for (const id of [owner, member, other]) connection.db.insert(user).values({ id, name: id, email: `${id}@example.test`, createdAt: new Date(), updatedAt: new Date() }).run();
  const sheet = createSheet(owner, { name: "Cycles", currency: "USD" }, connection).sheet;
  connection.db.insert(sheetMembers).values({ sheetId: sheet.id, userId: member, acceptedAt: new Date() }).run();
  mutateSettings(owner, sheet.id, { kind: "create", entity: "account", name: "Card", sourceType: "credit_card" }, connection);
  const organization = readSheet(owner, sheet.id, connection);
  const category = organization.categories[0], bucket = organization.buckets[0], account = organization.accounts[0];
  if (!category || !bucket || !account) throw new Error("Missing fixture organization");
  const setCycle = (startDay: number, version = 1, actor = owner) => mutateSettings(actor, sheet.id, { kind: "budgetCycle", startDay, version }, connection);
  const spend = (date: string, amount = "-10", kind = "expense") => saveTransaction(owner, sheet.id, { accountId: account.id, date, kind, payee: date, amount, splits: [{ amount, categoryId: category.id, bucketId: bucket.id }] }, undefined, connection);
  return { connection, directory, filename, owner, member, other, sheet, category, bucket, setCycle, spend };
}
describe("recurring budget cycle dates", () => {
  it("includes both endpoints and carries the chosen day across months and years", () => {
    expect(budgetCycle("2026-10", 8)).toMatchObject({ from: "2026-10-08", to: "2026-11-07" });
    expect(budgetCycle("2026-11", 8)).toMatchObject({ from: "2026-11-08", to: "2026-12-07" });
    expect(budgetCycle("2026-12", 8)).toMatchObject({ from: "2026-12-08", to: "2027-01-07" });
    expect(budgetCycle("2026-02")).toMatchObject({ from: "2026-02-01", to: "2026-02-28" });
  });
  it("clamps each start independently, including leap centuries and the supported year limits", () => {
    expect(budgetCycle("2026-01", 31)).toMatchObject({ from: "2026-01-31", to: "2026-02-27" });
    expect(budgetCycle("2026-02", 31)).toMatchObject({ from: "2026-02-28", to: "2026-03-30" });
    expect(budgetCycle("2028-02", 31)).toMatchObject({ from: "2028-02-29", to: "2028-03-30" });
    expect(budgetCycle("1900-02", 30).from).toBe("1900-02-28");
    expect(budgetCycle("2000-02", 30).from).toBe("2000-02-29");
    expect(budgetCycle("0001-01", 31)).toMatchObject({ from: "0001-01-31", to: "0001-02-27" });
    expect(budgetCycle("9999-12", 31)).toMatchObject({ from: "9999-12-31", to: "9999-12-31" });
    for (const year of [2026, 2028]) for (let day = 1; day <= 31; day++) for (let month = 1; month <= 12; month++) {
      const cycle = budgetCycle(`${year}-${String(month).padStart(2, "0")}`, day);
      const nextDate = new Date(`${cycle.to}T12:00:00Z`); nextDate.setUTCDate(nextDate.getUTCDate() + 1);
      const nextMonth = month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, "0")}`;
      expect(nextDate.toISOString().slice(0, 10)).toBe(budgetCycle(nextMonth, day).from);
    }
  });
  it("selects the cycle containing today's local calendar date", () => {
    expect(currentCycleMonth(8, new Date(2026, 9, 7, 23, 59))).toBe("2026-09");
    expect(currentCycleMonth(8, new Date(2026, 9, 8, 0, 0))).toBe("2026-10");
    expect(currentCycleMonth(31, new Date(2028, 1, 28))).toBe("2028-01");
    expect(currentCycleMonth(31, new Date(2028, 1, 29))).toBe("2028-02");
    expect(currentCycleMonth(31, new Date(2026, 0, 1))).toBe("2025-12");
  });
});
describe("sheet cycle persistence and calculations", () => {
  it("defaults existing sheets to calendar months when upgrading and preserves records", () => {
    const f = fixture();
    const oldMigrations = path.join(f.directory, "old-migrations"); fs.cpSync(path.join(process.cwd(), "drizzle"), oldMigrations, { recursive: true });
    const journalPath = path.join(oldMigrations, "meta", "_journal.json");
    const journal = JSON.parse(fs.readFileSync(journalPath, "utf8")); journal.entries = journal.entries.filter((entry: { idx: number }) => entry.idx < 10); fs.writeFileSync(journalPath, JSON.stringify(journal));
    const filename = path.join(f.directory, "old.sqlite"); migrateDatabase(filename, oldMigrations);
    const old = openDatabase(filename);
    old.sqlite.prepare('INSERT INTO user (id,name,email,created_at,updated_at) VALUES (?,?,?,?,?)').run("old-owner", "Owner", "old@example.test", 1, 1);
    old.sqlite.prepare('INSERT INTO sheets (id,name,currency,owner_id,created_at) VALUES (?,?,?,?,?)').run(f.sheet.id, "Existing", "USD", "old-owner", 1); old.sqlite.close();
    migrateDatabase(filename); migrateDatabase(filename);
    const upgraded = openDatabase(filename);
    try { expect(readSheet("old-owner", f.sheet.id, upgraded)).toMatchObject({ name: "Existing", cycleStartDay: 1, cycleVersion: 1 }); }
    finally { upgraded.sqlite.close(); }
  });
  it("authorizes configuration, validates choices, rejects stale changes, and survives reopening", () => {
    const f = fixture();
    expect(readSheet(f.member, f.sheet.id, f.connection)).toMatchObject({ cycleStartDay: 1, cycleVersion: 1 });
    expect(() => f.setCycle(8, 1, f.member)).toThrow("Only the sheet owner");
    expect(() => f.setCycle(8, 1, f.other)).toThrow("unavailable");
    for (const day of [0, 32, 1.5]) expect(() => f.setCycle(day)).toThrow();
    f.setCycle(8);
    expect(() => f.setCycle(31)).toThrow("Someone updated");
    const reopened = openDatabase(f.filename);
    try { expect(readSheet(f.member, f.sheet.id, reopened)).toMatchObject({ cycleStartDay: 8, cycleVersion: 2 }); }
    finally { reopened.sqlite.close(); }
    expect(() => listTransactions(f.owner, f.sheet.id, { cycleVersion: 1 }, f.connection)).toThrow("cycle changed");
  });
  it("shares the inclusive cycle between Overview, Budgets, spending and ledger, without moving overrides or dates", () => {
    const f = fixture();
    for (const date of ["2026-10-07", "2026-10-08", "2026-11-07", "2026-11-08"]) f.spend(date);
    f.spend("2026-11-07", "3", "refund"); f.spend("2026-11-07", "100", "income"); f.spend("2026-11-07", "-100", "transfer");
    mutateBudget(f.owner, f.sheet.id, { kind: "save", categoryId: f.category.id, month: "2026-10", version: 0, amount: "50" }, f.connection);
    expect(calculateSpending(f.owner, f.sheet.id, "2026-10", f.connection).total).toBe(2000);
    f.setCycle(8);
    const budget = readBudgets(f.member, f.sheet.id, "2026-10", f.connection);
    const overview = readOverview(f.owner, f.sheet.id, "2026-10", f.connection);
    expect(budget).toMatchObject({ total: 1700, totalLimits: 5000, remaining: 3300, cycle: { from: "2026-10-08", to: "2026-11-07", version: 2 } });
    expect(overview).toMatchObject(budget); expect(overview.monthTransactionCount).toBe(5);
    const ledger = listTransactions(f.owner, f.sheet.id, { from: budget.cycle.from, to: budget.cycle.to, cycleVersion: 2 }, f.connection);
    expect(ledger.total).toBe(5); expect(ledger.transactions.map((row) => row.date).sort()).toEqual(["2026-10-08", "2026-11-07", "2026-11-07", "2026-11-07", "2026-11-07"]);
    expect(overview.recent).toEqual(ledger.transactions);
    expect(calculateSpending(f.owner, f.sheet.id, "2026-10", f.connection)).toMatchObject({ total: 1700, categories: { [f.category.id]: 1700 }, buckets: { [f.bucket.id]: 1700 } });
    expect(readBudgets(f.owner, f.sheet.id, "2026-11", f.connection)).toMatchObject({ total: 1000, totalLimits: 0 });
    expect(() => mutateBudget(f.owner, f.sheet.id, { kind: "save", categoryId: f.category.id, month: "2026-10", version: 1, cycleVersion: 1, amount: "60" }, f.connection)).toThrow("cycle changed");
    f.setCycle(1, 2);
    expect(readBudgets(f.owner, f.sheet.id, "2026-10", f.connection)).toMatchObject({ total: 2000, totalLimits: 5000 });
    expect(listTransactions(f.owner, f.sheet.id, {}, f.connection).total).toBe(7);
  });
});
