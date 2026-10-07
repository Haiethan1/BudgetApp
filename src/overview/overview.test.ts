import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "../db/client";
import { migrateDatabase } from "../db/migrate";
import { sheetMembers, user } from "../db/schema";
import { createSheet, readSheet } from "../sheets/service";
import { mutateSettings } from "../sheets/settings";
import { deleteTransaction, saveTransaction } from "../ledger/service";
import { mutateBudget, readBudgets } from "../budgets/service";
import { readOverview } from "./service";
import { overviewSchema } from "./presentation";
const resources: { connection: ReturnType<typeof openDatabase>; directory: string }[] = [];
afterEach(() => { for (const { connection, directory } of resources.splice(0)) { connection.sqlite.close(); fs.rmSync(directory, { recursive: true, force: true }); } });
function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "homebooks-overview-")); const filename = path.join(directory, "overview.sqlite"); migrateDatabase(filename);
  const connection = openDatabase(filename); resources.push({ connection, directory });
  const owner = randomUUID(); const member = randomUUID(); const outsider = randomUUID();
  for (const id of [owner, member, outsider]) connection.db.insert(user).values({ id, name: id, email: `${id}@example.test`, emailVerified: false, createdAt: new Date(), updatedAt: new Date() }).run();
  const sheet = createSheet(owner, { name: "Reference", currency: "USD" }, connection).sheet;
  connection.db.insert(sheetMembers).values({ sheetId: sheet.id, userId: member, acceptedAt: new Date() }).run();
  for (const name of ["Groceries", "Utilities", "Dining", "Transport"]) mutateSettings(owner, sheet.id, { kind: "create", entity: "category", name }, connection);
  for (const name of ["Ethan", "Parents"]) mutateSettings(owner, sheet.id, { kind: "create", entity: "bucket", name }, connection);
  mutateSettings(owner, sheet.id, { kind: "create", entity: "account", name: "Visa", sourceType: "credit_card" }, connection);
  const organization = readSheet(owner, sheet.id, connection); const account = organization.accounts[0]; if (!account) throw new Error();
  function category(name: string) { const row = organization.categories.find((row) => row.name === name); if (!row) throw new Error(name); return row.id; }
  function bucket(name: string) { const row = organization.buckets.find((row) => row.name === name); if (!row) throw new Error(name); return row.id; }
  function transaction(payee: string, date: string, kind: string, amount: string, name: string, allocations: [string, string][]) {
    return saveTransaction(owner, sheet.id, { accountId: account.id, payee, date, kind, amount, splits: allocations.map(([nameBucket, splitAmount]) => ({ categoryId: category(name), bucketId: bucket(nameBucket), amount: splitAmount })) }, undefined, connection);
  }
  function seed() {
    transaction("Market purchase", "2026-10-04", "expense", "-100", "Groceries", [["Ethan", "-60"], ["Parents", "-40"]]);
    transaction("Market refund", "2026-10-06", "refund", "20", "Groceries", [["Ethan", "20"]]);
    transaction("Electricity", "2026-10-08", "expense", "-120", "Utilities", [["Ethan", "-70"], ["Parents", "-50"]]);
    transaction("Lunch", "2026-10-10", "expense", "-24.50", "Dining", [["Ethan", "-24.50"]]);
    transaction("Fuel", "2026-10-11", "expense", "-35", "Transport", [["Ethan", "-35"]]);
    transaction("Unreviewed purchase", "2026-10-12", "expense", "-18.50", "Uncategorized", [["Unassigned", "-18.50"]]);
    transaction("Card payment", "2026-10-13", "transfer", "-100", "Uncategorized", [["Unassigned", "-100"]]);
    transaction("Paycheck", "2026-10-01", "income", "2000", "Uncategorized", [["Unassigned", "2000"]]);
    for (const [name, amount] of [["Groceries", "150"], ["Utilities", "100"], ["Dining", "100"], ["Transport", "60"]]) { if (name === undefined || amount === undefined) throw new Error(); mutateBudget(owner, sheet.id, { kind: "save", categoryId: category(name), month: "2026-10", version: 0, amount }, connection); }
  }
  return { owner, member, outsider, connection, sheet, category, bucket, seed, transaction, read: (month = "2026-10", actor = owner) => readOverview(actor, sheet.id, month, connection) };
}
describe("Overview snapshot", () => {
  it("matches the literal reference fixture and shared budget authority with five date-descending recent rows", () => {
    const f = fixture(); f.seed(); const overview = f.read();
    expect(overviewSchema.safeParse(overview).success).toBe(true);
    expect(overview).toMatchObject({ total: 27800, uncategorized: 1850, totalLimits: 41000, budgetedSpent: 25950, remaining: 15050, monthTransactionCount: 8, hasTransactions: true });
    expect(overview.attribution.map(({ name, spent }) => ({ name, spent }))).toEqual([{ name: "Ethan", spent: 16950 }, { name: "Parents", spent: 9000 }, { name: "Unassigned", spent: 1850 }]);
    expect(overview.rows.find((row) => row.name === "Utilities")).toMatchObject({ spent: 12000, limit: 10000, remaining: -2000 });
    expect(overview.recent.map((row) => row.payee)).toEqual(["Card payment", "Unreviewed purchase", "Fuel", "Lunch", "Electricity"]);
    expect(overview).toMatchObject(readBudgets(f.owner, f.sheet.id, "2026-10", f.connection));
    expect(overview.uncategorizedId).toBe(f.category("Uncategorized"));
  });
  it("distinguishes first-use, empty month and no limits and supports February leap boundaries", () => {
    const f = fixture(); expect(f.read()).toMatchObject({ hasTransactions: false, monthTransactionCount: 0, total: 0 });
    f.transaction("Leap purchase", "2028-02-29", "expense", "-10", "Groceries", [["Ethan", "-10"]]);
    expect(f.read()).toMatchObject({ hasTransactions: true, monthTransactionCount: 0, total: 0, remaining: 0 });
    expect(f.read("2028-02")).toMatchObject({ monthTransactionCount: 1, total: 1000, totalLimits: 0, budgetedSpent: 0 });
    expect(f.read("2028-02").rows.every((row) => row.limit === null)).toBe(true);
    expect(f.read("2028-03").monthTransactionCount).toBe(0);
  });
  it("retains negative refunds and archived historical names, excludes tombstones, and distinguishes explicit zero", () => {
    const f = fixture(); f.seed();
    f.transaction("Later refund", "2026-11-01", "refund", "120", "Groceries", [["Ethan", "120"]]);
    mutateBudget(f.owner, f.sheet.id, { kind: "save", categoryId: f.category("Groceries"), month: "2026-11", version: 0, amount: "0" }, f.connection);
    mutateSettings(f.owner, f.sheet.id, { kind: "archive", entity: "category", id: f.category("Groceries") }, f.connection);
    mutateSettings(f.owner, f.sheet.id, { kind: "archive", entity: "bucket", id: f.bucket("Ethan") }, f.connection);
    const november = f.read("2026-11"); expect(november).toMatchObject({ total: -12000, budgetedSpent: -12000, remaining: 12000 });
    expect(november.attribution).toEqual([{ id: f.bucket("Ethan"), name: "Ethan", archived: true, protected: false, spent: -12000 }, { id: f.bucket("Parents"), name: "Parents", archived: false, protected: false, spent: 0 }]);
    expect(november.rows.find((row) => row.name === "Groceries")).toMatchObject({ archived: true, limit: 0, spent: -12000, remaining: 12000 });
    const recent = november.recent[0]; if (!recent) throw new Error(); deleteTransaction(f.owner, f.sheet.id, recent.id, { version: 1 }, f.connection);
    expect(f.read("2026-11")).toMatchObject({ total: 0, monthTransactionCount: 0 }); expect(f.read().total).toBe(27800);
  });
  it("allows members but denies other sheets, outsiders and revoked members", () => {
    const f = fixture(); f.seed(); expect(f.read("2026-10", f.member).total).toBe(27800);
    expect(() => f.read("2026-10", f.outsider)).toThrow("unavailable");
    f.connection.db.delete(sheetMembers).where(eq(sheetMembers.userId, f.member)).run(); expect(() => f.read("2026-10", f.member)).toThrow("unavailable");
    const other = createSheet(f.owner, { name: "Empty", currency: "USD" }, f.connection).sheet;
    expect(readOverview(f.owner, other.id, "2026-10", f.connection)).toMatchObject({ total: 0, totalLimits: 0, hasTransactions: false });
  });
});
