import fs from "node:fs";
import { z } from "zod";
import { createSnapshot, restoreSnapshot, validateSnapshot } from "../operations/snapshots";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";
import { openDatabase } from "../db/client";
import { migrateDatabase } from "../db/migrate";
import { sheetMembers, user } from "../db/schema";
import { createSheet, readSheet } from "./service";
import { mutateSettings } from "./settings";
import { budgetCycle, currentCycleMonth, resolvePeriod, periodContaining, previewCycleChange, adjacentPeriod, currentPeriod } from "./cycle";
import { listTransactions, saveTransaction } from "../ledger/service";
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
  const setCycle = (startDay: number, effectiveDate: string, transition: "short" | "long" = "short", version = 1, actor = owner) => {
    const input = { kind: "budgetCycle", startDay, effectiveDate, transition, version };
    const preview = mutateSettings(actor, sheet.id, { ...input, preview: true }, connection);
    return mutateSettings(actor, sheet.id, { ...input, previewToken: preview?.previewToken }, connection);
  };
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
  it.each([8, 31])("migrates populated day-%i periods and restores real legacy and revised snapshots", async (day) => {
    vi.useRealTimers();
    const f = fixture();
    f.connection.sqlite.prepare("UPDATE sheets SET cycle_start_day=?,cycle_baseline_day=?,cycle_version=7 WHERE id=?").run(day, day, f.sheet.id);
    for (const date of ["2024-02-28", "2024-02-29", "2024-03-01", "2026-10-14", "2030-12-31"]) f.spend(date);
    f.connection.sqlite.prepare('INSERT INTO budget_defaults VALUES (?,?,40000,9)').run(f.sheet.id, f.category.id);
    f.connection.sqlite.prepare("INSERT INTO budget_default_changes VALUES (?,?,'0001-01-01',40000,9)").run(f.sheet.id, f.category.id);
    for (const [month, amount] of [["2024-02", "12"], ["2026-10", "0"], ["2030-12", "99"]]) mutateBudget(f.owner, f.sheet.id, { kind: "save", categoryId: f.category.id, month, version: 0, amount }, f.connection);
    mutateBudget(f.owner, f.sheet.id, { kind: "remove", categoryId: f.category.id, month: "2027-01", version: 0 }, f.connection);
    mutateBudget(f.owner, f.sheet.id, { kind: "useDefault", categoryId: f.category.id, month: "2027-02", version: 0 }, f.connection);
    f.connection.sqlite.exec("UPDATE budgets SET version=version+5; UPDATE budget_defaults SET version=9");
    const originalBudgets = f.connection.sqlite.prepare("SELECT * FROM budgets ORDER BY month").all();
    const originalTransactions = f.connection.sqlite.prepare("SELECT * FROM transactions ORDER BY id").all();
    const originalDefaults = f.connection.sqlite.prepare("SELECT * FROM budget_defaults").all();
    const originalReport = readBudgets(f.owner, f.sheet.id, "2024-02", f.connection);
    const prefix = path.join(f.directory, "prefix"); fs.cpSync("drizzle", prefix, { recursive: true });
    const journal = JSON.parse(fs.readFileSync(path.join(prefix, "meta/_journal.json"), "utf8")); journal.entries = journal.entries.filter((entry: { idx: number }) => entry.idx < 12); fs.writeFileSync(path.join(prefix, "meta/_journal.json"), JSON.stringify(journal));
    const legacyFile = path.join(f.directory, "legacy.sqlite"); migrateDatabase(legacyFile, prefix);
    const legacy = openDatabase(legacyFile);
    try {
      legacy.sqlite.prepare("ATTACH DATABASE ? AS source").run(f.filename);
      for (const table of ["user", "sheets", "sheet_members", "categories", "buckets", "financial_accounts", "transactions", "splits", "budget_defaults", "budgets"]) {
        const columns = z.array(z.object({ name: z.string() })).parse(legacy.sqlite.prepare(`PRAGMA main.table_info(${table})`).all()).map((row) => row.name);
        legacy.sqlite.exec(`INSERT INTO main.${table} (${columns.map((column) => `"${column}"`).join(",")}) SELECT ${columns.map((column) => table === "budgets" && column === "month" ? "substr(month,1,7)" : `"${column}"`).join(",")} FROM source.${table}`);
      }
      legacy.sqlite.exec("DETACH DATABASE source");
    } finally { legacy.sqlite.close(); }
    const options = { filename: legacyFile, backupDirectory: path.join(f.directory, "backups") };
    const legacySnapshot = await createSnapshot(options); expect(validateSnapshot(legacySnapshot).manifest.migrations).toHaveLength(12);
    migrateDatabase(legacyFile); migrateDatabase(legacyFile);
    const upgraded = openDatabase(legacyFile);
    try {
      expect(readSheet(f.owner, f.sheet.id, upgraded)).toMatchObject({ cycleStartDay: day, cycleVersion: 7, cycleHistory: { baselineDay: day, revisions: [] } });
      expect(upgraded.sqlite.prepare("SELECT * FROM budgets ORDER BY month").all()).toEqual(originalBudgets);
      expect(upgraded.sqlite.prepare("SELECT * FROM transactions ORDER BY id").all()).toEqual(originalTransactions);
      expect(upgraded.sqlite.prepare("SELECT * FROM budget_defaults").all()).toEqual(originalDefaults);
      expect(readBudgets(f.owner, f.sheet.id, "2024-02", upgraded)).toEqual(originalReport);
      const change = { kind: "budgetCycle", startDay: 20, effectiveDate: "2031-01-20", transition: "short", version: 7 };
      const preview = mutateSettings(f.owner, f.sheet.id, { ...change, preview: true }, upgraded);
      mutateSettings(f.owner, f.sheet.id, { ...change, previewToken: preview?.previewToken }, upgraded);
    } finally { upgraded.sqlite.close(); }
    const revisedSnapshot = await createSnapshot(options);
    const restoredFile = path.join(f.directory, "restored.sqlite"); const restoreOptions = { filename: restoredFile, backupDirectory: path.join(f.directory, "restore-backups") };
    await restoreSnapshot(revisedSnapshot, restoreOptions);
    let restored = openDatabase(restoredFile);
    try { expect(readSheet(f.owner, f.sheet.id, restored).cycleHistory.revisions).toHaveLength(1); expect(restored.sqlite.prepare("SELECT * FROM transactions ORDER BY id").all()).toEqual(originalTransactions); }
    finally { restored.sqlite.close(); }
    await restoreSnapshot(legacySnapshot, restoreOptions); migrateDatabase(restoredFile);
    restored = openDatabase(restoredFile);
    try { expect(restored.sqlite.prepare("SELECT * FROM budgets ORDER BY month").all()).toEqual(originalBudgets); expect(readBudgets(f.owner, f.sheet.id, "2024-02", restored)).toEqual(originalReport); }
    finally { restored.sqlite.close(); }
  });
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-14T12:00:00Z")); });
  afterEach(() => vi.useRealTimers());
  it("preserves completed periods, maps future limits in order, and shares all report boundaries", () => {
    const f = fixture();
    f.connection.sqlite.prepare("UPDATE sheets SET cycle_start_day=8,cycle_baseline_day=8 WHERE id=?").run(f.sheet.id);
    for (const date of ["2026-09-08", "2026-10-07", "2026-10-08", "2026-10-19", "2026-10-20", "2026-11-19", "2026-11-20"]) f.spend(date);
    const save = (month: string, amount: string) => mutateBudget(f.owner, f.sheet.id, { kind: "save", categoryId: f.category.id, month, version: 0, amount }, f.connection);
    save("2026-09", "45"); save("2026-10", "50"); save("2026-11", "0"); save("2026-12", "90"); save("2030-12", "123");
    const historical = readBudgets(f.owner, f.sheet.id, "2026-09", f.connection);
    f.setCycle(20, "2026-10-20");
    const sheet = readSheet(f.owner, f.sheet.id, f.connection);
    expect(readBudgets(f.owner, f.sheet.id, "2026-09-08", f.connection)).toMatchObject({ total: historical.total, totalLimits: historical.totalLimits, cycle: { from: "2026-09-08", to: "2026-10-07" } });
    expect(readBudgets(f.member, f.sheet.id, "2026-10-08", f.connection)).toMatchObject({ total: 2000, totalLimits: 5000, cycle: { to: "2026-10-19" } });
    const next = readOverview(f.owner, f.sheet.id, "2026-10-20", f.connection);
    expect(next).toMatchObject({ total: 2000, totalLimits: 0, cycle: { from: "2026-10-20", to: "2026-11-19" } });
    expect(listTransactions(f.owner, f.sheet.id, { from: next.cycle.from, to: next.cycle.to }, f.connection).total).toBe(2);
    expect(readBudgets(f.owner, f.sheet.id, "2026-11-20", f.connection).totalLimits).toBe(9000);
    expect(readBudgets(f.owner, f.sheet.id, "2030-11-20", f.connection).totalLimits).toBe(12300);
    expect(adjacentPeriod("2026-10-08", 1, sheet)).toBe("2026-10-20");
    f.setCycle(31, "2026-12-31", "long", 2);
    expect(readBudgets(f.owner, f.sheet.id, "2026-10-08", f.connection).cycle).toMatchObject({ from: "2026-10-08", to: "2026-10-19" });
    expect(readBudgets(f.owner, f.sheet.id, "2026-10-20", f.connection).cycle).toMatchObject({ from: "2026-10-20", to: "2026-11-19" });
    expect(readBudgets(f.owner, f.sheet.id, "2026-11-20", f.connection)).toMatchObject({ totalLimits: 9000, cycle: { to: "2026-12-30" } });
    expect(readBudgets(f.owner, f.sheet.id, "2030-11-30", f.connection).totalLimits).toBe(12300);
    expect(() => mutateBudget(f.owner, f.sheet.id, { kind: "save", month: "2026-10", categoryId: f.category.id, cycleVersion: 3, version: 1, amount: "66" }, f.connection)).toThrow("exact period start");
    expect(() => mutateBudget(f.owner, f.sheet.id, { kind: "save", month: "2026-11-20", categoryId: f.category.id, version: 1, amount: "66" }, f.connection)).toThrow("cycle changed");
    expect(listTransactions(f.owner, f.sheet.id, {}, f.connection).transactions.map((row) => row.date).sort()).toEqual(["2026-09-08", "2026-10-07", "2026-10-08", "2026-10-19", "2026-10-20", "2026-11-19", "2026-11-20"]);
  });
  it.each(["2027-04-30", "2028-02-29"])("aligns a changed anchor at existing boundary %s without extending or losing limits", (effectiveDate) => {
    const f = fixture();
    f.connection.sqlite.prepare("UPDATE sheets SET cycle_start_day=31,cycle_baseline_day=31 WHERE id=?").run(f.sheet.id);
    const oldSheet = readSheet(f.owner, f.sheet.id, f.connection);
    const preceding = periodContaining(new Date(new Date(`${effectiveDate}T12:00:00Z`).getTime() - 86400000).toISOString().slice(0,10), oldSheet);
    const month = effectiveDate.slice(0,7);
    const nextMonth = month.endsWith("04") ? "2027-05" : "2028-03";
    mutateBudget(f.owner, f.sheet.id, { kind: "save", month: preceding.from, categoryId: f.category.id, version: 0, amount: "111" }, f.connection);
    mutateBudget(f.owner, f.sheet.id, { kind: "save", month, categoryId: f.category.id, version: 0, amount: "0" }, f.connection);
    mutateBudget(f.owner, f.sheet.id, { kind: "save", month: nextMonth, categoryId: f.category.id, version: 0, amount: "333" }, f.connection);
    mutateBudget(f.owner, f.sheet.id, { kind: "save", month: "2030-12", categoryId: f.category.id, version: 0, amount: "44" }, f.connection);
    mutateBudget(f.owner, f.sheet.id, { kind: "remove", month: "2030-12", categoryId: f.category.id, version: 1 }, f.connection);
    const input = { kind: "budgetCycle", startDay: 30, effectiveDate, transition: "short", version: 1 };
    const preview = mutateSettings(f.owner, f.sheet.id, { ...input, preview: true }, f.connection);
    expect(preview).toMatchObject({ transitionKind: "aligned", transition: preceding, revision: { transitionFrom: effectiveDate, recurringFrom: effectiveDate } });
    expect(preview?.mappings.map((row) => [row.oldPeriod.from, row.newPeriod.from])).toEqual([[effectiveDate, effectiveDate], [`${nextMonth}-31`, `${nextMonth}-30`], ["2030-12-31", "2030-12-30"]]);
    mutateSettings(f.owner, f.sheet.id, { ...input, previewToken: preview?.previewToken }, f.connection);
    expect(readBudgets(f.owner, f.sheet.id, preceding.from, f.connection)).toMatchObject({ totalLimits: 11100, cycle: { from: preceding.from, to: preceding.to, startDay: 31 } });
    expect(readBudgets(f.owner, f.sheet.id, effectiveDate, f.connection)).toMatchObject({ totalLimits: 0, rows: [expect.objectContaining({ limit: 0, version: 1, source: "month" })] });
    expect(readBudgets(f.owner, f.sheet.id, `${nextMonth}-30`, f.connection).totalLimits).toBe(33300);
    expect(readBudgets(f.owner, f.sheet.id, "2030-12-30", f.connection).rows[0]).toMatchObject({ limit: null, source: "month", version: 2 });
    expect(f.connection.sqlite.prepare("SELECT count(*) AS count FROM budgets").get()).toEqual({ count: 4 });
    const nowOnBoundary = previewCycleChange(oldSheet, { startDay: 30, effectiveDate, transition: "short" }, effectiveDate);
    expect(nowOnBoundary.transition).toEqual(preceding);
    expect(() => previewCycleChange(oldSheet, { startDay: 31, effectiveDate, transition: "short" }, effectiveDate)).toThrow("already uses");
  });
  it("rejects future override overflow without dropping any record", () => {
    const f = fixture();
    f.connection.sqlite.prepare("UPDATE sheets SET cycle_start_day=31,cycle_baseline_day=31 WHERE id=?").run(f.sheet.id);
    mutateBudget(f.owner, f.sheet.id, { kind: "save", month: "9999-12", categoryId: f.category.id, version: 0, amount: "77" }, f.connection);
    const before = f.connection.sqlite.prepare("SELECT * FROM budgets").all();
    expect(() => f.setCycle(10, "2026-11-10", "long")).toThrow("outside the supported dates");
    expect(f.connection.sqlite.prepare("SELECT * FROM budgets").all()).toEqual(before);
    expect(readSheet(f.owner, f.sheet.id, f.connection).cycleVersion).toBe(1);
  });
  it("protects owner permission, cycle revisions, previewed budgets, and completed history", () => {
    const f = fixture();
    expect(() => f.setCycle(20, "2026-10-20", "short", 1, f.member)).toThrow("Only the sheet owner");
    expect(() => f.setCycle(20, "2026-10-20", "short", 1, f.other)).toThrow("unavailable");
    expect(() => f.setCycle(31, "2026-10-20")).toThrow("match");
    expect(() => f.setCycle(20, "2026-10-20", "long")).toThrow("completed");
    const input = { kind: "budgetCycle", startDay: 20, effectiveDate: "2026-10-20", transition: "short", version: 1 };
    const preview = mutateSettings(f.owner, f.sheet.id, { ...input, preview: true }, f.connection);
    mutateBudget(f.owner, f.sheet.id, { kind: "save", month: "2027-01", categoryId: f.category.id, version: 0, amount: "33" }, f.connection);
    expect(() => mutateSettings(f.owner, f.sheet.id, { ...input, previewToken: preview?.previewToken }, f.connection)).toThrow("affected limits changed");
    f.setCycle(20, "2026-10-20");
    expect(() => f.setCycle(31, "2026-12-31", "long", 1)).toThrow("Someone updated");
    expect(() => f.setCycle(25, "2026-10-25", "long", 2)).toThrow("scheduled transition");
    expect(() => mutateBudget(f.owner, f.sheet.id, { kind: "save", month: "2027-01-01", categoryId: f.category.id, cycleVersion: 1, version: 1, amount: "44" }, f.connection)).toThrow("cycle changed");
    const reopened = openDatabase(f.filename);
    try { expect(readSheet(f.owner, f.sheet.id, reopened).cycleHistory.revisions).toEqual([{ transitionFrom: "2026-10-01", recurringFrom: "2026-10-20", startDay: 20 }]); }
    finally { reopened.sqlite.close(); }
  });
});

describe("historical date-only partition", () => {
  it("covers leap years, same-month starts, multiple changes and both supported date limits", () => {
    const initial = { cycleStartDay: 31 };
    const changed = previewCycleChange(initial, { startDay: 10, effectiveDate: "2028-03-10", transition: "short" }, "2028-02-29").nextSheet;
    const twice = previewCycleChange(changed, { startDay: 31, effectiveDate: "2028-05-31", transition: "long" }, "2028-03-10").nextSheet;
    expect(periodContaining("2028-02-28", twice)).toMatchObject({ from: "2028-01-31", to: "2028-02-28" });
    expect(periodContaining("2028-02-29", twice)).toMatchObject({ from: "2028-02-29", to: "2028-03-09" });
    expect(periodContaining("2028-03-10", twice)).toMatchObject({ from: "2028-03-10", to: "2028-04-09" });
    expect(periodContaining("2028-04-10", twice)).toMatchObject({ from: "2028-04-10", to: "2028-05-30" });
    const long = previewCycleChange({ cycleStartDay: 8 }, { startDay: 1, effectiveDate: "2028-06-01", transition: "long" }, "2028-04-08").nextSheet;
    expect(resolvePeriod("2028-05", long)).toMatchObject({ from: "2028-04-08", to: "2028-05-31" });
    expect(periodContaining("0001-01-01", initial)).toMatchObject({ from: "0001-01-01", to: "0001-01-30" });
    expect(periodContaining("0001-01-31", initial).from).toBe("0001-01-31");
    expect(periodContaining("9999-12-31", twice)).toMatchObject({ from: "9999-12-31", to: "9999-12-31" });
    let previous = resolvePeriod("2028-01", twice);
    while (previous.to < "2029-02-01") { const next = resolvePeriod(adjacentPeriod(previous.from, 1, twice), twice); const expected = new Date(`${previous.to}T12:00:00Z`); expected.setUTCDate(expected.getUTCDate() + 1); expect(next.from).toBe(expected.toISOString().slice(0,10)); previous = next; }
    for (const timezone of ["UTC", "America/New_York", "Pacific/Auckland"]) { const prior = process.env.TZ; process.env.TZ = timezone; expect(periodContaining("2028-03-10", twice).from).toBe("2028-03-10"); expect(currentPeriod(twice, new Date("2028-03-10T00:30:00Z"))).toBe("2028-03-10"); process.env.TZ = prior; }
  });
});
