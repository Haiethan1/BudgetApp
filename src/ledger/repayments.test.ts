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
import { sheetMembers, user } from "../db/schema";
import { mutateSharing, respondToInvite } from "../sharing/service";
import { mutateSettings } from "../sheets/settings";
import { createSheet, readSheet } from "../sheets/service";
import { calculateSpending, deleteTransaction, saveTransaction } from "./service";
import { saveRepayment, saveTracking } from "../repayments/service";
import { createDebt, editDebt, recordPayment, correctPayment, groupDebt, previewDebt, resolveDebt, readDebt, listDebts } from "../repayments/debts";
import { handleDebtRequest } from "../repayments/debt-http";
import { randomUUID } from "node:crypto";

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


const newDebt = (total = "100.00") => ({ requestId: randomUUID(), description: "October agreement", debtor: "Parents", recipient: "Ethan", total });
describe("explicit debts and repayment histories", () => {
  it("derives exact opening, partial and corrected payments, rejects overpayment, and safely retries", async () => {
    const { connection: c, alice } = await fixture(); const { sheet } = organization(c, alice.id);
    const input = { ...newDebt("0.30"), opening: { amount: "0.10", date: "2026-01-01", comment: "Spreadsheet opening" } };
    const d = createDebt(alice.id, sheet.id, input, c); expect(d).toMatchObject({ total: 30, paid: 10, remaining: 20, completionDate: null });
    expect(createDebt(alice.id, sheet.id, input, c).id).toBe(d.id); expect(listDebts(alice.id, sheet.id, {}, c).total).toBe(1);
    expect(() => createDebt(alice.id, sheet.id, { ...input, description: "Changed retry" }, c)).toThrow("already used");
    const pay = { requestId: randomUUID(), version: d.version, amount: "0.20", date: "2026-02-01", comment: "Cash" };
    const paid = recordPayment(alice.id, sheet.id, d.id, pay, c); expect(paid).toMatchObject({ paid: 30, remaining: 0, completionDate: "2026-02-01" });
    expect(recordPayment(alice.id, sheet.id, d.id, pay, c).paid).toBe(30);
    expect(() => recordPayment(alice.id, sheet.id, d.id, { ...pay, requestId: randomUUID(), version: paid.version, amount: "0.01" }, c)).toThrow("between zero");
    const payment = paid.payments.find(p => p.kind === "payment"); if (!payment) throw new Error("Missing payment");
    const corrected = correctPayment(alice.id, sheet.id, d.id, { requestId: randomUUID(), version: paid.version, paymentId: payment.id, amount: "0.15", date: "2026-02-02", comment: "Corrected cash", reason: "Receipt corrected" }, c);
    expect(corrected).toMatchObject({ paid: 25, remaining: 5, completionDate: null }); expect(corrected.payments.map(p => p.amount)).toEqual([10,20,-5]);
    const voided = correctPayment(alice.id, sheet.id, d.id, { requestId: randomUUID(), version: corrected.version, paymentId: payment.id, amount: "0", date: "2026-02-03", comment: "", reason: "Payment reversed" }, c);
    expect(voided).toMatchObject({ paid: 10, remaining: 20 }); expect(voided.payments.at(-1)?.amount).toBe(-15);
    expect(() => recordPayment(alice.id, sheet.id, d.id, { ...pay, requestId: randomUUID() }, c)).toThrow("Someone updated");
    expect(() => createDebt(alice.id, sheet.id, newDebt("0.001"), c)).toThrow("decimal places");
    const jpy = organization(c, alice.id, "JPY"); expect(createDebt(alice.id, jpy.sheet.id, newDebt("13"), c).remaining).toBe(13);
  });
  it("groups exact portions and existing paid histories without ledger writes or duplicate claims", async () => {
    const { connection: c, alice } = await fixture(); const org = organization(c, alice.id);
    const t = saveTransaction(alice.id, org.sheet.id, org.expense, undefined, c); const before = calculateSpending(alice.id, org.sheet.id, "2026-10", c);
    expect(listDebts(alice.id, org.sheet.id, {}, c).total).toBe(0);
    const input = { ...newDebt(), sources: [{ transactionId: t.id, version: t.version, position: 1 }], debts: [] };
    expect(previewDebt(alice.id, org.sheet.id, input, c)).toMatchObject({ total: 4000, paid: 0, sources: [{ amount: 4000, bucketName: "Parents" }] });
    const source = groupDebt(alice.id, org.sheet.id, input, c);
    expect(() => groupDebt(alice.id, org.sheet.id, { ...input, requestId: randomUUID() }, c)).toThrow("already belongs");
    expect(() => groupDebt(alice.id, org.sheet.id, { ...input, requestId: randomUUID(), sources: [{ transactionId: t.id, version: t.version, position: null }] }, c)).toThrow("already belongs");
    const partial = recordPayment(alice.id, org.sheet.id, source.id, { requestId: randomUUID(), version: source.version, amount: "10.00", date: "2026-10-10", comment: "Original payment" }, c);
    const standalone = createDebt(alice.id, org.sheet.id, { ...newDebt("60.00"), opening: { amount: "60.00", date: "2026-09-01", comment: "Older paid agreement" } }, c);
    const groupInput = { ...newDebt(), sources: [], debts: [{ id: partial.id, version: partial.version }, { id: standalone.id, version: standalone.version }] };
    const grouped = groupDebt(alice.id, org.sheet.id, groupInput, c);
    expect(grouped).toMatchObject({ total: 10000, paid: 7000, remaining: 3000 }); expect(grouped.payments).toHaveLength(2); expect(grouped.sources).toHaveLength(1);
    expect(listDebts(alice.id, org.sheet.id, {}, c)).toMatchObject({ total: 1, outstanding: 3000, paid: 7000 });
    expect(readDebt(alice.id, org.sheet.id, source.id, c).groupedInto).toBe(grouped.id);
    expect(calculateSpending(alice.id, org.sheet.id, "2026-10", c)).toEqual(before);
    expect(() => recordPayment(alice.id, org.sheet.id, source.id, { requestId: randomUUID(), version: source.version, amount: "1.00", date: "2026-10-10" }, c)).toThrow("grouped");
  });
  it("keeps agreed totals through edits/refunds/deletion, requires explicit resolution, and blocks reordered claims", async () => {
    const { connection: c, alice } = await fixture(); const org = organization(c, alice.id);
    const t = saveTransaction(alice.id, org.sheet.id, org.expense, undefined, c);
    const d = groupDebt(alice.id, org.sheet.id, { ...newDebt(), sources: [{ transactionId: t.id, version: 1, position: 1 }] }, c);
    const edit = saveTransaction(alice.id, org.sheet.id, { ...org.expense, version: 1, splits: [...org.expense.splits].reverse() }, { id: t.id }, c);
    const changed = readDebt(alice.id, org.sheet.id, d.id, c); expect(changed).toMatchObject({ total: 4000, remaining: 4000, needsReview: true });
    const resolve = { requestId: randomUUID(), version: changed.version, action: "keep", reason: "Agreed amount unchanged", sources: changed.sources.map(s => ({ id: s.id, version: s.currentVersion })) };
    const kept = resolveDebt(alice.id, org.sheet.id, d.id, resolve, c); expect(kept).toMatchObject({ total: 4000, needsReview: false });
    expect(() => groupDebt(alice.id, org.sheet.id, { ...newDebt(), sources: [{ transactionId: t.id, version: edit.version, position: 0 }] }, c)).toThrow("moved portion twice");
    const refund = saveTransaction(alice.id, org.sheet.id, { ...org.expense, kind: "refund", version: edit.version, amount: "100.00", splits: org.expense.splits.map(s => ({ ...s, amount: s.amount.slice(1) })) }, { id: t.id }, c);
    expect(readDebt(alice.id, org.sheet.id, d.id, c)).toMatchObject({ needsReview: true, total: 4000, sources: [{ currentAmount: 0 }] });
    expect(() => resolveDebt(alice.id, org.sheet.id, d.id, { ...resolve, requestId: randomUUID(), version: kept.version }, c)).toThrow("changed after");
    deleteTransaction(alice.id, org.sheet.id, t.id, { version: refund.version }, c);
    const deleted = readDebt(alice.id, org.sheet.id, d.id, c);
    const adopted = resolveDebt(alice.id, org.sheet.id, d.id, { ...resolve, requestId: randomUUID(), version: deleted.version, action: "adopt", sources: deleted.sources.map(s => ({ id: s.id, version: s.currentVersion })) }, c);
    expect(adopted).toMatchObject({ total: 0, remaining: 0, needsReview: false, sources: [{ originalAmount: 4000, deleted: true }] });
  });
  it("enforces access, cross-sheet IDs, CSRF, retired authorities and atomic failures", async () => {
    const { connection: c, alice, bob, dependencies } = await fixture(); const org = organization(c, alice.id), other = organization(c, alice.id);
    const d = createDebt(alice.id, org.sheet.id, newDebt(), c);
    expect(() => readDebt(bob.id, org.sheet.id, d.id, c)).toThrow(); expect(() => readDebt(alice.id, other.sheet.id, d.id, c)).toThrow();
    const invitation = mutateSharing(alice.id, org.sheet.id, { kind: "invite", userId: bob.id }, c); if (!invitation || !("id" in invitation) || typeof invitation.id !== "string") throw new Error("No invitation");
    expect(() => createDebt(bob.id, org.sheet.id, newDebt(), c)).toThrow(); respondToInvite(bob.id, invitation.id, { kind: "accept" }, c);
    const member = editDebt(bob.id, org.sheet.id, d.id, { ...newDebt(), version: d.version, reason: "Clarified agreement" }, c); expect(member.version).toBe(2);
    expect(() => saveRepayment(alice.id, org.sheet.id, d.id, {}, c)).toThrow("moved to debt"); expect(() => saveTracking(alice.id, org.sheet.id, {}, c)).toThrow("no longer create debts");
    const anon = await handleDebtRequest(request(), org.sheet.id, dependencies); expect(anon.status).toBe(401);
    const csrf = await handleDebtRequest(request(alice.cookie, { action: "create", input: newDebt() }, "https://outside.test"), org.sheet.id, dependencies); expect(csrf.status).toBe(403);
    c.sqlite.exec("CREATE TRIGGER reject_payment BEFORE INSERT ON debt_payments BEGIN SELECT RAISE(ABORT, 'test payment failure'); END");
    expect(() => createDebt(alice.id, org.sheet.id, { ...newDebt(), opening: { amount: "5.00", date: "2026-01-01", comment: "" } }, c)).toThrow("test payment failure");
    expect(listDebts(alice.id, org.sheet.id, {}, c).total).toBe(1); c.sqlite.exec("DROP TRIGGER reject_payment");
    c.db.delete(sheetMembers).where(eq(sheetMembers.userId, bob.id)).run(); expect(() => readDebt(bob.id, org.sheet.id, d.id, c)).toThrow();
  });
});
