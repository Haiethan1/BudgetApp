import { z } from "zod";
import { parseMoney, transactionInput } from "./input";
import { decimalAmount, localDate, recordDraft, type Draft, type LedgerRecord } from "./presentation";

export type ExpenseDraft = { payee: string; total: string; notes: string; date: string; accountId: string; shares: Record<string, string> };
export function isGridExpense(record: LedgerRecord): record is LedgerRecord & { kind: "expense" | "refund" } {
  return record.kind === "expense" || record.kind === "refund";
}
export function signedDecimal(value: number | bigint, currency: string) { return `${BigInt(value) < 0n ? "-" : ""}${decimalAmount(value, currency)}`; }
export function expenseShares(record: LedgerRecord) {
  const shares = new Map<string, bigint>();
  for (const split of record.splits) shares.set(split.bucketId, (shares.get(split.bucketId) ?? 0n) - BigInt(split.amount));
  return shares;
}
export function expenseDraft({ record, currency, accountId = "" }: { record: LedgerRecord | null; currency: string; accountId?: string }): ExpenseDraft {
  if (record && !isGridExpense(record)) throw new Error("Income and transfers must be edited in Details to preserve their transaction kind.");
  return record ? { payee: record.payee, total: signedDecimal(-record.amount, currency), notes: record.notes, date: record.date, accountId: record.accountId, shares: Object.fromEntries([...expenseShares(record)].map(([id, amount]) => [id, signedDecimal(amount, currency)])) }
    : { payee: "", total: "", notes: "", date: localDate(), accountId, shares: {} };
}
function parseShares(draft: ExpenseDraft, currency: string) {
  return Object.entries(draft.shares).filter(([, amount]) => amount !== "").map(([bucketId, amount]) => ({ bucketId, amount: parseMoney(amount, currency) }));
}
export function gridBalance(draft: ExpenseDraft, currency: string) {
  try {
    const total = BigInt(parseMoney(draft.total, currency));
    const shares = parseShares(draft, currency);
    if (shares.some(share => Math.sign(share.amount) !== (total < 0n ? -1 : 1))) return { valid: false, remaining: null, message: "Every share must have the same sign as Total." };
    const remaining = total - shares.reduce((sum, share) => sum + BigInt(share.amount), 0n);
    return { valid: remaining === 0n, remaining, message: remaining === 0n ? "All shares match Total." : `Still to assign: ${signedDecimal(remaining, currency)} ${currency}` };
  } catch { return { valid: false, remaining: null, message: "Enter complete, nonzero amounts with the currency's precision. Leave unused shares blank." }; }
}
export function remainingUnderMe(draft: ExpenseDraft, currency: string, meId: string): ExpenseDraft {
  const total = BigInt(parseMoney(draft.total, currency));
  const others = parseShares({ ...draft, shares: { ...draft.shares, [meId]: "" } }, currency);
  if (others.some(share => Math.sign(share.amount) !== (total < 0n ? -1 : 1))) throw new Error("Every share must have the same sign as Total.");
  const remainder = total - others.reduce((sum, share) => sum + BigInt(share.amount), 0n);
  if (remainder !== 0n && (remainder < 0n) !== (total < 0n)) throw new Error("The other shares exceed Total. Reduce them first.");
  return { ...draft, shares: { ...draft.shares, [meId]: remainder === 0n ? "" : signedDecimal(remainder, currency) } };
}

function allocations(draft: ExpenseDraft, record: LedgerRecord | null, currency: string, categoryId: string) {
  const original = record ? expenseShares(record) : new Map<string, bigint>();
  const requested = new Map(parseShares(draft, currency).map(share => [share.bucketId, BigInt(share.amount)]));
  const changed = new Set([...new Set([...original.keys(), ...requested.keys()])].filter(id => (original.get(id) ?? 0n) !== (requested.get(id) ?? 0n)));
  const complex: string[] = [];
  for (const id of changed) {
    const old = record?.splits.filter(split => split.bucketId === id) ?? [];
    if (new Set(old.map(split => split.categoryId)).size > 1 || old.some(split => split.categoryArchived || split.bucketArchived)) complex.push(id);
  }
  const handled = new Set<string>();
  const splits: z.infer<typeof transactionInput>["splits"] = [];
  for (const split of record?.splits ?? []) {
    if (!changed.has(split.bucketId) || complex.includes(split.bucketId)) { splits.push({ categoryId: split.categoryId, bucketId: split.bucketId, amount: signedDecimal(split.amount, currency) }); continue; }
    if (handled.has(split.bucketId)) continue;
    handled.add(split.bucketId);
    const amount = requested.get(split.bucketId);
    if (amount) splits.push({ categoryId: split.categoryId, bucketId: split.bucketId, amount: signedDecimal(-amount, currency) });
  }
  for (const [bucketId, amount] of requested) if (!original.has(bucketId)) splits.push({ categoryId, bucketId, amount: signedDecimal(-amount, currency) });
  return { splits, complex };
}
export function gridTransaction(draft: ExpenseDraft, record: LedgerRecord | null, currency: string, categoryId: string) {
  if (record && !isGridExpense(record)) throw new Error("Income and transfers must be edited in Details to preserve their transaction kind.");
  const allocation = allocations(draft, record, currency, categoryId);
  if (allocation.complex.length) throw new Error("Edit category allocation in Details. Existing categories and archived shares have been preserved.");
  if (!gridBalance(draft, currency).valid) throw new Error(gridBalance(draft, currency).message);
  const amount = parseMoney(draft.total, currency);
  return transactionInput.parse({ accountId: draft.accountId, date: draft.date, payee: draft.payee, notes: draft.notes, kind: amount > 0 ? "expense" : "refund", amount: signedDecimal(-amount, currency), splits: allocation.splits });
}
export function gridDetails(draft: ExpenseDraft, record: LedgerRecord | null, currency: string, defaults: { categoryId: string; bucketId: string }): { draft: Draft; hint: string } {
  const allocation = allocations(draft, record, currency, defaults.categoryId);
  const amount = parseMoney(draft.total, currency);
  const base = record ? recordDraft(record, currency) : { kind: "expense", direction: "out", splitMode: true, splits: [] } satisfies Pick<Draft, "kind" | "direction" | "splitMode" | "splits">;
  return { draft: { ...base, kind: amount > 0 ? "expense" : "refund", direction: amount > 0 ? "out" : "in", payee: draft.payee, notes: draft.notes, date: draft.date, accountId: draft.accountId, amount: decimalAmount(amount, currency), splitMode: true, splits: allocation.splits.map((split, index) => ({ ...split, key: `grid-${index}`, amount: decimalAmount(parseMoney(split.amount, currency), currency) })) },
    hint: allocation.complex.length ? "Some person totals span categories or archived labels. Their original allocations are preserved below. Enter the intended category amounts explicitly before saving." : "Your expense row draft is ready for detailed editing." };
}
