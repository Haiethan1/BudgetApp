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
import { buckets, sheetMembers, user } from "../db/schema";
import { mutateSharing, respondToInvite } from "../sharing/service";
import { mutateSettings } from "../sheets/settings";
import { createSheet, readSheet } from "../sheets/service";
import { calculateSpending, deleteTransaction, saveTransaction } from "./service";
import { saveRepayment, saveTracking } from "../repayments/service";
import { createDebt, editDebt, recordPayment, correctPayment, groupDebt, previewDebt, resolveDebt, readDebt, listDebts } from "../repayments/debts";
import { handleDebtRequest } from "../repayments/debt-http";
import { randomUUID } from "node:crypto";
import { configureTracking } from "../repayments/tracking";
import { recentHistoryRange } from "../repayments/history-range";
import { previewPeriodDebt } from "../repayments/period-preview";

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
  it("authorizes all-scope period preview and guarded grouping over HTTP, with exact retry and stale conflict", async () => {
    const f = await fixture(), { connection: c, alice, bob } = f;
    const { sheet, expense, parents, ethan } = organization(c, alice.id);
    saveTransaction(alice.id, sheet.id, expense, undefined, c);
    const scope = { bucketId: parents.id, recipient: ethan.name, from: "2026-10-01", to: "2026-10-31" };
    const body = { action: "period-preview", input: scope };
    expect((await handleDebtRequest(request(undefined, body), sheet.id, f.dependencies)).status).toBe(401);
    expect((await handleDebtRequest(request(bob.cookie, body), sheet.id, f.dependencies)).status).toBe(404);
    expect((await handleDebtRequest(request(alice.cookie, body, "https://other.test"), sheet.id, f.dependencies)).status).toBe(403);
    const response = await handleDebtRequest(request(alice.cookie, body), sheet.id, f.dependencies);
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ eligibleTotal: 4000, eligiblePaid: 0 });
    const p = previewPeriodDebt(alice.id, sheet.id, scope, c);
    const group = { action: "group", input: { requestId: randomUUID(), description: "October Parents", debtor: p.debtor, recipient: p.recipient, sources: p.sources.map(({ transactionId, version, position }) => ({ transactionId, version, position })), period: { scope: p.scope, digest: p.digest, refundAcknowledged: false } } };
    const saved = await handleDebtRequest(request(alice.cookie, group), sheet.id, f.dependencies); expect(saved.status).toBe(200);
    const result = await saved.json(); expect(result).toMatchObject({ total: 4000, paid: 0 });
    expect(await (await handleDebtRequest(request(alice.cookie, group), sheet.id, f.dependencies)).json()).toEqual(result);
    const stale = { ...group, input: { ...group.input, requestId: randomUUID() } };
    expect((await handleDebtRequest(request(alice.cookie, stale), sheet.id, f.dependencies)).status).toBe(409);
    expect((await handleDebtRequest(request(alice.cookie, { ...body, input: { ...scope, accountId: randomUUID() } }), sheet.id, f.dependencies)).status).toBe(400);
  });
  it("summarizes effective last received dates and note presence without returning repayment histories", async () => {
    const { connection: c, alice } = await fixture(); const { sheet } = organization(c, alice.id);
    const original = createDebt(alice.id, sheet.id, { ...newDebt("100"), opening: { amount: "10", date: "2020-01-01", comment: "Old receipt" } }, c);
    const payment = recordPayment(alice.id, sheet.id, original.id, { requestId: randomUUID(), version: original.version, amount: "20", date: "2026-10-03", comment: "Partial transfer" }, c);
    let summary = listDebts(alice.id, sheet.id, { status: "outstanding" }, c).debts[0];
    expect(summary).toMatchObject({ lastReceivedDate: "2026-10-03", completionDate: null, hasNotes: true, paid: 3000, remaining: 7000 });
    expect(summary).not.toHaveProperty("payments"); expect(summary).not.toHaveProperty("sources");
    const paidEvent = payment.payments.find(event => event.kind === "payment"); if (!paidEvent) throw new Error("Missing payment");
    const corrected = correctPayment(alice.id, sheet.id, original.id, { requestId: randomUUID(), version: payment.version, paymentId: paidEvent.id, amount: "15", date: "2019-01-01", comment: "Correct date", reason: "Receipt" }, c);
    expect(listDebts(alice.id, sheet.id, {}, c).debts[0]?.lastReceivedDate).toBe("2020-01-01");
    const opening = corrected.payments.find(event => event.kind === "opening"); if (!opening) throw new Error("Missing opening");
    const voided = correctPayment(alice.id, sheet.id, original.id, { requestId: randomUUID(), version: corrected.version, paymentId: opening.id, amount: "0", date: "2026-11-01", comment: "", reason: "Void opening" }, c);
    expect(listDebts(alice.id, sheet.id, {}, c).debts[0]?.lastReceivedDate).toBe("2019-01-01");
    const full = recordPayment(alice.id, sheet.id, original.id, { requestId: randomUUID(), version: voided.version, amount: "85", date: "2026-10-04", comment: "" }, c);
    summary = listDebts(alice.id, sheet.id, { status: "paid" }, c).debts[0];
    expect(summary).toMatchObject({ lastReceivedDate: "2026-10-04", completionDate: "2026-10-04", remaining: 0 });
    const fullEvent = full.payments.find(event => event.kind === "payment" && event.amount === 8500); if (!fullEvent) throw new Error("Missing full payment");
    correctPayment(alice.id, sheet.id, original.id, { requestId: randomUUID(), version: full.version, paymentId: fullEvent.id, amount: "0", date: "2026-12-01", comment: "", reason: "Void transfer" }, c);
    expect(listDebts(alice.id, sheet.id, { status: "outstanding" }, c).debts[0]).toMatchObject({ lastReceivedDate: "2019-01-01", completionDate: null, remaining: 8500 });
    expect(listDebts(alice.id, sheet.id, { status: "paid" }, c).total).toBe(0);
    const empty = createDebt(alice.id, sheet.id, newDebt("5"), c);
    expect(listDebts(alice.id, sheet.id, {}, c).debts.find(debt => debt.id === empty.id)).toMatchObject({ lastReceivedDate: null, hasNotes: false });
  });
  it("pages all-date outstanding separately from bounded completion history and preserves direction", async () => {
    const { connection: c, alice } = await fixture(); const { sheet } = organization(c, alice.id);
    for (let i = 0; i < 23; i++) createDebt(alice.id, sheet.id, { ...newDebt("10.00"), recipient: i % 2 ? "Ethan" : "Pat", opening: { amount: "2.00", date: "2020-01-01", comment: "Old partial" } }, c);
    for (let i = 0; i < 105; i++) createDebt(alice.id, sheet.id, { ...newDebt("3.00"), opening: { amount: "3.00", date: i === 104 ? "2020-01-01" : "2026-10-01", comment: "Already repaid" } }, c);
    const first = listDebts(alice.id, sheet.id, { status: "outstanding", debtor: "Parents", pageSize: 100, from: "2026-01-01" }, c);
    expect(first).toMatchObject({ total: 23, pageSize: 10, outstanding: 18400, paid: 36100, people: [{ debtor: "Parents", outstanding: 18400 }] });
    expect(first.debts).toHaveLength(10); expect(first.debts[0]).not.toHaveProperty("payments");
    const second = listDebts(alice.id, sheet.id, { status: "outstanding", debtor: "Parents", page: 2 }, c);
    expect(second.debts).toHaveLength(10); expect(second.outstanding).toBe(18400);
    expect(second.debts.every(d => !first.debts.some(f => f.id === d.id))).toBe(true);
    expect(listDebts(alice.id, sheet.id, { status: "outstanding", page: 3 }, c).debts).toHaveLength(3);
    const paid = listDebts(alice.id, sheet.id, { status: "paid", from: "2026-07-01", to: "2026-10-16" }, c);
    expect(paid.total).toBe(104); expect(paid.debts).toHaveLength(10);
    expect(paid.debts.map(d => d.id)).toEqual([...paid.debts.map(d => d.id)].sort());
    expect(listDebts(alice.id, sheet.id, { status: "paid", pageSize: 100, page: 2 }, c).debts).toHaveLength(5);
    expect(() => listDebts(alice.id, sheet.id, { pageSize: 101 }, c)).toThrow();
    expect(() => listDebts(alice.id, sheet.id, { from: "2026-10-01", to: "2026-01-01" }, c)).toThrow();
    expect(listDebts(alice.id, sheet.id, { debtor: "parents" }, c).total).toBe(0);
    const d = createDebt(alice.id, sheet.id, { ...newDebt("5.00"), debtor: "Completed only", opening: { amount: "5.00", date: "2026-10-01", comment: "" } }, c);
    const corrected = correctPayment(alice.id, sheet.id, d.id, { requestId: randomUUID(), version: d.version, paymentId: d.payments[0].id, amount: "5.00", date: "2020-01-01", comment: "", reason: "Correct date" }, c);
    expect(listDebts(alice.id, sheet.id, { status: "paid", debtor: "Completed only", from: "2026-07-01" }, c).total).toBe(0);
    expect(listDebts(alice.id, sheet.id, { status: "paid", debtor: "Completed only" }, c).debts[0].completionDate).toBe(corrected.completionDate);
    correctPayment(alice.id, sheet.id, d.id, { requestId: randomUUID(), version: corrected.version, paymentId: d.payments[0].id, amount: "0", date: "2026-10-01", comment: "", reason: "Void opening" }, c);
    expect(listDebts(alice.id, sheet.id, { status: "outstanding", debtor: "Completed only" }, c)).toMatchObject({ total: 1, outstanding: 500 });
  });
  it("uses inclusive UTC calendar bounds with month-end clamping", () => {
    expect(recentHistoryRange(new Date("2026-05-31T23:59:59Z"))).toEqual({ from: "2026-02-28", to: "2026-05-31" });
    expect(recentHistoryRange(new Date("2024-05-31T00:00:00Z"))).toEqual({ from: "2024-02-29", to: "2024-05-31" });
    expect(recentHistoryRange(new Date("2026-01-01T00:00:00Z"))).toEqual({ from: "2025-10-01", to: "2026-01-01" });
  });
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
    expect(listDebts(alice.id, org.sheet.id, { status: "paid" }, c).debts.find(d => d.id === adopted.id)?.completionDate).toBe(adopted.completionDate);
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


describe("automatic spending-group repayment tracking", () => {
  it("backfills only the tracked share, tracks future expenses, and preserves partial repayments across retries and edits", async () => {
    const { connection: c, alice } = await fixture(); const { sheet, parents, ethan, expense } = organization(c, alice.id);
    const original = saveTransaction(alice.id, sheet.id, expense, undefined, c);
    expect(listDebts(alice.id, sheet.id, {}, c).total).toBe(0);
    const enable = { requestId: randomUUID(), bucketId: parents.id, version: parents.trackingVersion, tracking: { enabled: true, recipient: "Ethan" } };
    configureTracking(alice.id, sheet.id, enable, c);
    configureTracking(alice.id, sheet.id, enable, c);
    const first = listDebts(alice.id, sheet.id, {}, c);
    expect(first).toMatchObject({ total: 1, outstanding: 4000, people: [{ debtor: "Parents", outstanding: 4000 }] });
    const debt = readDebt(alice.id, sheet.id, first.debts[0].id, c);
    expect(debt.sources).toMatchObject([{ transactionId: original.id, position: 1, amount: 4000 }]);
    recordPayment(alice.id, sheet.id, debt.id, { requestId: randomUUID(), version: debt.version, amount: "10.00", date: "2026-10-16", comment: "Cash" }, c);
    saveTransaction(alice.id, sheet.id, { ...expense, payee: "Next expense" }, undefined, c);
    expect(listDebts(alice.id, sheet.id, { debtor: "Parents", status: "outstanding" }, c)).toMatchObject({ total: 2, outstanding: 7000 });
    saveTransaction(alice.id, sheet.id, { ...expense, version: original.version, payee: "Updated market" }, { id: original.id }, c);
    expect(listDebts(alice.id, sheet.id, {}, c)).toMatchObject({ total: 2, outstanding: 7000 });
    expect(readDebt(alice.id, sheet.id, debt.id, c)).toMatchObject({ paid: 1000, remaining: 3000, needsReview: true });
    expect(listDebts(alice.id, sheet.id, { debtor: ethan.name }, c).total).toBe(0);
  });
  it("stops future additions without removing debts, and re-enables without duplicating already claimed portions", async () => {
    const { connection: c, alice } = await fixture(); const { sheet, parents, expense } = organization(c, alice.id);
    configureTracking(alice.id, sheet.id, { requestId: randomUUID(), bucketId: parents.id, version: 1, tracking: { enabled: true, recipient: "Ethan" } }, c);
    saveTransaction(alice.id, sheet.id, expense, undefined, c);
    configureTracking(alice.id, sheet.id, { requestId: randomUUID(), bucketId: parents.id, version: 2, tracking: { enabled: false } }, c);
    saveTransaction(alice.id, sheet.id, expense, undefined, c);
    expect(listDebts(alice.id, sheet.id, {}, c)).toMatchObject({ total: 1, outstanding: 4000 });
    configureTracking(alice.id, sheet.id, { requestId: randomUUID(), bucketId: parents.id, version: 3, tracking: { enabled: true, recipient: "Pat" } }, c);
    const result = listDebts(alice.id, sheet.id, {}, c);
    expect(result).toMatchObject({ total: 2, outstanding: 8000 });
    expect(result.debts.map(d => d.recipient).sort()).toEqual(["Ethan", "Pat"]);
    const refund = { ...expense, kind: "refund", amount: "100.00", splits: expense.splits.map(s => ({ ...s, amount: s.amount.slice(1) })) };
    saveTransaction(alice.id, sheet.id, refund, undefined, c);
    expect(listDebts(alice.id, sheet.id, {}, c).total).toBe(2);
  });
  it("authorizes tracking, rejects stale settings and changed retries, and keeps standalone debts separate", async () => {
    const { connection: c, alice, bob, dependencies } = await fixture(); const { sheet, parents, unassigned, expense } = organization(c, alice.id);
    const input = { requestId: randomUUID(), bucketId: parents.id, version: 1, tracking: { enabled: true, recipient: "Ethan" } };
    expect(() => configureTracking(bob.id, sheet.id, input, c)).toThrow();
    expect(() => configureTracking(alice.id, sheet.id, { ...input, bucketId: unassigned.id }, c)).toThrow("custom person or group");
    expect(() => configureTracking(alice.id, sheet.id, { ...input, tracking: { enabled: true, recipient: " " } }, c)).toThrow();
    const response = await handleDebtRequest(request(alice.cookie, { action: "tracking", input }), sheet.id, dependencies);
    expect(response.status).toBe(200);
    expect(() => configureTracking(alice.id, sheet.id, { ...input, tracking: { enabled: false } }, c)).toThrow("already used");
    expect(() => configureTracking(alice.id, sheet.id, { ...input, requestId: randomUUID() }, c)).toThrow("Someone changed tracking");
    createDebt(alice.id, sheet.id, newDebt("5.00"), c);
    saveTransaction(alice.id, sheet.id, expense, undefined, c);
    expect(listDebts(alice.id, sheet.id, { debtor: "Parents" }, c)).toMatchObject({ total: 2, outstanding: 4500 });
  });
});


describe("spending-group debt names and party totals", () => {
  it("creates reusable spending groups, normalizes duplicate names, and totals the whole direction across pages", async () => {
    const { connection: c, alice } = await fixture(); const { sheet } = organization(c, alice.id);
    const house = createDebt(alice.id, sheet.id, { ...newDebt("1002.00"), description: "house 2", debtor: "Parents 1", recipient: "Me" }, c);
    createDebt(alice.id, sheet.id, { ...newDebt("10000.00"), description: "Roof", debtor: "Parents 1", recipient: "Me" }, c);
    expect(listDebts(alice.id, sheet.id, { status: "outstanding" }, c).directions).toEqual([{ debtor: "Parents 1", recipient: "Me", total: 1100200, paid: 0, remaining: 1100200, count: 2 }]);
    const variant = createDebt(alice.id, sheet.id, { ...newDebt("1.00"), debtor: "parents 1", recipient: "me" }, c);
    expect(variant).toMatchObject({ debtor: "Parents 1", recipient: "Me" });
    expect(readSheet(alice.id, sheet.id, c).buckets.filter(g => g.name.toLowerCase() === "parents 1")).toHaveLength(1);
    for (let i = 0; i < 10; i++) createDebt(alice.id, sheet.id, { ...newDebt("1.00"), debtor: "Parents 1", recipient: "Me" }, c);
    recordPayment(alice.id, sheet.id, house.id, { requestId: randomUUID(), version: house.version, amount: "2.00", date: "2026-10-16" }, c);
    const result = listDebts(alice.id, sheet.id, { status: "outstanding", page: 2 }, c);
    expect(result.debts).toHaveLength(3);
    expect(result.directions).toEqual([{ debtor: "Parents 1", recipient: "Me", total: 1101300, paid: 200, remaining: 1101100, count: 13 }]);
  });
  it("migrates the default without reassigning historical allocations and reuses an existing Me group", async () => {
    const { connection: c, alice } = await fixture(); const org = organization(c, alice.id);
    c.db.update(buckets).set({ name: "Unassigned" }).where(eq(buckets.id, org.unassigned.id)).run();
    const original = saveTransaction(alice.id, org.sheet.id, { ...org.expense, splits: [{ categoryId: org.category.id, bucketId: org.unassigned.id, amount: "-100.00" }] }, undefined, c);
    mutateSettings(alice.id, org.sheet.id, { kind: "create", entity: "bucket", name: "Me" }, c);
    const before = readSheet(alice.id, org.sheet.id, c).buckets.find(g => g.name === "Me");
    const other = organization(c, alice.id);
    c.db.update(buckets).set({ name: "Unassigned" }).where(eq(buckets.id, other.unassigned.id)).run();
    const migration = fs.readFileSync("drizzle/0017_me_default.sql", "utf8");
    c.sqlite.transaction(() => c.sqlite.exec(migration)).immediate();
    c.sqlite.transaction(() => c.sqlite.exec(migration)).immediate();
    const full = readSheet(alice.id, org.sheet.id, c);
    expect(full.buckets.filter(g => g.isProtected)).toMatchObject([{ id: before?.id, name: "Me", isArchived: false }]);
    expect(full.buckets.find(g => g.id === org.unassigned.id)).toMatchObject({ name: "Unassigned", isProtected: false, isArchived: true });
    expect(c.sqlite.prepare("SELECT bucket_id FROM splits WHERE transaction_id=?").all(original.id)).toEqual([{ bucket_id: org.unassigned.id }]);
    expect(readSheet(alice.id, other.sheet.id, c).buckets.filter(g => g.isProtected)).toMatchObject([{ name: "Me", isArchived: false }]);
  });
});
