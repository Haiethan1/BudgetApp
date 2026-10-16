import { createHash, randomUUID } from "node:crypto";
import { and, asc, desc, eq, isNull, count, sql } from "drizzle-orm";
import { z } from "zod";
import { getDatabase, type openDatabase } from "../db/client";
import { buckets, debts, debtSources, debtPayments, debtChanges, debtRequests, debtLegacyMetadata, splits, transactions } from "../db/schema";
import { requireSheetAccess, SheetError } from "../sheets/service";
import { parseMoney, currencyPrecision, decimalSchema } from "../ledger/input";
import { displayAmount } from "../ledger/presentation";
import { correctionInput, createDebtInput, debtFilters, editDebtInput, groupDebtInput, paymentInput, previewDebtInput, resolutionInput, type DebtRecord } from "./debt-input";
type Connection = ReturnType<typeof openDatabase>;
function safe(value: bigint) { const n = Number(value); if (!Number.isSafeInteger(n)) throw new SheetError("Debt totals exceed the supported range.", 400); return n; }
function money(value: string, currency: string, allowZero = false) { if (allowZero && /^0(?:\.0+)?$/.test(value)) { decimalSchema.parse(value); if ((value.split(".")[1]?.length ?? 0) > currencyPrecision(currency)) throw new SheetError(`Use at most ${currencyPrecision(currency)} decimal places for ${currency}.`, 400); return 0; } try { return parseMoney(value, currency); } catch (e) { throw new SheetError(e instanceof Error ? e.message : "Enter an exact currency amount.", 400); } }
function positive(value: number) { if (value <= 0) throw new SheetError("Enter an amount greater than zero.", 400); return value; }
function row(sheetId: string, id: string, c: Connection) { const d = c.db.select().from(debts).where(and(eq(debts.sheetId, sheetId), eq(debts.id, z.uuid().parse(id)))).get(); if (!d) throw new SheetError("This debt is no longer available.", 404); return d; }
function active(sheetId: string, id: string, version: number, c: Connection) { const d = row(sheetId, id, c); if (d.groupedInto || d.version !== version) throw new SheetError("Someone updated or grouped this debt. Reload latest before saving.", 409); return d; }
function change(sheetId: string, id: string, description: string, c: Connection) { c.db.insert(debtChanges).values({ id: randomUUID(), sheetId, debtId: id, description, createdAt: Date.now() }).run(); }
function bump(d: typeof debts.$inferSelect, c: Connection) { c.db.update(debts).set({ version: d.version + 1, updatedAt: Date.now() }).where(eq(debts.id, d.id)).run(); }
function totalsValid(total: number, paid: number) { if (paid < 0 || paid > total) throw new SheetError("Paid so far must stay between zero and the agreed total. Correct repayments before reducing the total.", 400); }
function mutation(userId: string, sheetId: string, input: { requestId: string }, operation: string, c: Connection, work: (currency: string) => string) {
  return c.sqlite.transaction(() => {
    const { sheet } = requireSheetAccess({ userId, sheetId }, c);
    const hash = createHash("sha256").update(JSON.stringify({ operation, input })).digest("hex");
    const request = c.db.select().from(debtRequests).where(and(eq(debtRequests.sheetId, sheetId), eq(debtRequests.id, input.requestId))).get();
    if (request) { if (request.hash !== hash) throw new SheetError("This request was already used for different changes. Reload latest.", 409); return readDebt(userId, sheetId, request.debtId, c); }
    const id = work(sheet.currency);
    c.db.insert(debtRequests).values({ id: input.requestId, sheetId, hash, debtId: id }).run();
    return readDebt(userId, sheetId, id, c);
  }).immediate();
}
export function readDebt(userId: string, sheetId: string, id: string, c: Connection = getDatabase()): DebtRecord {
  requireSheetAccess({ userId, sheetId }, c); const d = row(sheetId, id, c);
  const payments = c.db.select().from(debtPayments).where(eq(debtPayments.debtId, id)).orderBy(asc(sql`rowid`)).all();
  const paid = safe(payments.reduce((n, p) => n + BigInt(p.amount), 0n));
  const effective = new Map(payments.filter(p => p.kind !== "correction").map(p => [p.id, { amount: p.amount, date: p.date }]));
  for (const p of payments) if (p.kind === "correction" && p.replaces && p.replacementAmount !== null) effective.set(p.replaces, { amount: p.replacementAmount, date: p.date });
  const dates = [...effective.values()].filter(p => p.amount !== 0).map(p => p.date).sort();
  const sources = c.db.select().from(debtSources).where(eq(debtSources.debtId, id)).orderBy(asc(debtSources.transactionId), asc(debtSources.position)).all().map(s => {
    const t = c.db.select().from(transactions).where(and(eq(transactions.sheetId, sheetId), eq(transactions.id, s.transactionId))).get();
    if (!t) throw new Error("Missing debt source transaction.");
    const legacy = c.db.select().from(debtLegacyMetadata).where(eq(debtLegacyMetadata.transactionId, t.id)).get();
    const split = c.db.select().from(splits).where(and(eq(splits.transactionId, t.id), eq(splits.position, s.position))).get();
    return { ...s, currentVersion: t.version, currentAmount: !t.deletedAt && t.kind === "expense" && split ? -split.amount : 0, currentPayee: t.payee, currentDate: t.date, currentKind: t.kind, deleted: t.deletedAt !== null, changed: t.version !== s.acceptedVersion, legacyDate: legacy?.date ?? t.repaymentDate, legacyComment: legacy?.comment ?? t.repaymentComment };
  });
  const changes = c.db.select().from(debtChanges).where(eq(debtChanges.debtId, id)).orderBy(asc(debtChanges.createdAt), asc(debtChanges.id)).all();
  const cancelled = changes.filter(v => v.description.startsWith("Adopted current source amounts")).at(-1);
  return { ...d, paid, remaining: safe(BigInt(d.total) - BigInt(paid)), completionDate: paid === d.total ? dates.at(-1) ?? (cancelled ? new Date(cancelled.createdAt).toISOString().slice(0, 10) : null) : null, sources, payments, needsReview: sources.some(s => s.changed), changes };
}
export function createDebt(userId: string, sheetId: string, input: unknown, c: Connection = getDatabase()) {
  const p = createDebtInput.parse(input);
  return mutation(userId, sheetId, p, "create", c, currency => {
    const total = positive(money(p.total, currency)); const paid = p.opening ? positive(money(p.opening.amount, currency)) : 0; totalsValid(total, paid);
    const id = randomUUID(), now = Date.now(); c.db.insert(debts).values({ id, sheetId, description: p.description, debtor: p.debtor, recipient: p.recipient, total, createdAt: now, updatedAt: now }).run();
    if (p.opening) c.db.insert(debtPayments).values({ id: randomUUID(), sheetId, debtId: id, kind: "opening", amount: paid, date: p.opening.date, comment: p.opening.comment, reason: "Explicit opening amount already repaid", createdAt: now }).run();
    return id;
  });
}
export function editDebt(userId: string, sheetId: string, id: string, input: unknown, c: Connection = getDatabase()) {
  const p = editDebtInput.parse(input);
  return mutation(userId, sheetId, p, `edit:${id}`, c, currency => {
    const d = active(sheetId, id, p.version, c), current = readDebt(userId, sheetId, id, c), total = d.total === 0 ? money(p.total, currency, true) : positive(money(p.total, currency));
    if (total < 0) throw new SheetError("The agreed total cannot be negative.", 400);
    if (current.sources.length && total !== d.total) throw new SheetError("Review linked sources to change their agreed total.", 400);
    totalsValid(total, current.paid);
    c.db.update(debts).set({ description: p.description, debtor: p.debtor, recipient: p.recipient, total, legacy: false, version: d.version + 1, updatedAt: Date.now() }).where(eq(debts.id, id)).run();
    change(sheetId, id, `Agreement edited from "${d.description}" (${d.debtor} owes ${d.recipient ?? "Needs clarification"}, total ${displayAmount(d.total, currency)}) to "${p.description}" (${p.debtor} owes ${p.recipient}, total ${displayAmount(total, currency)}). Reason: ${p.reason}`, c); return id;
  });
}
export function recordPayment(userId: string, sheetId: string, id: string, input: unknown, c: Connection = getDatabase()) {
  const p = paymentInput.parse(input);
  return mutation(userId, sheetId, p, `payment:${id}`, c, currency => {
    const d = active(sheetId, id, p.version, c), current = readDebt(userId, sheetId, id, c);
    if (!d.recipient || d.total <= 0) throw new SheetError("Clarify this agreement's direction and total before recording repayments.", 400);
    const amount = positive(money(p.amount, currency)); totalsValid(d.total, safe(BigInt(current.paid) + BigInt(amount)));
    c.db.insert(debtPayments).values({ id: randomUUID(), sheetId, debtId: id, kind: "payment", amount, date: p.date, comment: p.comment, createdAt: Date.now() }).run(); bump(d, c); return id;
  });
}
export function correctPayment(userId: string, sheetId: string, id: string, input: unknown, c: Connection = getDatabase()) {
  const p = correctionInput.parse(input);
  return mutation(userId, sheetId, p, `correction:${id}`, c, currency => {
    const d = active(sheetId, id, p.version, c), current = readDebt(userId, sheetId, id, c);
    const original = current.payments.find(e => e.id === p.paymentId && e.kind !== "correction"); if (!original) throw new SheetError("Choose an original repayment or opening payment to correct.", 400);
    const corrections = current.payments.filter(e => e.replaces === original.id); const prior = corrections.at(-1)?.replacementAmount ?? original.amount;
    const amount = money(p.amount, currency, true); if (amount < 0) throw new SheetError("A corrected repayment must be zero or positive.", 400);
    const paid = safe(BigInt(current.paid) - BigInt(prior) + BigInt(amount));
    totalsValid(d.total, paid);
    c.db.insert(debtPayments).values({ id: randomUUID(), sheetId, debtId: id, kind: "correction", amount: safe(BigInt(amount) - BigInt(prior)), replaces: original.id, replacementAmount: amount, date: p.date, comment: p.comment, reason: p.reason, createdAt: Date.now() }).run(); bump(d, c); return id;
  });
}
type Preview = ReturnType<typeof previewDebtInput.parse>;
function preview(userId: string, sheetId: string, p: Preview, c: Connection) {
  const selected = p.debts.map(v => { active(sheetId, v.id, v.version, c); return readDebt(userId, sheetId, v.id, c); });
  if (new Set(selected.map(d => d.id)).size !== selected.length) throw new SheetError("Select each debt only once.", 400);
  const sources: { transactionId: string; version: number; position: number; amount: number; payee: string; date: string; bucketId: string; bucketName: string }[] = [];
  for (const s of p.sources) {
    const t = c.db.select().from(transactions).where(and(eq(transactions.sheetId, sheetId), eq(transactions.id, s.transactionId), isNull(transactions.deletedAt))).get();
    if (!t || t.kind !== "expense" || t.version !== s.version) throw new SheetError("A source expense changed. Reload the source preview.", 409);
    const claimed = c.db.select().from(debtSources).where(eq(debtSources.transactionId, t.id)).all();
    if (claimed.some(v => v.originalVersion !== t.version)) throw new SheetError("This transaction changed after a debt claimed its portions. Group its existing debts; new portion claims are blocked to prevent counting a moved portion twice.", 409);
    const portions = c.db.select({ position: splits.position, amount: splits.amount, bucketId: splits.bucketId, bucketName: buckets.name }).from(splits).innerJoin(buckets, eq(buckets.id, splits.bucketId)).where(and(eq(splits.transactionId, t.id), s.position === null ? undefined : eq(splits.position, s.position))).orderBy(asc(splits.position)).all();
    if (!portions.length) throw new SheetError("This source portion is no longer available.", 409);
    for (const portion of portions) {
      if (claimed.some(v => v.position === portion.position) || sources.some(v => v.transactionId === t.id && v.position === portion.position)) throw new SheetError("This expense portion already belongs to a debt or was selected twice. Select its existing debt to group it.", 409);
      const amount = positive(-portion.amount); sources.push({ transactionId: t.id, version: t.version, position: portion.position, amount, payee: t.payee, date: t.date, bucketId: portion.bucketId, bucketName: portion.bucketName });
    }
  }
  if (sources.length + selected.reduce((n, d) => n + d.sources.length, 0) > 500) throw new SheetError("Choose at most 500 linked portions in one agreement.", 400);
  return { total: safe([...sources.map(s => s.amount), ...selected.map(d => d.total)].reduce((n, a) => n + BigInt(a), 0n)), paid: safe(selected.reduce((n, d) => n + BigInt(d.paid), 0n)), sources, debts: selected };
}
export function previewDebt(userId: string, sheetId: string, input: unknown, c: Connection = getDatabase()) { return c.sqlite.transaction(() => { requireSheetAccess({ userId, sheetId }, c); return preview(userId, sheetId, previewDebtInput.parse(input), c); })(); }
export function groupDebt(userId: string, sheetId: string, input: unknown, c: Connection = getDatabase()) {
  const p = groupDebtInput.parse(input);
  return mutation(userId, sheetId, p, "group", c, currency => {
    const combined = preview(userId, sheetId, previewDebtInput.parse(p), c); positive(combined.total); totalsValid(combined.total, combined.paid);
    if (combined.debts.some(d => d.debtor !== p.debtor || d.recipient !== p.recipient || d.needsReview || !d.recipient || d.total <= 0)) throw new SheetError("Resolve source reviews and clarify each selected debt with the same debtor and recipient before grouping.", 409);
    const id = randomUUID(), now = Date.now(); c.db.insert(debts).values({ id, sheetId, description: p.description, debtor: p.debtor, recipient: p.recipient, total: combined.total, createdAt: now, updatedAt: now }).run();
    for (const source of combined.sources) c.db.insert(debtSources).values({ id: randomUUID(), sheetId, debtId: id, transactionId: source.transactionId, position: source.position, originalVersion: source.version, acceptedVersion: source.version, amount: source.amount, originalAmount: source.amount, payee: source.payee, date: source.date, bucketId: source.bucketId, bucketName: source.bucketName }).run();
    for (const d of combined.debts) {
      c.db.update(debtSources).set({ debtId: id }).where(eq(debtSources.debtId, d.id)).run(); c.db.update(debtPayments).set({ debtId: id }).where(eq(debtPayments.debtId, d.id)).run(); c.db.update(debtChanges).set({ debtId: id }).where(eq(debtChanges.debtId, d.id)).run();
      c.db.update(debts).set({ groupedInto: id, version: d.version + 1, updatedAt: now }).where(eq(debts.id, d.id)).run(); change(sheetId, id, `Grouped debt ${d.id}: ${d.description}; ${d.debtor} owes ${d.recipient}; total ${displayAmount(d.total, currency)}, paid ${displayAmount(d.paid, currency)}.`, c);
    }
    change(sheetId, id, "Confirmed source preview and grouped agreement. Included source debts no longer count separately.", c); return id;
  });
}
export function resolveDebt(userId: string, sheetId: string, id: string, input: unknown, c: Connection = getDatabase()) {
  const p = resolutionInput.parse(input);
  return mutation(userId, sheetId, p, `resolve:${id}`, c, currency => {
    const d = active(sheetId, id, p.version, c), current = readDebt(userId, sheetId, id, c);
    if (p.sources.length !== current.sources.length || new Set(p.sources.map(s => s.id)).size !== p.sources.length || current.sources.some(s => !p.sources.some(v => v.id === s.id && v.version === s.currentVersion))) throw new SheetError("Source transactions changed after the review preview. Reload latest.", 409);
    if (p.action === "adopt") {
      const total = safe(current.sources.reduce((n, s) => n + BigInt(s.currentAmount), 0n));
      // Standalone portions remain part of groups even when only linked portions are revised.
      const previousSources = safe(current.sources.reduce((n, s) => n + BigInt(s.amount), 0n));
      const revised = safe(BigInt(d.total) - BigInt(previousSources) + BigInt(total));
      if (revised < 0) throw new SheetError("The revised agreement cannot be negative.", 400);
      totalsValid(revised, current.paid);
      c.db.update(debts).set({ total: revised }).where(eq(debts.id, id)).run();
    }
    for (const s of current.sources) c.db.update(debtSources).set({ acceptedVersion: s.currentVersion, ...(p.action === "adopt" ? { amount: s.currentAmount } : {}) }).where(eq(debtSources.id, s.id)).run();
    change(sheetId, id, `${p.action === "keep" ? "Kept agreed total" : "Adopted current source amounts"}. Agreed total before ${displayAmount(d.total, currency)}, after ${displayAmount(row(sheetId, id, c).total, currency)}. Sources: ${current.sources.map(s => `${s.transactionId} portion ${s.position + 1}: agreed ${displayAmount(s.amount, currency)}, current ${displayAmount(s.currentAmount, currency)}, revision ${s.currentVersion}${s.deleted ? " deleted" : ""}`).join("; ")}. Reason: ${p.reason}`, c); bump(d, c); return id;
  });
}
export function listDebts(userId: string, sheetId: string, input: unknown = {}, c: Connection = getDatabase()) {
  return c.sqlite.transaction(() => {
    requireSheetAccess({ userId, sheetId }, c); const p = debtFilters.parse(input);
    const records = c.db.select({ id: debts.id }).from(debts).where(and(eq(debts.sheetId, sheetId), isNull(debts.groupedInto))).all().map(d => readDebt(userId, sheetId, d.id, c));
    const people = new Map<string, bigint>(); for (const d of records) people.set(d.debtor, (people.get(d.debtor) ?? 0n) + BigInt(d.remaining));
    const matching = records.filter(d => !p.debtor || d.debtor === p.debtor);
    const filtered = matching.filter(d => (p.status !== "paid" || d.remaining === 0) && (p.status !== "outstanding" || d.remaining !== 0) && (!p.from || (d.completionDate !== null && d.completionDate >= p.from)) && (!p.to || (d.completionDate !== null && d.completionDate <= p.to))).sort((a, b) => (p.status === "paid" ? (b.completionDate ?? "").localeCompare(a.completionDate ?? "") : b.updatedAt - a.updatedAt) || a.id.localeCompare(b.id));
    return { debts: filtered.slice((p.page - 1) * p.pageSize, p.page * p.pageSize), total: filtered.length, page: p.page, pageSize: p.pageSize, outstanding: safe(matching.reduce((n, d) => n + BigInt(d.remaining), 0n)), paid: safe(matching.reduce((n, d) => n + BigInt(d.paid), 0n)), people: [...people].map(([debtor, amount]) => ({ debtor, outstanding: safe(amount) })), trackedGroups: c.db.select({ id: buckets.id, name: buckets.name }).from(buckets).where(and(eq(buckets.sheetId, sheetId), eq(buckets.trackRepayment, true))).all() };
  })();
}
export function listDebtSources(userId: string, sheetId: string, input: unknown = {}, c: Connection = getDatabase()) {
  requireSheetAccess({ userId, sheetId }, c); const { page } = z.object({ page: z.coerce.number().int().min(1).max(1000000).default(1) }).parse(input);
  const where = and(eq(transactions.sheetId, sheetId), eq(transactions.kind, "expense"), isNull(transactions.deletedAt));
  const total = c.db.select({ n: count() }).from(splits).innerJoin(transactions, eq(transactions.id, splits.transactionId)).where(where).get()?.n ?? 0;
  const sources = c.db.select({ transactionId: transactions.id, version: transactions.version, position: splits.position, amount: splits.amount, payee: transactions.payee, date: transactions.date, bucketId: splits.bucketId, bucketName: buckets.name }).from(splits).innerJoin(transactions, eq(transactions.id, splits.transactionId)).innerJoin(buckets, eq(buckets.id, splits.bucketId)).where(where).orderBy(desc(transactions.date), asc(transactions.id), asc(splits.position)).limit(50).offset((page - 1) * 50).all().map(s => ({ ...s, amount: -s.amount }));
  return { sources, total, page, pageSize: 50 };
}




export function inspectDebtSource(userId: string, sheetId: string, id: string, c: Connection = getDatabase()) {
  const { sheet } = requireSheetAccess({ userId, sheetId }, c);
  const t = c.db.select().from(transactions).where(and(eq(transactions.sheetId, sheetId), eq(transactions.id, z.uuid().parse(id)))).get();
  if (!t) throw new SheetError("This source transaction is unavailable.", 404);
  return { sheet, transaction: t, portions: c.db.select({ position: splits.position, amount: splits.amount, bucket: buckets.name }).from(splits).innerJoin(buckets, eq(buckets.id, splits.bucketId)).where(eq(splits.transactionId, id)).orderBy(asc(splits.position)).all(), legacy: c.db.select().from(debtLegacyMetadata).where(eq(debtLegacyMetadata.transactionId, id)).get() ?? null };
}



