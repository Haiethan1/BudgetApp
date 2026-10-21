import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { openDatabase } from "../db/client";
import { migrateDatabase } from "../db/migrate";
import { debts, debtSources, sheetMembers, user } from "../db/schema";
import { createSheet, readSheet } from "../sheets/service";
import { mutateSettings } from "../sheets/settings";
import { listTransactions, saveTransaction } from "../ledger/service";
import { createDebt, groupDebt, readDebt, recordPayment, resolveDebt } from "./debts";
import { previewPeriodDebt } from "./period-preview";
import { periodSelection } from "./period-selection";
import type { PeriodPreview } from "./period-input";

const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); });
function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "homebooks-period-"));
  const filename = path.join(directory, "test.sqlite"); migrateDatabase(filename);
  const c = openDatabase(filename); cleanups.push(() => { c.sqlite.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const owner = randomUUID(), member = randomUUID(), outsider = randomUUID();
  for (const id of [owner, member, outsider]) c.db.insert(user).values({ id, name: id, email: `${id}@example.test` }).run();
  const sheet = createSheet(owner, { name: "Period", currency: "USD" }, c).sheet;
  c.db.insert(sheetMembers).values({ sheetId: sheet.id, userId: member, acceptedAt: new Date() }).run();
  for (const name of ["Card", "Cash"]) mutateSettings(owner, sheet.id, { kind: "create", entity: "account", name, sourceType: "cash" }, c);
  mutateSettings(owner, sheet.id, { kind: "create", entity: "bucket", name: "Parents" }, c);
  const full = readSheet(owner, sheet.id, c), account = full.accounts[0], other = full.accounts[1], category = full.categories[0], parents = full.buckets.find(row => row.name === "Parents"), me = full.buckets.find(row => row.isProtected);
  if (!account || !other || !category || !parents || !me) throw new Error("Missing organization");
  const scope = { bucketId: parents.id, recipient: me.name, from: "2026-10-08", to: "2026-11-07" };
  const purchase = (date = scope.from, accountId = account.id, amount = "-1.00") => saveTransaction(owner, sheet.id, { requestId: randomUUID(), accountId, date, payee: `Market ${randomUUID()}`, kind: amount.startsWith("-") ? "expense" : "refund", amount, splits: [{ categoryId: category.id, bucketId: parents.id, amount }] }, undefined, c);
  const preview = () => previewPeriodDebt(owner, sheet.id, scope, c);
  const group = (p: PeriodPreview) => ({ requestId: randomUUID(), description: "Period agreement", debtor: p.debtor, recipient: p.recipient, sources: p.sources.map(({ transactionId, version, position }) => ({ transactionId, version, position })), debts: p.debts.map(({ id, version }) => ({ id, version })), period: { scope: p.scope, digest: p.digest, refundAcknowledged: true } });
  return { c, owner, member, outsider, sheet, account, other, category, parents, me, scope, purchase, preview, group };
}

it("discovers every period page, inclusive dates and accounts, and preserves gross/payment histories without changing spending", () => {
  const f = fixture();
  for (let i = 0; i < 55; i++) f.purchase(i % 2 ? f.scope.from : f.scope.to, i % 3 ? f.account.id : f.other.id);
  const partialSource = f.purchase(), paidSource = f.purchase();
  const claim = (source: typeof partialSource) => groupDebt(f.owner, f.sheet.id, { requestId: randomUUID(), description: "Earlier agreement", debtor: f.parents.name, recipient: f.me.name, sources: [{ transactionId: source.id, version: source.version, position: 0 }], debts: [] }, f.c);
  const partial = claim(partialSource), paid = claim(paidSource);
  recordPayment(f.owner, f.sheet.id, partial.id, { requestId: randomUUID(), version: partial.version, amount: "0.25", date: "2026-10-10", comment: "Bank transfer" }, f.c);
  recordPayment(f.owner, f.sheet.id, paid.id, { requestId: randomUUID(), version: paid.version, amount: "1.00", date: "2026-10-11", comment: "Done" }, f.c);
  f.purchase(f.scope.from, f.account.id, "5.00"); f.purchase("2026-10-07"); f.purchase("2026-11-08");
  const p = f.preview(); expect(p.sources).toHaveLength(55); expect(p.debts).toHaveLength(2);
  expect(p).toMatchObject({ expenseTotal: 5700, refundTotal: 500, netSpending: 5200, eligibleTotal: 5700, eligiblePaid: 125 });
  const narrowed = previewPeriodDebt(f.owner, f.sheet.id, { ...f.scope, accountId: f.account.id }, f.c);
  expect(narrowed.sources.length).toBeLessThan(55);
  const selected = periodSelection(p, new Set(p.sources.map(source => `${source.transactionId}:${source.position}`)));
  expect(selected).toMatchObject({ gross: 5500n, paid: 0n, remaining: 5500n, count: 55 });
  const before = listTransactions(f.owner, f.sheet.id, {}, f.c);
  const input = f.group(p), result = groupDebt(f.member, f.sheet.id, input, f.c);
  expect(result).toMatchObject({ total: 5700, paid: 125, remaining: 5575, needsReview: false });
  expect(result.sources).toHaveLength(57); expect(result.payments.map(payment => payment.comment)).toEqual(["Bank transfer", "Done"]);
  expect(readDebt(f.owner, f.sheet.id, partial.id, f.c).groupedInto).toBe(result.id);
  expect(listTransactions(f.owner, f.sheet.id, {}, f.c)).toEqual(before);
  expect(groupDebt(f.member, f.sheet.id, input, f.c).id).toBe(result.id);
  expect(() => groupDebt(f.owner, f.sheet.id, { ...input, description: "Changed" }, f.c)).toThrow("already used");
  expect(() => groupDebt(f.outsider, f.sheet.id, input, f.c)).toThrow();
  expect(() => previewPeriodDebt(f.outsider, f.sheet.id, f.scope, f.c)).toThrow();
});

it.each(["new purchase", "new claim", "source edit", "payment"])("rejects stale all-scope preview atomically after %s", change => {
  const f = fixture(); const source = f.purchase();
  const existing = groupDebt(f.owner, f.sheet.id, { requestId: randomUUID(), description: "Existing", debtor: f.parents.name, recipient: f.me.name, sources: [{ transactionId: source.id, version: 1, position: 0 }] }, f.c);
  const unclaimed = f.purchase(), p = f.preview(), input = f.group(p);
  if (change === "new purchase") f.purchase();
  if (change === "new claim") groupDebt(f.owner, f.sheet.id, { requestId: randomUUID(), description: "Concurrent", debtor: f.parents.name, recipient: f.me.name, sources: [{ transactionId: unclaimed.id, version: 1, position: 0 }] }, f.c);
  if (change === "source edit") saveTransaction(f.owner, f.sheet.id, { accountId: f.account.id, date: f.scope.from, payee: "Changed", kind: "expense", amount: "-1.00", version: 1, splits: [{ categoryId: f.category.id, bucketId: f.parents.id, amount: "-1.00" }] }, { id: source.id }, f.c);
  if (change === "payment") recordPayment(f.owner, f.sheet.id, existing.id, { requestId: randomUUID(), version: existing.version, amount: "0.25", date: f.scope.from, comment: "" }, f.c);
  const count = f.c.db.select().from(debts).all().length;
  expect(() => groupDebt(f.owner, f.sheet.id, input, f.c)).toThrow("Period sources or repayments changed");
  expect(f.c.db.select().from(debts).all()).toHaveLength(count);
  expect(readDebt(f.owner, f.sheet.id, existing.id, f.c).groupedInto).toBeNull();
});

it("requires gross/refund acknowledgement, keeps refund-only/negative net honest, and rolls back failed grouping", () => {
  const f = fixture(); f.purchase(); f.purchase(f.scope.from, f.account.id, "8.00");
  const p = f.preview(); expect(p).toMatchObject({ netSpending: -700, eligibleTotal: 100, refundTotal: 800 });
  const input = f.group(p);
  expect(() => groupDebt(f.owner, f.sheet.id, { ...input, period: { ...input.period, refundAcknowledged: false } }, f.c)).toThrow("Acknowledge");
  f.c.sqlite.exec("CREATE TRIGGER fail_period BEFORE INSERT ON debt_requests BEGIN SELECT RAISE(ABORT, 'request failed'); END");
  expect(() => groupDebt(f.owner, f.sheet.id, input, f.c)).toThrow("request failed");
  expect(f.c.db.select().from(debts).all()).toHaveLength(0); expect(f.c.db.select().from(debtSources).all()).toHaveLength(0);
  f.c.sqlite.exec("DROP TRIGGER fail_period"); expect(groupDebt(f.owner, f.sheet.id, input, f.c).total).toBe(100);
  const refunds = previewPeriodDebt(f.owner, f.sheet.id, { ...f.scope, from: "2026-11-06", to: "2026-11-07" }, f.c);
  expect(refunds.eligibleTotal).toBe(0); expect(() => groupDebt(f.owner, f.sheet.id, f.group(refunds), f.c)).toThrow();
});

it("explains standalone, unknown, other direction, mixed periods, review and edited-claim exclusions", () => {
  const f = fixture();
  createDebt(f.owner, f.sheet.id, { requestId: randomUUID(), description: "Standalone", debtor: f.parents.name, recipient: f.me.name, total: "4" }, f.c);
  const claim = (description: string, recipient = f.me.name, extra?: ReturnType<typeof f.purchase>) => { const source = f.purchase(); const debt = groupDebt(f.owner, f.sheet.id, { requestId: randomUUID(), description, debtor: f.parents.name, recipient, sources: [source, ...(extra ? [extra] : [])].map(row => ({ transactionId: row.id, version: row.version, position: 0 })) }, f.c); return { debt, source }; };
  claim("Other direction", "Parents"); claim("Mixed", f.me.name, f.purchase("2026-09-01"));
  const unknown = claim("Unknown"); f.c.db.update(debts).set({ recipient: null }).where(eq(debts.id, unknown.debt.id)).run();
  const reviewed = claim("Review");
  saveTransaction(f.owner, f.sheet.id, { accountId: f.account.id, date: f.scope.from, payee: "Edited", kind: "expense", amount: "-2", version: 1, splits: [{ categoryId: f.category.id, bucketId: f.parents.id, amount: "-1" }, { categoryId: f.category.id, bucketId: f.parents.id, amount: "-1" }] }, { id: reviewed.source.id }, f.c);
  const p = f.preview(); expect(p.sources).toHaveLength(0); expect(p.debts).toHaveLength(0);
  for (const text of ["Standalone agreement", "Recipient needs clarification", "Other direction", "outside these dates/account", "need review", "New claims are blocked"]) expect(p.exclusions.some(entry => entry.reason.includes(text))).toBe(true);
  const current = readDebt(f.owner, f.sheet.id, reviewed.debt.id, f.c);
  resolveDebt(f.owner, f.sheet.id, current.id, { requestId: randomUUID(), version: current.version, action: "keep", reason: "Keep original", sources: current.sources.map(source => ({ id: source.id, version: source.currentVersion })) }, f.c);
  const after = f.preview(); expect(after.debts.map(debt => debt.id)).toContain(current.id); expect(after.sources).toHaveLength(0);
});

it("returns all 501 candidates and permits a smaller explicit selection without silently truncating", () => {
  const f = fixture(); for (let i = 0; i < 501; i++) f.purchase();
  const p = f.preview(); expect(p.sources).toHaveLength(501); expect(p.eligibleTotal).toBe(50100);
  expect(() => groupDebt(f.owner, f.sheet.id, f.group(p), f.c)).toThrow();
  const selected = periodSelection(p, new Set(p.sources.slice(0, 500).map(source => `${source.transactionId}:${source.position}`)));
  expect(selected).toMatchObject({ count: 500, gross: 50000n, paid: 0n });
  const result = groupDebt(f.owner, f.sheet.id, { ...f.group(p), sources: selected.sources.map(({ transactionId, version, position }) => ({ transactionId, version, position })) }, f.c);
  expect(result.total).toBe(50000); expect(result.sources).toHaveLength(500);
  expect(f.preview().sources).toHaveLength(1);
});
