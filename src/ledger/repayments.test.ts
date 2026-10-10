import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { createAuth } from "../auth/server";
import { initializeInstance } from "../auth/setup";
import { type AuthConfig } from "../auth/config";
import { openDatabase } from "../db/client";
import { migrateDatabase } from "../db/migrate";
import { sheetMembers, transactions, user } from "../db/schema";
import { handleLedgerRequest } from "./http";
import { mutateSharing, respondToInvite } from "../sharing/service";
import { mutateSettings } from "../sheets/settings";
import { createSheet, readSheet } from "../sheets/service";
import { calculateSpending, deleteTransaction, saveTransaction } from "./service";
import { listOwed, saveRepayment, saveTracking } from "../repayments/service";

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

describe("all-time amount owed", () => {
  it("opts in buckets and sums exact split allocations across months, excluding refunds and deleted expenses", async () => {
    const { connection, alice } = await fixture(); const org = organization(connection, alice.id);
    const expense = saveTransaction(alice.id, org.sheet.id, { ...org.expense, date: "2023-01-01" }, undefined, connection);
    saveTransaction(alice.id, org.sheet.id, { ...org.expense, date: "2026-11-01" }, undefined, connection);
    const deleted = saveTransaction(alice.id, org.sheet.id, org.expense, undefined, connection);
    deleteTransaction(alice.id, org.sheet.id, deleted.id, { version: deleted.version }, connection);
    for (const kind of ["refund", "income", "transfer"]) saveTransaction(alice.id, org.sheet.id, { ...org.expense, kind, amount: "100.00", splits: [{ categoryId: org.category.id, bucketId: org.parents.id, amount: "100.00" }] }, undefined, connection);
    expect(listOwed(alice.id, org.sheet.id, {}, connection)).toMatchObject({ outstanding: 0, paid: 0, total: 0 });
    saveTracking(alice.id, org.sheet.id, { buckets: [{ id: org.parents.id, version: 1, tracked: true }] }, connection);
    expect(listOwed(alice.id, org.sheet.id, {}, connection)).toMatchObject({ outstanding: 8000, paid: 0, total: 2 });
    expect(listOwed(alice.id, org.sheet.id, {}, connection).transactions.find(({ id }) => id === expense.id)?.allocations).toEqual([{ bucketId: org.parents.id, bucketName: "Parents", amount: 4000 }]);
    const before = calculateSpending(alice.id, org.sheet.id, "2023-01", connection);
    const paid = saveRepayment(alice.id, org.sheet.id, expense.id, { version: 1, repaymentDate: "2026-10-10", comment: "Cash received" }, connection);
    expect(paid).toMatchObject({ repaymentDate: "2026-10-10", repaymentComment: "Cash received", version: 2 });
    expect(listOwed(alice.id, org.sheet.id, {}, connection)).toMatchObject({ outstanding: 4000, paid: 4000 });
    expect(listOwed(alice.id, org.sheet.id, { status: "paid" }, connection).total).toBe(1);
    expect(calculateSpending(alice.id, org.sheet.id, "2023-01", connection)).toEqual(before);
    expect(listOwed(alice.id, org.sheet.id, { bucket: "all" }, connection).transactions.find(({ id }) => id === expense.id)?.allocations).toHaveLength(2);
    const reopened = saveRepayment(alice.id, org.sheet.id, expense.id, { version: 2, repaymentDate: null, comment: "Reopened, still awaiting cash" }, connection);
    expect(reopened).toMatchObject({ repaymentDate: null, repaymentComment: "Reopened, still awaiting cash", version: 3 });
    expect(listOwed(alice.id, org.sheet.id, {}, connection)).toMatchObject({ outstanding: 8000, paid: 0 });
  });
  it("persists comments on paid and outstanding untracked expenses and preserves metadata during edits", async () => {
    const { connection, alice } = await fixture(); const org = organization(connection, alice.id);
    const expense = saveTransaction(alice.id, org.sheet.id, org.expense, undefined, connection);
    saveRepayment(alice.id, org.sheet.id, expense.id, { version: 1, repaymentDate: null, comment: "Outstanding note" }, connection);
    saveRepayment(alice.id, org.sheet.id, expense.id, { version: 2, repaymentDate: "2026-10-04", comment: "Paid note" }, connection);
    const edit = saveTransaction(alice.id, org.sheet.id, { ...org.expense, payee: "Updated", version: 3 }, { id: expense.id }, connection);
    expect(edit).toMatchObject({ repaymentDate: "2026-10-04", repaymentComment: "Paid note", version: 4 });
    expect(() => saveTransaction(alice.id, org.sheet.id, { ...org.expense, date: "2026-10-05", version: 4 }, { id: expense.id }, connection)).toThrow("expense date cannot follow");
    const filename = connection.sqlite.name; const reopened = openDatabase(filename);
    try { expect(listOwed(alice.id, org.sheet.id, { bucket: "all" }, reopened).transactions[0]).toMatchObject({ repaymentDate: "2026-10-04", repaymentComment: "Paid note", payee: "Updated", version: 4 }); } finally { reopened.sqlite.close(); }
    const changed = saveTransaction(alice.id, org.sheet.id, { ...org.expense, kind: "transfer", version: 4 }, { id: expense.id }, connection);
    expect(changed).toMatchObject({ repaymentDate: null, repaymentComment: "Paid note", version: 5 });
    expect(listOwed(alice.id, org.sheet.id, { bucket: "all" }, connection).total).toBe(0);
    const back = saveTransaction(alice.id, org.sheet.id, { ...org.expense, version: 5 }, { id: expense.id }, connection);
    expect(back).toMatchObject({ repaymentDate: null, repaymentComment: "Paid note" });
  });
  it("rejects stale ledger/repayment edits and invalid dates or comment lengths atomically", async () => {
    const { connection, alice } = await fixture(); const org = organization(connection, alice.id);
    const expense = saveTransaction(alice.id, org.sheet.id, org.expense, undefined, connection);
    const input = { version: 1, repaymentDate: "2026-10-10", comment: "Saved" };
    for (const repaymentDate of ["2026-02-29", "2026-10-03", "2026-13-01", "0000-01-01", "2026-10-10T12:00:00Z"]) expect(() => saveRepayment(alice.id, org.sheet.id, expense.id, { ...input, repaymentDate }, connection)).toThrow();
    expect(() => saveRepayment(alice.id, org.sheet.id, expense.id, { ...input, comment: "x".repeat(2001) }, connection)).toThrow();
    saveRepayment(alice.id, org.sheet.id, expense.id, input, connection);
    expect(() => saveRepayment(alice.id, org.sheet.id, expense.id, { ...input, comment: "Stale" }, connection)).toThrow("Someone updated");
    expect(() => saveTransaction(alice.id, org.sheet.id, { ...org.expense, version: 1 }, { id: expense.id }, connection)).toThrow("Someone updated");
    expect(connection.db.select().from(transactions).where(eq(transactions.id, expense.id)).get()).toMatchObject({ version: 2, repaymentComment: "Saved" });
    saveTransaction(alice.id, org.sheet.id, { ...org.expense, version: 2 }, { id: expense.id }, connection);
    expect(() => saveRepayment(alice.id, org.sheet.id, expense.id, { ...input, version: 2 }, connection)).toThrow("Someone updated");
  });
  it("tracks archived buckets, retains settlement on untracking, and rejects stale/foreign tracking atomically", async () => {
    const { connection, alice } = await fixture(); const org = organization(connection, alice.id); const other = organization(connection, alice.id);
    const expense = saveTransaction(alice.id, org.sheet.id, org.expense, undefined, connection);
    saveRepayment(alice.id, org.sheet.id, expense.id, { version: 1, repaymentDate: "2026-10-10", comment: "Keep this" }, connection);
    mutateSettings(alice.id, org.sheet.id, { kind: "archive", entity: "bucket", id: org.parents.id }, connection);
    saveTracking(alice.id, org.sheet.id, { buckets: [{ id: org.parents.id, version: 1, tracked: true }] }, connection);
    expect(listOwed(alice.id, org.sheet.id, {}, connection)).toMatchObject({ paid: 4000 });
    expect(() => saveTracking(alice.id, org.sheet.id, { buckets: [{ id: org.ethan.id, version: 1, tracked: true }, { id: org.parents.id, version: 1, tracked: false }] }, connection)).toThrow("Someone changed");
    expect(() => saveTracking(alice.id, org.sheet.id, { buckets: [{ id: org.ethan.id, version: 1, tracked: true }, { id: other.parents.id, version: 1, tracked: true }] }, connection)).toThrow("unavailable");
    expect(listOwed(alice.id, org.sheet.id, {}, connection).buckets.find(({ id }) => id === org.ethan.id)?.trackRepayment).toBe(false);
    saveTracking(alice.id, org.sheet.id, { buckets: [{ id: org.parents.id, version: 2, tracked: false }] }, connection);
    expect(listOwed(alice.id, org.sheet.id, {}, connection).paid).toBe(0);
    expect(listOwed(alice.id, org.sheet.id, { bucket: "all" }, connection).transactions[0]).toMatchObject({ repaymentDate: "2026-10-10", repaymentComment: "Keep this" });
  });
  it("allows accepted members but denies outsiders, pending invitees, removed members, and cross-sheet transaction IDs", async () => {
    const { connection, auth, alice, bob, dependencies } = await fixture(); const org = organization(connection, alice.id); const other = organization(connection, alice.id);
    const expense = saveTransaction(alice.id, org.sheet.id, org.expense, undefined, connection);
    const input = { version: 1, repaymentDate: null, comment: "Member note" };
    expect(() => listOwed(bob.id, org.sheet.id, {}, connection)).toThrow();
    expect(() => saveRepayment(bob.id, org.sheet.id, expense.id, input, connection)).toThrow();
    expect(() => saveRepayment(alice.id, other.sheet.id, expense.id, input, connection)).toThrow();
    const anon = await handleLedgerRequest(request(), { kind: "owed", sheetId: org.sheet.id }, dependencies); expect(anon.status).toBe(401);
    const denied = await handleLedgerRequest(request(bob.cookie), { kind: "owed", sheetId: org.sheet.id }, { ...dependencies, auth }); expect(denied.status).toBe(404);
    const invitation = mutateSharing(alice.id, org.sheet.id, { kind: "invite", userId: bob.id }, connection);
    expect(() => listOwed(bob.id, org.sheet.id, {}, connection)).toThrow();
    if (!invitation || !("id" in invitation) || typeof invitation.id !== "string") throw new Error("Missing test invitation.");
    respondToInvite(bob.id, invitation.id, { kind: "accept" }, connection);
    saveTracking(bob.id, org.sheet.id, { buckets: [{ id: org.parents.id, version: 1, tracked: true }] }, connection);
    saveRepayment(bob.id, org.sheet.id, expense.id, input, connection);
    expect(listOwed(bob.id, org.sheet.id, {}, connection)).toMatchObject({ outstanding: 4000 });
    const csrf = await handleLedgerRequest(request(bob.cookie, { ...input, version: 2 }, "https://outside.test"), { kind: "repayment", sheetId: org.sheet.id, id: expense.id }, dependencies); expect(csrf.status).toBe(403);
    connection.db.delete(sheetMembers).where(eq(sheetMembers.userId, bob.id)).run();
    expect(() => saveRepayment(bob.id, org.sheet.id, expense.id, { ...input, version: 2 }, connection)).toThrow();
  });
  it("combines repeated bucket allocations and rejects unsafe all-time totals without rounding", async () => {
    const { connection, alice } = await fixture(); const org = organization(connection, alice.id);
    saveTracking(alice.id, org.sheet.id, { buckets: [{ id: org.parents.id, version: 1, tracked: true }] }, connection);
    saveTransaction(alice.id, org.sheet.id, { ...org.expense, amount: "-0.03", splits: [{ categoryId: org.category.id, bucketId: org.parents.id, amount: "-0.01" }, { categoryId: org.uncategorized.id, bucketId: org.parents.id, amount: "-0.02" }] }, undefined, connection);
    expect(listOwed(alice.id, org.sheet.id, {}, connection)).toMatchObject({ outstanding: 3, transactions: [{ allocations: [{ bucketId: org.parents.id, amount: 3 }] }] });
    saveTransaction(alice.id, org.sheet.id, { ...org.expense, amount: "-90071992547409.91", splits: [{ categoryId: org.category.id, bucketId: org.parents.id, amount: "-90071992547409.91" }] }, undefined, connection);
    expect(() => listOwed(alice.id, org.sheet.id, {}, connection)).toThrow("totals exceed the supported range");
  });
  it("paginates parents once and retains all their visible allocations", async () => {
    const { connection, alice } = await fixture(); const org = organization(connection, alice.id);
    for (let i = 0; i < 51; i++) saveTransaction(alice.id, org.sheet.id, { ...org.expense, payee: `Expense ${i}` }, undefined, connection);
    const first = listOwed(alice.id, org.sheet.id, { bucket: "all" }, connection); const second = listOwed(alice.id, org.sheet.id, { bucket: "all", page: 2 }, connection);
    expect(first.total).toBe(51); expect(first.transactions).toHaveLength(50); expect(second.transactions).toHaveLength(1);
    expect(first.transactions.every(({ allocations }) => allocations.length === 2)).toBe(true);
    expect(first.transactions.some(({ id }) => id === second.transactions[0]?.id)).toBe(false);
  });
});
