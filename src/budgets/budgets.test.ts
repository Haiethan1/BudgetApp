import fs from "node:fs";
import { z } from "zod";
import { createSnapshot, restoreSnapshot, validateSnapshot } from "../operations/snapshots";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDatabase } from "../db/client";
import { migrateDatabase } from "../db/migrate";
import { budgets, sheetMembers, user } from "../db/schema";
import { createSheet, readSheet } from "../sheets/service";
import { mutateSettings } from "../sheets/settings";
import { calculateSpending, deleteTransaction, saveTransaction } from "../ledger/service";
import { mutateBudget, readBudgets } from "./service";
import { parseLimit } from "./input";
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-14T12:00:00Z")); });
afterEach(() => vi.useRealTimers());
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

describe("recurring default budgets", () => {
  it("inherits defaults, preserves monthly overrides and explicit removals, and resets an override", () => {
    const f = fixture();
    const change = (input: object) => mutateBudget(f.owner, f.sheet.id, { categoryId: f.category.id, effectiveFrom: "2026-10-01", currentVersion: f.read().rows.find((r) => r.categoryId === f.category.id)?.version ?? 0, cycleVersion: 1, ...input }, f.connection);
    change({ kind: "saveDefault", version: 0, amount: "100" });
    expect(f.read("2026-11")).toMatchObject({ totalLimits: 10000 });
    expect(f.read("2026-09")).toMatchObject({ totalLimits: 0 });
    f.save("250", 0, "2026-12");
    change({ kind: "remove", month: "2026-11", version: 0 });
    change({ kind: "saveDefault", version: 1, amount: "150" });
    expect(f.read("2026-10")).toMatchObject({ totalLimits: 15000 });
    expect(f.read("2026-11")).toMatchObject({ totalLimits: 0 });
    expect(f.read("2026-12")).toMatchObject({ totalLimits: 25000 });
    change({ kind: "useDefault", month: "2026-12", version: 1 });
    expect(f.read("2026-12").rows.find((row) => row.categoryId === f.category.id)).toMatchObject({ limit: 15000, source: "default", version: 2 });
    expect(() => f.save("300", 1, "2026-12")).toThrow("Someone updated");
    change({ kind: "removeDefault", version: 2 });
    expect(f.read("2026-12")).toMatchObject({ totalLimits: 0 });
    change({ kind: "saveDefault", version: 3, amount: "0" });
    expect(f.read("2026-12").rows.find((row) => row.categoryId === f.category.id)).toMatchObject({ limit: 0, defaultLimit: 0 });
  });
  it("creates a default atomically from a monthly edit and rejects stale default revisions", () => {
    const f = fixture();
    const save = (version: number, defaultVersion: number, amount: string) => mutateBudget(f.member, f.sheet.id, { kind: "save", month: "2026-10", categoryId: f.category.id, version, defaultVersion, amount, makeDefault: true, effectiveFrom: "2026-10-01", currentVersion: version, cycleVersion: 1 }, f.connection);
    save(0, 0, "120");
    expect(f.read("2026-11")).toMatchObject({ totalLimits: 12000 });
    expect(() => save(1, 0, "200")).toThrow("Someone updated this default");
    expect(f.read()).toMatchObject({ totalLimits: 12000 });
    expect(f.read().rows.find((row) => row.categoryId === f.category.id)).toMatchObject({ version: 1, defaultVersion: 1 });
    expect(() => mutateBudget(f.other, f.sheet.id, { kind: "saveDefault", categoryId: f.category.id, version: 1, amount: "10" }, f.connection)).toThrow("unavailable");
    save(1, 1, "180");
    const reopened = openDatabase(f.filename);
    try { expect(readBudgets(f.owner, f.sheet.id, "2026-11", reopened)).toMatchObject({ totalLimits: 18000 }); }
    finally { reopened.sqlite.close(); }
  });
});

describe("effective-period defaults", () => {
  it("keeps $400 history, retains $425 and future overrides, and explicitly replaces current", () => {
    const f = fixture();
    const row = () => { const value = f.read().rows.find((r) => r.categoryId === f.category.id); if (!value) throw new Error(); return value; };
    const change = (kind: "saveDefault" | "removeDefault", amount = "0", replaceCurrent = false) => { const r = row(); return mutateBudget(f.owner, f.sheet.id, { kind, amount, categoryId: f.category.id, version: r.defaultVersion, effectiveFrom: r.effectiveFrom, currentVersion: r.currentVersion, cycleVersion: 1, replaceCurrent }, f.connection); };
    vi.setSystemTime(new Date("2026-09-10T12:00:00Z")); change("saveDefault", "400");
    vi.setSystemTime(new Date("2026-10-14T12:00:00Z"));
    f.save("425"); f.save("0", 0, "2026-11");
    mutateBudget(f.owner, f.sheet.id, { kind: "remove", month: "2026-12", categoryId: f.category.id, version: 0 }, f.connection);
    change("saveDefault", "450");
    expect(f.read("2026-09").totalLimits).toBe(40000);
    expect(f.read().totalLimits).toBe(42500);
    expect(f.read("2026-11").rows.find((r) => r.categoryId === f.category.id)?.limit).toBe(0);
    expect(f.read("2026-12").rows.find((r) => r.categoryId === f.category.id)?.limit).toBeNull();
    expect(f.read("2027-01").totalLimits).toBe(45000);
    change("saveDefault", "475", true);
    expect(row()).toMatchObject({ limit: 47500, source: "default", version: 2 });
    change("removeDefault"); expect(row().limit).toBeNull();
    expect(f.read("2026-09").totalLimits).toBe(40000);
    change("saveDefault", "0"); expect(row().limit).toBe(0);
    expect(f.connection.sqlite.prepare("SELECT effective_from, version FROM budget_default_changes ORDER BY version").all()).toEqual([{ effective_from: "2026-09-01", version: 1 }, { effective_from: "2026-10-01", version: 2 }, { effective_from: "2026-10-01", version: 3 }, { effective_from: "2026-10-01", version: 4 }, { effective_from: "2026-10-01", version: 5 }]);
  });
  it("atomically saves past and future amounts while default changes use actual current and reject every stale revision", () => {
    const f = fixture(); f.save("425");
    const row = () => { const r = f.read().rows.find((r) => r.categoryId === f.category.id); if (!r) throw new Error(); return r; };
    const combined = (month: string, version = 0) => { const r = row(); return { kind: "save", categoryId: f.category.id, month, version, amount: "450", makeDefault: true, defaultVersion: r.defaultVersion, effectiveFrom: r.effectiveFrom, currentVersion: r.currentVersion, cycleVersion: 1 }; };
    mutateBudget(f.owner, f.sheet.id, combined("2026-08-01"), f.connection);
    expect(f.read("2026-08").totalLimits).toBe(45000); expect(f.read("2026-09").totalLimits).toBe(0); expect(row().limit).toBe(42500);
    const staleCurrent = combined("2026-12-01"); f.save("430", 1);
    expect(() => mutateBudget(f.owner, f.sheet.id, staleCurrent, f.connection)).toThrow("current period");
    expect(f.read("2026-12").rows.find((r) => r.categoryId === f.category.id)?.version).toBe(0);
    expect(row().defaultVersion).toBe(1);
    const staleDefault = combined("2026-12-01");
    mutateBudget(f.owner, f.sheet.id, { ...combined("2026-11-01"), amount: "500" }, f.connection);
    expect(() => mutateBudget(f.owner, f.sheet.id, staleDefault, f.connection)).toThrow("default limit");
    const staleSelected = combined("2026-12-01"); f.save("550", 0, "2026-12");
    expect(() => mutateBudget(f.owner, f.sheet.id, staleSelected, f.connection)).toThrow("monthly limit"); expect(row().defaultVersion).toBe(2);
    const staleCycle = combined("2027-01-01");
    const plan = { kind: "budgetCycle", startDay: 20, effectiveDate: "2026-10-20", transition: "short", version: 1 };
    const preview = mutateSettings(f.owner, f.sheet.id, { ...plan, preview: true }, f.connection);
    mutateSettings(f.owner, f.sheet.id, { ...plan, previewToken: preview?.previewToken }, f.connection);
    expect(() => mutateBudget(f.owner, f.sheet.id, staleCycle, f.connection)).toThrow("cycle changed"); expect(row().defaultVersion).toBe(2);
    vi.setSystemTime(new Date("2026-10-21T12:00:00Z"));
    const r = row();
    mutateBudget(f.owner, f.sheet.id, { kind: "saveDefault", categoryId: f.category.id, version: r.defaultVersion, amount: "600", effectiveFrom: r.effectiveFrom, currentVersion: r.currentVersion, cycleVersion: 2 }, f.connection);
    expect(r.effectiveFrom).toBe("2026-10-20");
    expect(f.read("2026-10-01").totalLimits).toBe(43000); expect(f.read("2026-10-20").totalLimits).toBe(50000);
    expect(f.read("2027-02-20").totalLimits).toBe(60000);
  });
});

it.each([8, 31])("baselines populated pre0013 day%i history and restores real legacy and effective-default snapshots", async (day) => {
  const f = fixture();
  f.connection.sqlite.prepare("UPDATE sheets SET cycle_start_day=?, cycle_baseline_day=? WHERE id=?").run(day, day, f.sheet.id);
  for (const name of ["Zero", "Removed", "No limit"]) mutateSettings(f.owner, f.sheet.id, { kind: "create", entity: "category", name }, f.connection);
  const organization = readSheet(f.owner, f.sheet.id, f.connection);
  for (const category of organization.categories) {
    const limit = category.name === "Removed" ? null : category.name === "Zero" ? 0 : 40000;
    f.connection.sqlite.prepare('INSERT INTO budget_defaults VALUES (?,?,?,11)').run(f.sheet.id, category.id, limit);
    f.connection.sqlite.prepare("INSERT INTO budget_default_changes VALUES (?,?,'0001-01-01',?,11)").run(f.sheet.id, category.id, limit);
  }
  for (const month of ["2024-02", "2026-09", "2026-10", "2026-11", "2030-12"]) {
    for (const category of organization.categories) {
      const start = `${month}-${day === 31 && month === "2024-02" ? "29" : String(day).padStart(2,"0")}`;
      const inherits = category.name !== "No limit" && category.name !== "Zero";
      f.connection.sqlite.prepare("INSERT INTO budgets VALUES (?,?,?,?,7,?)").run(f.sheet.id, category.id, start, category.name === "Zero" ? 0 : null, inherits ? 1 : 0);
    }
  }
  f.spend("-12", "2024-02-29"); f.spend("-10", "2026-10-14");
  const reports = ["2024-02", "2026-09", "2026-10", "2026-11", "2030-12"].map((month) => f.read(month));
  const prefix = path.join(path.dirname(f.filename), "prefix13"); fs.cpSync("drizzle", prefix, { recursive: true });
  const journalFile = path.join(prefix, "meta/_journal.json");
  const journal = JSON.parse(fs.readFileSync(journalFile, "utf8")); journal.entries = journal.entries.filter((entry: { idx: number }) => entry.idx < 13); fs.writeFileSync(journalFile, JSON.stringify(journal));
  const filename = path.join(path.dirname(f.filename), "legacy13.sqlite"); migrateDatabase(filename, prefix);
  const legacy = openDatabase(filename);
  try {
    legacy.sqlite.prepare("ATTACH DATABASE ? AS source").run(f.filename);
    for (const table of ["user", "sheets", "sheet_members", "categories", "buckets", "financial_accounts", "transactions", "splits", "budget_defaults", "budgets", "cycle_changes"]) {
      const columns = z.array(z.object({ name: z.string() })).parse(legacy.sqlite.prepare(`PRAGMA main.table_info(${table})`).all()).map((row) => `"${row.name}"`).join(",");
      legacy.sqlite.exec(`INSERT INTO main.${table} (${columns}) SELECT ${columns} FROM source.${table}`);
    }
    legacy.sqlite.exec("DETACH DATABASE source");
  } finally { legacy.sqlite.close(); }
  const options = { filename, backupDirectory: path.join(path.dirname(f.filename), "backups13") };
  const legacySnapshot = await createSnapshot(options); expect(validateSnapshot(legacySnapshot).manifest.migrations).toHaveLength(13);
  migrateDatabase(filename); migrateDatabase(filename);
  const upgraded = openDatabase(filename);
  let expectedHistory: unknown;
  try {
    for (const report of reports) expect(readBudgets(f.owner, f.sheet.id, report.month, upgraded)).toEqual(report);
    expect(upgraded.sqlite.prepare("SELECT category_id,version FROM budget_default_changes WHERE effective_from='0001-01-01' ORDER BY category_id").all()).toEqual(upgraded.sqlite.prepare("SELECT category_id,version FROM budget_defaults ORDER BY category_id").all());
    const row = readBudgets(f.owner, f.sheet.id, "2026-10", upgraded).rows.find((r) => r.categoryId === f.category.id); if (!row) throw new Error();
    mutateBudget(f.owner, f.sheet.id, { kind: "saveDefault", categoryId: f.category.id, version: 11, amount: "450", effectiveFrom: row.effectiveFrom, currentVersion: row.currentVersion, cycleVersion: 1 }, upgraded);
    expectedHistory = upgraded.sqlite.prepare("SELECT * FROM budget_default_changes ORDER BY category_id,version").all();
    expect(readBudgets(f.owner, f.sheet.id, "2024-02", upgraded).totalLimits).toBe(reports[0].totalLimits);
  } finally { upgraded.sqlite.close(); }
  const revisedSnapshot = await createSnapshot(options);
  const restoredFile = path.join(path.dirname(f.filename), "restored13.sqlite");
  const restoreOptions = { filename: restoredFile, backupDirectory: path.join(path.dirname(f.filename), "restore-backups13") };
  await restoreSnapshot(revisedSnapshot, restoreOptions);
  let restored = openDatabase(restoredFile);
  try { expect(restored.sqlite.prepare("SELECT * FROM budget_default_changes ORDER BY category_id,version").all()).toEqual(expectedHistory); }
  finally { restored.sqlite.close(); }
  await restoreSnapshot(legacySnapshot, restoreOptions); migrateDatabase(restoredFile);
  restored = openDatabase(restoredFile);
  try { for (const report of reports) expect(readBudgets(f.owner, f.sheet.id, report.month, restored)).toEqual(report); }
  finally { restored.sqlite.close(); }
});
