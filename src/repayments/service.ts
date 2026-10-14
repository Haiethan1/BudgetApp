import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { getDatabase, type openDatabase } from "../db/client";
import { buckets, splits, transactions } from "../db/schema";
import { requireSheetAccess, SheetError } from "../sheets/service";
import { readTransaction } from "../ledger/service";
import { owedFilters, repaymentInput, trackingInput, type RepaymentRecord } from "./input";
type Connection = ReturnType<typeof openDatabase>;
function safeTotal(amount: bigint) { const value = Number(amount); if (!Number.isSafeInteger(value)) throw new SheetError("Repayment totals exceed the supported range. Review this sheet's amounts.", 400); return value; }
export function saveRepayment(userId: string, sheetId: string, id: string, input: unknown, connection: Connection = getDatabase()) {
  const parsed = repaymentInput.parse(input);
  return connection.sqlite.transaction(() => {
    const current = readTransaction(userId, sheetId, id, connection);
    if (current.version !== parsed.version) throw new SheetError("Someone updated this expense. Reload latest before saving.", 409);
    if (current.kind !== "expense") throw new SheetError("Only expenses can be marked paid back. This transaction's kind has changed.", 409);
    if (parsed.repaymentDate && parsed.repaymentDate < current.date) throw new SheetError("Repayment date must be on or after the expense date.", 400);
    connection.db.update(transactions).set({ repaymentDate: parsed.repaymentDate, repaymentComment: parsed.comment, version: current.version + 1, updatedAt: new Date() }).where(eq(transactions.id, current.id)).run();
    return readTransaction(userId, sheetId, id, connection);
  }).immediate();
}
export function saveTracking(userId: string, sheetId: string, input: unknown, connection: Connection = getDatabase()) {
  const parsed = trackingInput.parse(input);
  connection.sqlite.transaction(() => {
    requireSheetAccess({ userId, sheetId }, connection);
    for (const item of parsed.buckets) {
      const current = connection.db.select().from(buckets).where(and(eq(buckets.id, item.id), eq(buckets.sheetId, sheetId))).get();
      if (!current) throw new SheetError("This spending group is unavailable in this sheet.", 404);
      if (current.trackingVersion !== item.version) throw new SheetError("Someone changed tracked spending groups. Reload latest before saving.", 409);
      connection.db.update(buckets).set({ trackRepayment: item.tracked, trackingVersion: current.trackingVersion + 1 }).where(eq(buckets.id, item.id)).run();
    }
  }).immediate();
}
export function listOwed(userId: string, sheetId: string, input: unknown = {}, connection: Connection = getDatabase()) {
  requireSheetAccess({ userId, sheetId }, connection);
  const filters = owedFilters.parse(input);
  const labels = connection.db.select().from(buckets).where(eq(buckets.sheetId, sheetId)).orderBy(asc(buckets.name), asc(buckets.id)).all();
  if (filters.bucket !== "all" && filters.bucket !== "tracked" && !labels.some(({ id }) => id === filters.bucket)) throw new SheetError("Choose a spending group from this sheet.", 400);
  const rows = connection.db.select({ id: transactions.id, version: transactions.version, date: transactions.date, payee: transactions.payee, amount: transactions.amount, repaymentDate: transactions.repaymentDate, repaymentComment: transactions.repaymentComment, bucketId: splits.bucketId, bucketName: buckets.name, allocation: splits.amount }).from(transactions).innerJoin(splits, eq(splits.transactionId, transactions.id)).innerJoin(buckets, eq(buckets.id, splits.bucketId)).where(and(eq(transactions.sheetId, sheetId), eq(transactions.kind, "expense"), isNull(transactions.deletedAt))).orderBy(desc(transactions.date), desc(transactions.createdAt), asc(transactions.id), asc(splits.position)).all();
  const totals = new Map(labels.map(({ id }) => [id, { outstanding: 0n, paid: 0n }]));
  const records = new Map<string, RepaymentRecord>();
  const tracked = new Set(labels.filter(({ trackRepayment }) => trackRepayment).map(({ id }) => id));
  for (const row of rows) {
    const amount = -BigInt(row.allocation); const total = totals.get(row.bucketId);
    if (total) { if (row.repaymentDate) total.paid += amount; else total.outstanding += amount; }
    if ((filters.bucket === "tracked" && !tracked.has(row.bucketId)) || (filters.bucket !== "tracked" && filters.bucket !== "all" && row.bucketId !== filters.bucket)) continue;
    if ((filters.status === "paid" && !row.repaymentDate) || (filters.status === "outstanding" && row.repaymentDate)) continue;
    let record = records.get(row.id);
    if (!record) { record = { id: row.id, version: row.version, date: row.date, payee: row.payee, amount: row.amount, repaymentDate: row.repaymentDate, repaymentComment: row.repaymentComment, allocations: [] }; records.set(row.id, record); }
    const existing = record.allocations.find(({ bucketId }) => bucketId === row.bucketId);
    if (existing) existing.amount = safeTotal(BigInt(existing.amount) + amount);
    else record.allocations.push({ bucketId: row.bucketId, bucketName: row.bucketName, amount: safeTotal(amount) });
  }
  let outstanding = 0n; let paid = 0n;
  const bucketRows = labels.map((label) => { const total = totals.get(label.id) ?? { outstanding: 0n, paid: 0n }; if (label.trackRepayment) { outstanding += total.outstanding; paid += total.paid; } return { ...label, outstanding: safeTotal(total.outstanding), paid: safeTotal(total.paid) }; });
  return { buckets: bucketRows, outstanding: safeTotal(outstanding), paid: safeTotal(paid), transactions: [...records.values()].slice((filters.page - 1) * 50, filters.page * 50), total: records.size, page: filters.page, pageSize: 50 };
}
