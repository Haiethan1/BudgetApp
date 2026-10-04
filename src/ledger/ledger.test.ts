import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { afterEach, describe, expect, it } from "vitest";
import { createAuth } from "../auth/server";
import { initializeInstance } from "../auth/setup";
import { type AuthConfig } from "../auth/config";
import { openDatabase } from "../db/client";
import { migrateDatabase } from "../db/migrate";
import { sheetMembers, splits, transactionSources, transactions, user } from "../db/schema";
import { handleLedgerRequest } from "./http";
import { mutateSettings } from "../sheets/settings";
import { createSheet, readSheet } from "../sheets/service";
import { calculateSpending, deleteTransaction, listTransactions, readTransaction, saveTransaction } from "./service";
import { dateSchema, parseMoney } from "./input";

const config: AuthConfig = { origin: "http://localhost:3000", secret: "sheet-test-secret-with-thirty-two-characters",
  setupToken: "sheet-test-token-with-thirty-two-characters", registrationEnabled: true };
const connections: ReturnType<typeof openDatabase>[] = [];
const directories: string[] = [];
afterEach(() => { for (const connection of connections.splice(0)) connection.sqlite.close();
  for (const directory of directories.splice(0)) fs.rmSync(directory, { force: true, recursive: true }); });
let ip = 100;
async function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "homebooks-sheets-")); directories.push(directory);
  const filename = path.join(directory, "sheets.sqlite"); migrateDatabase(filename);
  const connection = openDatabase(filename); connections.push(connection);
  const adminIdentity = { name: "Admin", username: "admin", email: "admin@example.test", password: "test-long-password" };
  await initializeInstance({ ...adminIdentity, setupToken: config.setupToken }, config, connection);
  const auth = createAuth(connection, config);
  async function login(username: string) {
    const identity = { name: username, username, email: `${username}@example.test`, password: "test-long-password" };
    const headers = { origin: config.origin, "content-type": "application/json", "x-forwarded-for": `198.51.100.${++ip}` };
    if (username !== "admin") expect((await auth.handler(new Request(`${config.origin}/api/auth/sign-up/email`, {
      method: "POST", headers, body: JSON.stringify(identity) }))).status).toBe(200);
    const response = await auth.handler(new Request(`${config.origin}/api/auth/sign-in/username`, {
      method: "POST", headers, body: JSON.stringify({ username, password: identity.password }) }));
    expect(response.status).toBe(200);
    const cookie = response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
    const found = connection.db.select().from(user).where(eq(user.username, username)).get();
    if (!found) throw new Error("Test login did not create a user.");
    return { id: found.id, cookie };
  }
  const [admin, alice, bob] = await Promise.all([login("admin"), login("alice"), login("bob")]);
  return { connection, auth, admin, alice, bob, dependencies: { connection, auth, origin: config.origin } };
}
function request(cookie?: string, body?: unknown, origin = config.origin) {
  return new Request(`${config.origin}/api/sheets`, { method: body ? "POST" : "GET",
    headers: { origin, "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}) });
}


function organization(connection: ReturnType<typeof openDatabase>, userId: string, currency = "USD") {
  const sheet = createSheet(userId, { name: "Ledger", currency }, connection).sheet;
  mutateSettings(userId, sheet.id, { kind: "create", entity: "account", name: "Visa", sourceType: "credit_card" }, connection);
  mutateSettings(userId, sheet.id, { kind: "create", entity: "category", name: "Groceries" }, connection);
  mutateSettings(userId, sheet.id, { kind: "create", entity: "bucket", name: "Ethan" }, connection);
  mutateSettings(userId, sheet.id, { kind: "create", entity: "bucket", name: "Parents" }, connection);
  const records = readSheet(userId, sheet.id, connection);
  const account = records.accounts[0]; const category = records.categories.find((row) => row.name === "Groceries");
  const ethan = records.buckets.find((row) => row.name === "Ethan"); const parents = records.buckets.find((row) => row.name === "Parents");
  const uncategorized = records.categories.find((row) => row.isProtected); const unassigned = records.buckets.find((row) => row.isProtected);
  if (!account || !category || !ethan || !parents || !uncategorized || !unassigned) throw new Error("Missing test organization");
  const expense = { accountId: account.id, date: "2026-10-04", payee: "Market", kind: "expense", amount: "-100.00", splits: [{ categoryId: category.id, bucketId: ethan.id, amount: "-60.00" }, { categoryId: category.id, bucketId: parents.id, amount: "-40.00" }] };
  return { sheet, account, category, ethan, parents, uncategorized, unassigned, expense };
}
describe("exact money and dates", () => {
  it("parses decimal digits exactly using the sheet precision and rejects invalid/unsafe/zero input", () => {
    expect(parseMoney("-100.01", "USD")).toBe(-10001);
    expect(parseMoney("90071992547409.91", "USD")).toBe(Number.MAX_SAFE_INTEGER);
    expect(parseMoney("120", "JPY")).toBe(120);
    expect(parseMoney("1.234", "KWD")).toBe(1234);
    for (const input of ["0", "-0.00", "1.001", "90071992547409.92", "1e3", "1,000", " 1", "NaN", "+1", ".01", "1."]) expect(() => parseMoney(input, "USD")).toThrow();
    expect(() => parseMoney("1.1", "JPY")).toThrow();
    for (const date of ["2024-02-29", "2000-02-29", "2026-10-03"]) expect(dateSchema.safeParse(date).success).toBe(true);
    for (const date of ["2026-02-29", "1900-02-29", "2026-04-31", "2026-00-01", "0000-01-01", "2026-1-01", "2026-10-03T00:00:00Z"]) expect(dateSchema.safeParse(date).success).toBe(false);
  });
});
describe("atomic ledger and spending", () => {
  it("produces literal split/refund totals, excludes income/payments, and assigns refunds to their effective month", async () => {
    const { connection, alice } = await fixture(); const org = organization(connection, alice.id);
    saveTransaction(alice.id, org.sheet.id, org.expense, undefined, connection);
    saveTransaction(alice.id, org.sheet.id, { ...org.expense, kind: "refund", amount: "20.00", splits: [{ categoryId: org.category.id, bucketId: org.ethan.id, amount: "20.00" }] }, undefined, connection);
    for (const [kind, amount] of [["income", "2000.00"], ["transfer", "-100.00"], ["transfer", "100.00"]]) saveTransaction(alice.id, org.sheet.id, { ...org.expense, kind, amount, splits: [{ categoryId: org.uncategorized.id, bucketId: org.unassigned.id, amount }] }, undefined, connection);
    expect(calculateSpending(alice.id, org.sheet.id, "2026-10", connection)).toEqual({ month: "2026-10", total: 8000, uncategorized: 0, categories: { [org.category.id]: 8000 }, buckets: { [org.ethan.id]: 4000, [org.parents.id]: 4000 } });
    saveTransaction(alice.id, org.sheet.id, { ...org.expense, date: "2026-11-01", kind: "refund", amount: "120.00", splits: [{ categoryId: org.category.id, bucketId: org.ethan.id, amount: "120.00" }] }, undefined, connection);
    expect(calculateSpending(alice.id, org.sheet.id, "2026-10", connection).total).toBe(8000);
    expect(calculateSpending(alice.id, org.sheet.id, "2026-11", connection).total).toBe(-12000);
  });
  it("reproduces fixture totals and excludes deleted transactions", async () => {
    const { connection, alice } = await fixture(); const org = organization(connection, alice.id);
    saveTransaction(alice.id, org.sheet.id, org.expense, undefined, connection);
    saveTransaction(alice.id, org.sheet.id, { ...org.expense, kind: "refund", amount: "20", splits: [{ categoryId: org.category.id, bucketId: org.ethan.id, amount: "20" }] }, undefined, connection);
    saveTransaction(alice.id, org.sheet.id, { ...org.expense, amount: "-120", splits: [{ categoryId: org.category.id, bucketId: org.ethan.id, amount: "-70" }, { categoryId: org.category.id, bucketId: org.parents.id, amount: "-50" }] }, undefined, connection);
    for (const amount of ["-24.50", "-35"]) saveTransaction(alice.id, org.sheet.id, { ...org.expense, amount, splits: [{ categoryId: org.category.id, bucketId: org.ethan.id, amount }] }, undefined, connection);
    const uncategorized = saveTransaction(alice.id, org.sheet.id, { ...org.expense, amount: "-18.50", splits: [{ categoryId: org.uncategorized.id, bucketId: org.unassigned.id, amount: "-18.50" }] }, undefined, connection);
    const totals = calculateSpending(alice.id, org.sheet.id, "2026-10", connection);
    expect(totals.total).toBe(27800); expect(totals.uncategorized).toBe(1850);
    expect(totals.buckets).toEqual({ [org.ethan.id]: 16950, [org.parents.id]: 9000, [org.unassigned.id]: 1850 });
    deleteTransaction(alice.id, org.sheet.id, uncategorized.id, { version: 1 }, connection);
    expect(calculateSpending(alice.id, org.sheet.id, "2026-10", connection).total).toBe(25950);
    expect(listTransactions(alice.id, org.sheet.id, {}, connection).total).toBe(5);
    expect(connection.db.select().from(transactions).where(eq(transactions.id, uncategorized.id)).get()?.deletedAt).toBeInstanceOf(Date);
  });
  it("rejects bad sums, signs, dates and cross-sheet references and rolls back a partial split write", async () => {
    const { connection, alice } = await fixture(); const org = organization(connection, alice.id); const foreign = organization(connection, alice.id);
    const bad = [ { ...org.expense, amount: "100" }, { ...org.expense, kind: "refund" }, { ...org.expense, kind: "income" }, { ...org.expense, splits: [] }, { ...org.expense, splits: [{ ...org.expense.splits[0], amount: "-99" }] }, { ...org.expense, splits: [{ ...org.expense.splits[0], amount: "40" }, org.expense.splits[1]] }, { ...org.expense, date: "2026-02-30" }, { ...org.expense, accountId: foreign.account.id }, { ...org.expense, splits: [{ ...org.expense.splits[0], categoryId: foreign.category.id }, org.expense.splits[1]] }, { ...org.expense, splits: [{ ...org.expense.splits[0], bucketId: foreign.ethan.id }, org.expense.splits[1]] } ];
    for (const input of bad) expect(() => saveTransaction(alice.id, org.sheet.id, input, undefined, connection)).toThrow();
    expect(connection.db.select().from(transactions).all()).toEqual([]);
    connection.sqlite.exec("CREATE TRIGGER fail_second_split BEFORE INSERT ON splits WHEN NEW.position = 1 BEGIN SELECT RAISE(ABORT, 'split write failed'); END");
    expect(() => saveTransaction(alice.id, org.sheet.id, org.expense, undefined, connection)).toThrow("split write failed");
    expect(connection.db.select().from(transactions).all()).toEqual([]); expect(connection.db.select().from(splits).all()).toEqual([]);
    connection.sqlite.exec("DROP TRIGGER fail_second_split");
    const record = saveTransaction(alice.id, org.sheet.id, org.expense, undefined, connection);
    connection.sqlite.exec("CREATE TRIGGER fail_update_split BEFORE INSERT ON splits BEGIN SELECT RAISE(ABORT, 'edit split failed'); END");
    expect(() => saveTransaction(alice.id, org.sheet.id, { ...org.expense, payee: "Changed", version: 1 }, { id: record.id }, connection)).toThrow();
    expect(readTransaction(alice.id, org.sheet.id, record.id, connection)).toMatchObject({ payee: "Market", version: 1, amount: -10000 });
    expect(readTransaction(alice.id, org.sheet.id, record.id, connection).splits.map((row) => row.amount)).toEqual([-6000, -4000]);
  });
  it("preserves unchanged archived history on edits but rejects new/changed archived allocations", async () => {
    const { connection, alice } = await fixture(); const org = organization(connection, alice.id);
    const record = saveTransaction(alice.id, org.sheet.id, org.expense, undefined, connection);
    for (const [entity, id] of [["account", org.account.id], ["category", org.category.id], ["bucket", org.ethan.id]]) mutateSettings(alice.id, org.sheet.id, { kind: "archive", entity, id }, connection);
    expect(() => saveTransaction(alice.id, org.sheet.id, org.expense, undefined, connection)).toThrow("active account");
    const updated = saveTransaction(alice.id, org.sheet.id, { ...org.expense, version: 1, payee: "Edited payee" }, { id: record.id }, connection);
    expect(updated).toMatchObject({ version: 2, accountArchived: true }); expect(updated.splits[0]?.categoryArchived).toBe(true);
    expect(() => saveTransaction(alice.id, org.sheet.id, { ...org.expense, version: 2, splits: [{ ...org.expense.splits[0], amount: "-50" }, { ...org.expense.splits[1], amount: "-50" }] }, { id: record.id }, connection)).toThrow("Archived allocations");
  });
  it("rejects stale concurrent edits/deletes and retains immutable imported identity across account/date/payee edits and deletion", async () => {
    const { connection, alice } = await fixture(); const org = organization(connection, alice.id);
    const record = saveTransaction(alice.id, org.sheet.id, org.expense, undefined, connection);
    const source = { id: randomUUID(), sheetId: org.sheet.id, transactionId: record.id, accountId: org.account.id, sourceProfile: "household-csv-v1", sourceId: "original-123", date: "2026-10-04", payee: "Original CSV payee", amount: -10000, fingerprint: "immutable-source-fingerprint", createdAt: new Date() };
    connection.db.insert(transactionSources).values(source).run();
    mutateSettings(alice.id, org.sheet.id, { kind: "create", entity: "account", name: "Checking", sourceType: "bank" }, connection);
    const changedAccount = readSheet(alice.id, org.sheet.id, connection).accounts.find((row) => row.name === "Checking");
    if (!changedAccount) throw new Error("Missing changed account");
    saveTransaction(alice.id, org.sheet.id, { ...org.expense, accountId: changedAccount.id, version: 1, payee: "Edited", date: "2026-10-05", sourceId: "client-forgery" }, { id: record.id }, connection);
    expect(() => saveTransaction(alice.id, org.sheet.id, { ...org.expense, version: 1, payee: "Stale" }, { id: record.id }, connection)).toThrow("Someone updated");
    expect(() => deleteTransaction(alice.id, org.sheet.id, record.id, { version: 1 }, connection)).toThrow("Someone updated");
    expect(() => connection.db.update(transactionSources).set({ payee: "Rewrite source" }).where(eq(transactionSources.id, source.id)).run()).toThrow("immutable");
    deleteTransaction(alice.id, org.sheet.id, record.id, { version: 2 }, connection);
    expect(connection.db.select().from(transactionSources).get()).toEqual(source);
    expect(connection.db.select().from(splits).where(eq(splits.transactionId, record.id)).all()).toHaveLength(2);
    expect(() => readTransaction(alice.id, org.sheet.id, record.id, connection)).toThrow("no longer available");
  });
  it("rejects aggregate overflow while keeping exact cancellations and safe limits", async () => {
    const { connection, alice } = await fixture(); const org = organization(connection, alice.id);
    const amount = "-90071992547409.91";
    saveTransaction(alice.id, org.sheet.id, { ...org.expense, amount, splits: [{ categoryId: org.category.id, bucketId: org.ethan.id, amount }] }, undefined, connection);
    expect(calculateSpending(alice.id, org.sheet.id, "2026-10", connection).total).toBe(Number.MAX_SAFE_INTEGER);
    saveTransaction(alice.id, org.sheet.id, { ...org.expense, amount: "-0.01", splits: [{ categoryId: org.category.id, bucketId: org.ethan.id, amount: "-0.01" }] }, undefined, connection);
    expect(() => calculateSpending(alice.id, org.sheet.id, "2026-10", connection)).toThrow("supported range");
    saveTransaction(alice.id, org.sheet.id, { ...org.expense, kind: "refund", amount: "0.01", splits: [{ categoryId: org.category.id, bucketId: org.ethan.id, amount: "0.01" }] }, undefined, connection);
    expect(calculateSpending(alice.id, org.sheet.id, "2026-10", connection).total).toBe(Number.MAX_SAFE_INTEGER);
  });
});
describe("ledger HTTP authorization, constraints, and filters", () => {
  it("uses real sessions, permits members, blocks outsiders/admins/revoked members and foreign-origin writes", async () => {
    const { connection, alice, bob, admin, dependencies } = await fixture(); const org = organization(connection, alice.id);
    const create = { kind: "create", sheetId: org.sheet.id } satisfies Parameters<typeof handleLedgerRequest>[1];
    expect((await handleLedgerRequest(request(undefined, org.expense), create, dependencies)).status).toBe(401);
    for (const cookie of [bob.cookie, admin.cookie]) expect((await handleLedgerRequest(request(cookie, org.expense), create, dependencies)).status).toBe(404);
    expect((await handleLedgerRequest(request(alice.cookie, org.expense, "https://foreign.test"), create, dependencies)).status).toBe(403);
    connection.db.insert(sheetMembers).values({ sheetId: org.sheet.id, userId: bob.id, acceptedAt: new Date() }).run();
    const created = await handleLedgerRequest(request(bob.cookie, org.expense), create, dependencies); expect(created.status).toBe(201);
    const record = z.object({ id: z.uuid(), version: z.number(), amount: z.number(), creatorId: z.string() }).parse(await created.json());
    expect(record).toMatchObject({ version: 1, amount: -10000, creatorId: bob.id });
    expect((await handleLedgerRequest(request(alice.cookie, { ...org.expense, version: 1, payee: "Owner edit" }), { kind: "edit", sheetId: org.sheet.id, id: record.id }, dependencies)).status).toBe(200);
    expect((await handleLedgerRequest(request(bob.cookie, { ...org.expense, version: 1 }), { kind: "edit", sheetId: org.sheet.id, id: record.id }, dependencies)).status).toBe(409);
    const foreign = organization(connection, alice.id);
    expect((await handleLedgerRequest(request(alice.cookie), { kind: "read", sheetId: foreign.sheet.id, id: record.id }, dependencies)).status).toBe(404);
    connection.db.delete(sheetMembers).where(eq(sheetMembers.userId, bob.id)).run();
    for (const kind of ["read", "edit", "delete"] satisfies ("read" | "edit" | "delete")[]) expect((await handleLedgerRequest(request(bob.cookie, kind === "read" ? undefined : { ...org.expense, version: 2 }), { kind, sheetId: org.sheet.id, id: record.id }, dependencies)).status).toBe(404);
    expect((await handleLedgerRequest(request(admin.cookie), { kind: "list", sheetId: org.sheet.id }, dependencies)).status).toBe(404);
    expect((await handleLedgerRequest(request(admin.cookie), { kind: "spending", sheetId: org.sheet.id, month: "2026-10" }, dependencies)).status).toBe(404);
    expect((await handleLedgerRequest(request(alice.cookie, { ...org.expense, amount: "0" }), create, dependencies)).status).toBe(400);
  });
  it("paginates 50 stable rows, searches literal payees, filters dates/kinds/accounts/allocations and hides tombstones", async () => {
    const { connection, alice } = await fixture(); const org = organization(connection, alice.id);
    const ids = [];
    for (let index = 0; index < 51; index++) ids.push(saveTransaction(alice.id, org.sheet.id, { ...org.expense, payee: index === 0 ? "100%_Market" : `Market ${index}`, date: index === 0 ? "2026-09-30" : "2026-10-04" }, undefined, connection).id);
    const page = listTransactions(alice.id, org.sheet.id, {}, connection); const next = listTransactions(alice.id, org.sheet.id, { page: 2 }, connection);
    expect(page.transactions).toHaveLength(50); expect(page.total).toBe(51); expect(next.transactions.map((row) => row.id)).toEqual([ids[0]]);
    expect(new Set([...page.transactions, ...next.transactions].map((row) => row.id)).size).toBe(51);
    expect(listTransactions(alice.id, org.sheet.id, { payee: "%_" }, connection).transactions.map((row) => row.id)).toEqual([ids[0]]);
    expect(listTransactions(alice.id, org.sheet.id, { from: "2026-10-01", to: "2026-10-31", kind: "expense", accountId: org.account.id, categoryId: org.category.id, bucketId: org.ethan.id }, connection).total).toBe(50);
    expect(listTransactions(alice.id, org.sheet.id, { kind: "income" }, connection).total).toBe(0);
    expect(() => listTransactions(alice.id, org.sheet.id, { from: "2026-11-01", to: "2026-10-01" }, connection)).toThrow();
    const first = page.transactions[0]; if (!first) throw new Error("Missing first page record");
    deleteTransaction(alice.id, org.sheet.id, first.id, { version: first.version }, connection);
    expect(listTransactions(alice.id, org.sheet.id, {}, connection).total).toBe(50);
  });
  it("enforces actual composite account/category/bucket references and signed safe-integer constraints in SQLite", async () => {
    const { connection, alice } = await fixture(); const org = organization(connection, alice.id); const foreign = organization(connection, alice.id);
    const values = { id: randomUUID(), sheetId: org.sheet.id, accountId: org.account.id, date: "2026-10-04", payee: "Direct", kind: "expense", amount: -100, creatorId: alice.id, createdAt: new Date(), updatedAt: new Date() } satisfies typeof transactions.$inferInsert;
    expect(() => connection.db.insert(transactions).values({ ...values, accountId: foreign.account.id }).run()).toThrow("FOREIGN KEY");
    for (const amount of [0, 1, -0.5, -9007199254740992]) expect(() => connection.db.insert(transactions).values({ ...values, amount }).run()).toThrow();
    connection.db.insert(transactions).values(values).run();
    const split = { id: randomUUID(), sheetId: org.sheet.id, transactionId: values.id, categoryId: org.category.id, bucketId: org.ethan.id, amount: -100, position: 0 };
    expect(() => connection.db.insert(splits).values({ ...split, categoryId: foreign.category.id }).run()).toThrow("FOREIGN KEY");
    expect(() => connection.db.insert(splits).values({ ...split, bucketId: foreign.ethan.id }).run()).toThrow("FOREIGN KEY");
    expect(() => connection.db.insert(splits).values({ ...split, sheetId: foreign.sheet.id }).run()).toThrow("FOREIGN KEY");
    connection.db.insert(splits).values(split).run();
    expect(connection.sqlite.pragma("foreign_key_check")).toEqual([]);
  });
});

