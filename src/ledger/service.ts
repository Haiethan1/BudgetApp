import { randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, exists, gte, isNull, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { getDatabase, type openDatabase } from "../db/client";
import { buckets, categories, financialAccounts, importBatches, importRows, splits, transactions } from "../db/schema";
import { requireSheetAccess, SheetError } from "../sheets/service";
import { deleteInput, ledgerFilters, monthSchema, parseMoney, transactionInput, updateInput } from "./input";

type Connection = ReturnType<typeof openDatabase>;
type Split = Pick<typeof splits.$inferSelect, "categoryId" | "bucketId" | "amount">;
function findTransaction(sheetId: string, id: string, connection: Connection) {
  const record = connection.db.select().from(transactions).where(and(eq(transactions.sheetId, sheetId), eq(transactions.id, z.uuid().parse(id)), isNull(transactions.deletedAt))).get();
  if (!record) throw new SheetError("This transaction is no longer available. Reload transactions.", 404);
  return record;
}
function readSplits(id: string, connection: Connection) {
  return connection.db.select({ id: splits.id, categoryId: splits.categoryId, categoryName: categories.name, categoryArchived: categories.isArchived, bucketId: splits.bucketId, bucketName: buckets.name, bucketArchived: buckets.isArchived, amount: splits.amount }).from(splits)
    .innerJoin(categories, eq(categories.id, splits.categoryId)).innerJoin(buckets, eq(buckets.id, splits.bucketId)).where(eq(splits.transactionId, id)).orderBy(asc(splits.position)).all();
}
export function readTransaction(userId: string, sheetId: string, id: string, connection: Connection = getDatabase()) {
  requireSheetAccess({ userId, sheetId }, connection);
  const record = findTransaction(sheetId, id, connection);
  const account = connection.db.select().from(financialAccounts).where(eq(financialAccounts.id, record.accountId)).get();
  if (!account) throw new Error("Missing transaction account.");
  return { ...record, accountName: account.name, accountArchived: account.isArchived, splits: readSplits(id, connection) };
}
function normalize(input: z.infer<typeof transactionInput>, currency: string) {
  let amount: number; let allocations: Split[];
  try { amount = parseMoney(input.amount, currency); allocations = input.splits.map((split) => ({ ...split, amount: parseMoney(split.amount, currency) })); }
  catch (error) { if (error instanceof Error) throw new SheetError(error instanceof z.ZodError ? "Enter nonzero amounts within the supported range." : error.message, 400); throw error; }
  if ((input.kind === "expense" && amount >= 0) || ((input.kind === "refund" || input.kind === "income") && amount <= 0)) throw new SheetError("The transaction amount does not match its kind.", 400);
  if (allocations.some((split) => Math.sign(split.amount) !== Math.sign(amount))) throw new SheetError("All allocations must use the transaction's sign.", 400);
  if (allocations.reduce((total, split) => total + BigInt(split.amount), 0n) !== BigInt(amount)) throw new SheetError("Allocations must add up exactly to the transaction amount.", 400);
  return { accountId: input.accountId, date: input.date, payee: input.payee, kind: input.kind, amount, splits: allocations };
}
function validateReferences(sheetId: string, input: ReturnType<typeof normalize>, previous: ReturnType<typeof readTransaction> | undefined, connection: Connection) {
  const account = connection.db.select().from(financialAccounts).where(and(eq(financialAccounts.sheetId, sheetId), eq(financialAccounts.id, input.accountId))).get();
  if (!account) throw new SheetError("Choose an account from this sheet.", 400);
  if (account.isArchived && previous?.accountId !== input.accountId) throw new SheetError("Choose an active account.", 400);
  const unchanged = [...(previous?.splits ?? [])];
  for (const split of input.splits) {
    const category = connection.db.select().from(categories).where(and(eq(categories.sheetId, sheetId), eq(categories.id, split.categoryId))).get();
    const bucket = connection.db.select().from(buckets).where(and(eq(buckets.sheetId, sheetId), eq(buckets.id, split.bucketId))).get();
    if (!category || !bucket) throw new SheetError("Choose categories and attribution from this sheet.", 400);
    if (category.isArchived || bucket.isArchived) {
      const index = unchanged.findIndex((old) => old.categoryId === split.categoryId && old.bucketId === split.bucketId && old.amount === split.amount);
      if (index < 0) throw new SheetError("Archived allocations can stay unchanged. Choose active labels for a new or changed allocation.", 400);
      unchanged.splice(index, 1);
    }
  }
}
export function validateNewTransaction(userId: string, sheetId: string, input: unknown, connection: Connection = getDatabase()) {
  const { sheet } = requireSheetAccess({ userId, sheetId }, connection);
  const parsed = transactionInput.parse(input);
  const normalized = normalize(parsed, sheet.currency);
  validateReferences(sheetId, normalized, undefined, connection);
  return { parsed, normalized };
}
export function saveTransaction(userId: string, sheetId: string, input: unknown, editing?: { id: string }, connection: Connection = getDatabase()) {
  const parsed = editing ? updateInput.parse(input) : transactionInput.parse(input);
  return connection.sqlite.transaction(() => {
    const { sheet } = requireSheetAccess({ userId, sheetId }, connection);
    const previous = editing ? readTransaction(userId, sheetId, editing.id, connection) : undefined;
    if (previous && (!("version" in parsed) || parsed.version !== previous.version)) throw new SheetError("Someone updated this transaction. Reload latest before saving.", 409);
    const normalized = normalize(parsed, sheet.currency);
    validateReferences(sheetId, normalized, previous, connection);
    const { splits: allocations, ...values } = normalized;
    const id = previous?.id ?? randomUUID(); const now = new Date();
    if (previous) {
      connection.db.update(transactions).set({ ...values, version: previous.version + 1, updatedAt: now }).where(eq(transactions.id, id)).run();
      connection.db.delete(splits).where(eq(splits.transactionId, id)).run();
    } else connection.db.insert(transactions).values({ ...values, id, sheetId, creatorId: userId, createdAt: now, updatedAt: now }).run();
    connection.db.insert(splits).values(allocations.map((split, position) => ({ ...split, id: randomUUID(), sheetId, transactionId: id, position }))).run();
    return readTransaction(userId, sheetId, id, connection);
  }).immediate();
}
export function deleteTransaction(userId: string, sheetId: string, id: string, input: unknown, connection: Connection = getDatabase()) {
  const { version } = deleteInput.parse(input);
  connection.sqlite.transaction(() => {
    requireSheetAccess({ userId, sheetId }, connection); const current = findTransaction(sheetId, id, connection);
    if (version !== current.version) throw new SheetError("Someone updated this transaction. Reload latest before deleting.", 409);
    connection.db.update(transactions).set({ deletedAt: new Date(), updatedAt: new Date(), version: current.version + 1 }).where(eq(transactions.id, id)).run();
  }).immediate();
}
export function listTransactions(userId: string, sheetId: string, filters: unknown = {}, connection: Connection = getDatabase()) {
  requireSheetAccess({ userId, sheetId }, connection); const query = ledgerFilters.parse(filters);
  const constraints = [eq(transactions.sheetId, sheetId), isNull(transactions.deletedAt)];
  if (query.batchId) {
    const batch = connection.db.select().from(importBatches).where(and(eq(importBatches.sheetId, sheetId), eq(importBatches.id, query.batchId))).get();
    if (!batch) throw new SheetError("This import is unavailable.", 404);
    constraints.push(exists(connection.db.select({ id: importRows.id }).from(importRows).where(and(eq(importRows.sheetId, sheetId), eq(importRows.batchId, query.batchId), eq(importRows.transactionId, transactions.id)))));
  }
  if (query.payee) constraints.push(sql`${transactions.payee} LIKE ${`%${query.payee.replaceAll("!", "!!").replaceAll("%", "!%").replaceAll("_", "!_")}%`} ESCAPE '!'`);
  if (query.from) constraints.push(gte(transactions.date, query.from));
  if (query.to) constraints.push(lte(transactions.date, query.to));
  if (query.accountId) constraints.push(eq(transactions.accountId, query.accountId));
  if (query.kind) constraints.push(eq(transactions.kind, query.kind));
  if (query.categoryId || query.bucketId) constraints.push(exists(connection.db.select({ id: splits.id }).from(splits).where(and(eq(splits.transactionId, transactions.id), query.categoryId ? eq(splits.categoryId, query.categoryId) : undefined, query.bucketId ? eq(splits.bucketId, query.bucketId) : undefined))));
  const where = and(...constraints);
  const total = connection.db.select({ total: count() }).from(transactions).where(where).get()?.total ?? 0;
  const records = connection.db.select({ id: transactions.id }).from(transactions).where(where).orderBy(desc(transactions.date), desc(transactions.createdAt), asc(transactions.id)).limit(50).offset((query.page - 1) * 50).all();
  const hasTransactions = Boolean(connection.db.select({ id: transactions.id }).from(transactions).where(and(eq(transactions.sheetId, sheetId), isNull(transactions.deletedAt))).limit(1).get());
  return { transactions: records.map(({ id }) => readTransaction(userId, sheetId, id, connection)), total, hasTransactions, page: query.page, pageSize: 50 };
}
function safeAggregate(amount: bigint) {
  const number = Number(amount); if (!Number.isSafeInteger(number)) throw new SheetError("Spending totals exceed the supported range. Review the amounts in this sheet.", 400); return number;
}
export function calculateSpending(userId: string, sheetId: string, month: string, connection: Connection = getDatabase()) {
  requireSheetAccess({ userId, sheetId }, connection); const selected = monthSchema.parse(month);
  const rows = connection.db.select({ categoryId: splits.categoryId, bucketId: splits.bucketId, amount: splits.amount, kind: transactions.kind }).from(splits).innerJoin(transactions, eq(transactions.id, splits.transactionId)).where(and(eq(transactions.sheetId, sheetId), isNull(transactions.deletedAt), gte(transactions.date, `${selected}-01`), lte(transactions.date, `${selected}-31`))).all();
  const categoryTotals = new Map<string, bigint>(); const bucketTotals = new Map<string, bigint>(); let total = 0n;
  for (const row of rows) {
    if (row.kind !== "expense" && row.kind !== "refund") continue;
    const spending = -BigInt(row.amount); total += spending;
    categoryTotals.set(row.categoryId, (categoryTotals.get(row.categoryId) ?? 0n) + spending);
    bucketTotals.set(row.bucketId, (bucketTotals.get(row.bucketId) ?? 0n) + spending);
  }
  const defaultCategory = connection.db.select().from(categories).where(and(eq(categories.sheetId, sheetId), eq(categories.isProtected, true))).get();
  return { month: selected, total: safeAggregate(total), uncategorized: safeAggregate(defaultCategory ? categoryTotals.get(defaultCategory.id) ?? 0n : 0n), categories: Object.fromEntries([...categoryTotals].map(([id, amount]) => [id, safeAggregate(amount)])), buckets: Object.fromEntries([...bucketTotals].map(([id, amount]) => [id, safeAggregate(amount)])) };
}


