import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { openDatabase } from "../db/client";
import { migrateDatabase } from "../db/migrate";
import { paymentPlans, planContributions, sheetMembers, user } from "../db/schema";
import { createSheet, readSheet } from "../sheets/service";
import { mutateSettings } from "../sheets/settings";
import { deleteTransaction, saveTransaction } from "../ledger/service";
import { mutateBudget, readBudgets } from "../budgets/service";
import { readOverview } from "../overview/service";
import { currentPeriod } from "../sheets/cycle";
import { mutatePlan, readPlans } from "./service";
import { contributionSchedule, nextOccurrence } from "./schedule";
import { z } from "zod";
import { createSnapshot, restoreSnapshot, validateSnapshot } from "../operations/snapshots";
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-16T12:00:00Z")); });
afterEach(() => vi.useRealTimers());
const resources: { connection: ReturnType<typeof openDatabase>; directory: string }[] = [];
afterEach(() => { for (const { connection, directory } of resources.splice(0)) { connection.sqlite.close(); fs.rmSync(directory, { recursive: true, force: true }); } });
function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "homebooks-plans-")); const filename = path.join(directory, "plans.sqlite"); migrateDatabase(filename);
  const connection = openDatabase(filename); resources.push({ connection, directory });
  const owner = randomUUID(); const member = randomUUID(); const outsider = randomUUID();
  for (const id of [owner, member, outsider]) connection.db.insert(user).values({ id, name: id, email: `${id}@example.test`, createdAt: new Date(), updatedAt: new Date() }).run();
  const sheet = createSheet(owner, { name: "Planning", currency: "USD" }, connection).sheet;
  connection.db.insert(sheetMembers).values({ sheetId: sheet.id, userId: member, acceptedAt: new Date() }).run();
  mutateSettings(owner, sheet.id, { kind: "create", entity: "account", name: "Checking", sourceType: "bank" }, connection);
  for (const name of ["Insurance", "Other"]) mutateSettings(owner, sheet.id, { kind: "create", entity: "category", name }, connection);
  const full = readSheet(owner, sheet.id, connection); const category = full.categories.find(row => row.name === "Insurance"); const other = full.categories.find(row => row.name === "Other"); const account = full.accounts[0]; const group = full.buckets[0];
  if (!category || !other || !account || !group) throw new Error("Missing planning fixture.");
  const guards = () => { const current = readSheet(owner, sheet.id, connection); return { requestId: randomUUID(), cycleVersion: current.cycleVersion, currentPeriod: currentPeriod(current) }; };
  const create = (amount = "600", dueDate = "2027-03-31", recurrence = 6, actor = owner) => mutatePlan(actor, sheet.id, { ...guards(), kind: "create", name: "Insurance", amount, dueDate, recurrence, categoryId: category.id }, connection).id;
  const plan = (id: string) => { const record = readPlans(owner, sheet.id, connection).plans.find(row => row.id === id); if (!record) throw new Error("Missing plan."); return record; };
  const action = (id: string, kind: string, extra: object = {}, actor = owner) => mutatePlan(actor, sheet.id, { ...guards(), kind, id, version: plan(id).version, ...extra }, connection);
  const expense = (amount = "-600", date = "2026-10-16", categoryId = category.id) => saveTransaction(owner, sheet.id, { accountId: account.id, kind: "expense", payee: "Insurance payment", amount, date, splits: [{ categoryId, bucketId: group.id, amount }] }, undefined, connection);
  const budget = (month = currentPeriod(readSheet(owner, sheet.id, connection))) => readBudgets(owner, sheet.id, month, connection);
  const row = (month?: string) => budget(month).rows.find(value => value.categoryId === category.id);
  return { owner, member, outsider, sheet, connection, category, other, account, group, guards, create, plan, action, expense, budget, row };
}
describe("upcoming payment planning", () => {
  it("distributes six and twelve periods exactly, includes due boundaries and late starts", () => {
    expect(contributionSchedule({ expected: 60000, completed: 0, startDate: "2026-10-16", dueDate: "2027-03-31", sheet: {} }).map(row => row.amount)).toEqual([10000, 10000, 10000, 10000, 10000, 10000]);
    expect(contributionSchedule({ expected: 39500, completed: 0, startDate: "2026-10-16", dueDate: "2027-09-01", sheet: {} }).map(row => row.amount)).toEqual([3292, 3292, 3292, 3292, 3292, 3292, 3292, 3292, 3291, 3291, 3291, 3291]);
    expect(contributionSchedule({ expected: 60000, completed: 0, startDate: "2027-02-20", dueDate: "2027-03-01", sheet: {} }).map(row => row.amount)).toEqual([30000, 30000]);
    expect(contributionSchedule({ expected: 5, completed: 0, startDate: "2026-10-16", dueDate: "2026-12-08", sheet: { cycleStartDay: 8 } }).map(row => [row.from, row.amount])).toEqual([["2026-10-08", 2], ["2026-11-08", 2], ["2026-12-08", 1]]);
    expect(contributionSchedule({ expected: Number.MAX_SAFE_INTEGER, completed: 0, startDate: "2026-10-16", dueDate: "2026-11-01", sheet: {} }).map(row => row.amount)).toEqual([4503599627370496, 4503599627370495]);
  });
  it("retains recorded spending, reconciles early overpayment once and retries idempotently", () => {
    const f = fixture(); const id = f.create();
    mutateBudget(f.owner, f.sheet.id, { kind: "save", month: "2026-10-01", categoryId: f.category.id, amount: "1000", version: 0 }, f.connection);
    expect(f.row()).toMatchObject({ spent: 0, planned: 10000, budgetUsed: 10000, remaining: 90000 });
    const expense = f.expense("-650"); const request = { ...f.guards(), kind: "match", id, version: 1, transactionId: expense.id, sourceVersion: expense.version };
    mutatePlan(f.member, f.sheet.id, request, f.connection); mutatePlan(f.member, f.sheet.id, request, f.connection);
    expect(f.row()).toMatchObject({ spent: 65000, planned: 10000, reconciliation: 55000, matched: 65000, budgetUsed: 65000, remaining: 35000 });
    expect(f.plan(id).contributions).toEqual([{ from: "2026-10-01", to: "2026-10-31", amount: 10000 }]);
    expect(f.plan(id).adjustments).toHaveLength(1);
    expect(f.budget("2026-11-01").rows.find(row => row.categoryId === f.category.id)).toMatchObject({ planned: 0, spent: 0, budgetUsed: 0 });
    expect(readOverview(f.owner, f.sheet.id, "2026-10-01", f.connection)).toMatchObject({ total: 65000, budgetedSpent: 65000, budgetedUsed: 65000, remaining: 35000 });
    expect(() => mutatePlan(f.owner, f.sheet.id, { ...request, sourceVersion: 2 }, f.connection)).toThrow("already used");
  });
  it("retains completed contributions for a late underpayment and creates recurrence only explicitly", () => {
    const f = fixture(); const id = f.create("600", "2027-03-01", 6); const original = f.plan(id).contributions;
    vi.setSystemTime(new Date("2027-04-12T12:00:00Z"));
    expect(f.plan(id)).toMatchObject({ status: "active", overdue: true });
    const expense = f.expense("-550", "2027-04-12"); f.action(id, "match", { transactionId: expense.id, sourceVersion: 1 });
    expect(f.plan(id).contributions).toEqual(original);
    expect(f.row()).toMatchObject({ spent: 55000, planned: 0, reconciliation: -5000, matched: 55000, budgetUsed: -5000 });
    expect(f.plan(id).nextDueDate).toBe("2027-09-01");
    expect(readPlans(f.owner, f.sheet.id, f.connection).plans).toHaveLength(1);
    f.action(id, "next", { name: "Next insurance", amount: "600", dueDate: "2027-09-01", recurrence: 6, categoryId: f.category.id });
    expect(readPlans(f.owner, f.sheet.id, f.connection).plans).toHaveLength(2);
    expect(() => f.action(id, "next", { name: "Duplicate", amount: "600", dueDate: "2027-09-01", recurrence: 6, categoryId: f.category.id })).toThrow("Reload this fulfilled");
  });
  it("edits only unfinished periods, rejects lower historical targets and releases cancellation now", () => {
    const f = fixture(); const id = f.create(); vi.setSystemTime(new Date("2026-12-12T12:00:00Z"));
    const earlier = f.plan(id).contributions.slice(0, 2);
    f.action(id, "edit", { name: "Changed", amount: "800", dueDate: "2027-03-31", recurrence: 6, categoryId: f.category.id });
    expect(f.plan(id).contributions.map(row => row.amount)).toEqual([10000, 10000, 15000, 15000, 15000, 15000]);
    expect(() => f.action(id, "edit", { name: "Too low", amount: "100", dueDate: "2027-03-31", recurrence: 6, categoryId: f.category.id })).toThrow("below completed");
    expect(() => f.action(id, "edit", { name: "Other", amount: "800", dueDate: "2027-03-31", recurrence: 6, categoryId: f.other.id })).toThrow("Keep the category");
    f.action(id, "cancel"); expect(f.plan(id).contributions).toEqual(earlier);
    expect(f.row()).toMatchObject({ planned: 0, reconciliation: -20000, budgetUsed: -20000 });
    expect(f.row("2026-10-01")).toMatchObject({ planned: 10000, budgetUsed: 10000 });
  });
  it("handles changed, reallocated, refunded and deleted sources with explicit release and rematching", () => {
    const f = fixture(); const first = f.create(); const second = f.create(); const expense = f.expense();
    f.action(first, "match", { transactionId: expense.id, sourceVersion: 1 });
    expect(() => f.action(second, "match", { transactionId: expense.id, sourceVersion: 1 })).toThrow("already fulfills");
    saveTransaction(f.owner, f.sheet.id, { accountId: f.account.id, kind: "expense", payee: "Changed", amount: "-700", date: "2026-10-16", version: 1, splits: [{ categoryId: f.other.id, bucketId: f.group.id, amount: "-700" }] }, { id: expense.id }, f.connection);
    expect(f.plan(first)).toMatchObject({ needsReview: true, currentSourceVersion: 2 });
    expect(f.row()).toMatchObject({ spent: 0, budgetUsed: 70000 }); // agreed 600 plus second plan 100
    expect(f.budget().rows.find(row => row.categoryId === f.other.id)).toMatchObject({ spent: 70000, matched: 70000, budgetUsed: 0 });
    expect(() => f.action(first, "release", { sourceVersion: 1 })).toThrow("changed again");
    f.action(first, "release", { sourceVersion: 2 });
    expect(f.row()).toMatchObject({ budgetUsed: 10000 });
    expect(f.budget().rows.find(row => row.categoryId === f.other.id)).toMatchObject({ spent: 70000, matched: 0, budgetUsed: 70000 });
    saveTransaction(f.owner, f.sheet.id, { accountId: f.account.id, kind: "expense", payee: "Corrected", amount: "-700", date: "2026-10-16", version: 2, splits: [{ categoryId: f.category.id, bucketId: f.group.id, amount: "-700" }] }, { id: expense.id }, f.connection);
    f.action(second, "match", { transactionId: expense.id, sourceVersion: 3 });
    expect(f.row()).toMatchObject({ spent: 70000, budgetUsed: 70000 });
    deleteTransaction(f.owner, f.sheet.id, expense.id, { version: 3 }, f.connection);
    expect(f.plan(second).needsReview).toBe(true); expect(f.row()).toMatchObject({ spent: 0, matched: 0, budgetUsed: 70000 });
    f.action(second, "release", { sourceVersion: 4 }); expect(f.row()).toMatchObject({ spent: 0, matched: 0, budgetUsed: 0 });
  });
  it("rejects pre-plan, historical, mixed-category and stale sources and unauthorized mutations atomically", () => {
    const f = fixture(); const old = f.expense(); vi.setSystemTime(new Date("2026-10-16T13:00:00Z")); const id = f.create();
    expect(() => f.action(id, "match", { transactionId: old.id, sourceVersion: 1 })).toThrow("after this plan");
    const historical = f.expense("-600", "2026-09-20"); expect(() => f.action(id, "match", { transactionId: historical.id, sourceVersion: 1 })).toThrow("current period");
    const live = f.expense(); expect(() => f.action(id, "match", { transactionId: live.id, sourceVersion: 2 })).toThrow("payment changed");
    expect(() => f.action(id, "skip", {}, f.outsider)).toThrow();
    expect(() => mutatePlan(f.owner, f.sheet.id, { ...f.guards(), kind: "cancel", id, version: 1, cycleVersion: 99 }, f.connection)).toThrow("cycle changed");
    expect(() => mutatePlan(f.owner, f.sheet.id, { ...f.guards(), kind: "cancel", id, version: 99 }, f.connection)).toThrow("Someone changed");
    expect(f.plan(id)).toMatchObject({ version: 1, status: "active" }); expect(f.plan(id).contributions).toHaveLength(6);
    f.action(id, "skip", {}, f.member); expect(f.plan(id).status).toBe("skipped");
  });
  it("previews and applies shared cycle transitions with plan conflicts and completed history intact", () => {
    const f = fixture(); const id = f.create(); vi.setSystemTime(new Date("2026-11-16T12:00:00Z"));
    const input = { kind: "budgetCycle", startDay: 20, effectiveDate: "2026-11-20", transition: "short", version: 1, preview: true };
    const preview = mutateSettings(f.owner, f.sheet.id, input, f.connection);
    if (!preview) throw new Error("Missing preview.");
    expect(preview.paymentPlans[0]).toMatchObject({ completed: 10000 });
    expect(preview.paymentPlans[0]?.newSchedule.map(row => row.from)).toEqual(["2026-11-01", "2026-11-20", "2026-12-20", "2027-01-20", "2027-02-20", "2027-03-20"]);
    f.action(id, "edit", { name: "Updated", amount: "600", dueDate: "2027-03-31", recurrence: 6, categoryId: f.category.id });
    expect(() => mutateSettings(f.owner, f.sheet.id, { ...input, preview: false, previewToken: preview.previewToken }, f.connection)).toThrow("changed");
    const latest = mutateSettings(f.owner, f.sheet.id, input, f.connection); if (!latest) throw new Error("Missing preview.");
    mutateSettings(f.owner, f.sheet.id, { ...input, preview: false, previewToken: latest.previewToken }, f.connection);
    expect(f.plan(id).contributions[0]).toEqual({ from: "2026-10-01", to: "2026-10-31", amount: 10000 });
    expect(f.plan(id).contributions.map(row => row.amount)).toEqual([10000, 8334, 8334, 8333, 8333, 8333, 8333]);
    expect(f.row("2026-10-01")).toMatchObject({ planned: 10000, budgetUsed: 10000 });
    expect(f.connection.db.select().from(paymentPlans).where(eq(paymentPlans.id, id)).get()?.version).toBe(3);
    expect(f.connection.db.select().from(planContributions).where(eq(planContributions.planId, id)).all()).toHaveLength(7);
  });
  it("preserves recurrence anchor across clamping and skips past proposals visibly", () => {
    expect(nextOccurrence("2028-02-29", 12, 29, "2028-02-29")).toEqual({ date: "2029-02-28", skipped: 0 });
    expect(nextOccurrence("2029-02-28", 12, 29, "2032-01-01")).toEqual({ date: "2032-02-29", skipped: 2 });
    expect(nextOccurrence("2026-01-31", 1, 31, "2026-03-01")).toEqual({ date: "2026-03-31", skipped: 1 });
  });
  it("keeps ordinary refunds separate and flags a matched source converted to refund", () => {
    const f = fixture(); const id = f.create(); const expense = f.expense(); f.action(id, "match", { transactionId: expense.id, sourceVersion: 1 });
    saveTransaction(f.owner, f.sheet.id, { accountId: f.account.id, kind: "refund", payee: "Separate refund", amount: "100", date: "2026-10-16", splits: [{ categoryId: f.category.id, bucketId: f.group.id, amount: "100" }] }, undefined, f.connection);
    expect(f.plan(id).needsReview).toBe(false); expect(f.row()).toMatchObject({ spent: 50000, matched: 60000, budgetUsed: 50000 });
    saveTransaction(f.owner, f.sheet.id, { accountId: f.account.id, kind: "refund", payee: "Converted source", amount: "600", date: "2026-10-16", version: 1, splits: [{ categoryId: f.category.id, bucketId: f.group.id, amount: "600" }] }, { id: expense.id }, f.connection);
    expect(f.plan(id).needsReview).toBe(true); expect(f.row()).toMatchObject({ spent: -70000, matched: 0, budgetUsed: -10000 });
    f.action(id, "release", { sourceVersion: 2 }); expect(f.row()).toMatchObject({ spent: -70000, budgetUsed: -70000 });
  });
  it("rejects a mixed-category whole expense without changing contributions", () => {
    const f = fixture(); const id = f.create();
    const record = saveTransaction(f.owner, f.sheet.id, { accountId: f.account.id, kind: "expense", payee: "Mixed", amount: "-600", date: "2026-10-16", splits: [{ categoryId: f.category.id, bucketId: f.group.id, amount: "-500" }, { categoryId: f.other.id, bucketId: f.group.id, amount: "-100" }] }, undefined, f.connection);
    expect(() => f.action(id, "match", { transactionId: record.id, sourceVersion: 1 })).toThrow("every split");
    expect(f.plan(id).contributions).toHaveLength(6); expect(f.plan(id).status).toBe("active");
  });
  it("upgrades populated pre0015 records unchanged and restores legacy and plan snapshots", async () => {
    const f = fixture(); f.expense("-25");
    mutateBudget(f.owner, f.sheet.id, { kind: "save", month: "2026-10-01", categoryId: f.category.id, amount: "1000", version: 0 }, f.connection);
    const directory = resources[resources.length - 1]?.directory; if (!directory) throw new Error("Missing directory.");
    const prefix = path.join(directory, "prefix15"); fs.cpSync("drizzle", prefix, { recursive: true });
    const journalFile = path.join(prefix, "meta/_journal.json"); const journal = JSON.parse(fs.readFileSync(journalFile, "utf8"));
    journal.entries = journal.entries.filter((entry: { idx: number }) => entry.idx < 15); fs.writeFileSync(journalFile, JSON.stringify(journal));
    const filename = path.join(directory, "pre15.sqlite"); migrateDatabase(filename, prefix);
    const legacy = openDatabase(filename); const before = new Map<string, unknown>();
    try {
      legacy.sqlite.prepare("ATTACH DATABASE ? AS original").run(path.join(directory, "plans.sqlite"));
      const tables = z.array(z.object({ name: z.string() })).parse(legacy.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%'").all());
      legacy.sqlite.transaction(() => {
        legacy.sqlite.pragma("defer_foreign_keys = ON");
        for (const { name } of tables) { legacy.sqlite.exec(`INSERT INTO main."${name}" SELECT * FROM original."${name}"`); before.set(name, legacy.sqlite.prepare(`SELECT * FROM "${name}"`).all()); }
      })(); legacy.sqlite.exec("DETACH DATABASE original");
    } finally { legacy.sqlite.close(); }
    const options = { filename, backupDirectory: path.join(directory, "backups15") };
    const oldSnapshot = await createSnapshot(options); expect(validateSnapshot(oldSnapshot).manifest.migrations).toHaveLength(15);
    migrateDatabase(filename); migrateDatabase(filename);
    const upgraded = openDatabase(filename); let expectedPlans: unknown; let expectedReport: unknown;
    try {
      for (const [name, rows] of before) expect(upgraded.sqlite.prepare(`SELECT * FROM "${name}"`).all()).toEqual(rows);
      expect(readBudgets(f.owner, f.sheet.id, "2026-10-01", upgraded)).toEqual(f.budget());
      const created = mutatePlan(f.owner, f.sheet.id, { ...f.guards(), kind: "create", name: "Annual fee", amount: "395", dueDate: "2027-09-01", recurrence: 12, categoryId: f.category.id }, upgraded);
      const expense = saveTransaction(f.owner, f.sheet.id, { accountId: f.account.id, date: "2026-10-16", payee: "Fee", kind: "expense", amount: "-390", splits: [{ categoryId: f.category.id, bucketId: f.group.id, amount: "-390" }] }, undefined, upgraded);
      mutatePlan(f.owner, f.sheet.id, { ...f.guards(), kind: "match", id: created.id, version: 1, transactionId: expense.id, sourceVersion: 1 }, upgraded);
      expectedPlans = readPlans(f.owner, f.sheet.id, upgraded); expectedReport = readBudgets(f.owner, f.sheet.id, "2026-10-01", upgraded);
    } finally { upgraded.sqlite.close(); }
    const newSnapshot = await createSnapshot(options); expect(validateSnapshot(newSnapshot).manifest.migrations).toHaveLength(16);
    const restoredFile = path.join(directory, "restored15.sqlite"); const restoreOptions = { filename: restoredFile, backupDirectory: path.join(directory, "restore-backups15") };
    await restoreSnapshot(newSnapshot, restoreOptions); let restored = openDatabase(restoredFile);
    try { expect(readPlans(f.owner, f.sheet.id, restored)).toEqual(expectedPlans); expect(readBudgets(f.owner, f.sheet.id, "2026-10-01", restored)).toEqual(expectedReport); } finally { restored.sqlite.close(); }
    await restoreSnapshot(oldSnapshot, restoreOptions); migrateDatabase(restoredFile); restored = openDatabase(restoredFile);
    try { for (const [name, rows] of before) expect(restored.sqlite.prepare(`SELECT * FROM "${name}"`).all()).toEqual(rows); expect(readPlans(f.owner, f.sheet.id, restored).plans).toEqual([]); } finally { restored.sqlite.close(); }
  });
});

