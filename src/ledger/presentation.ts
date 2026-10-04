import { z } from "zod";
import { currencyPrecision, parseMoney, transactionInput, transactionKindSchema } from "./input";

export const ledgerRecordSchema = z.object({ id: z.uuid(), accountId: z.uuid(), accountName: z.string(), accountArchived: z.boolean(), date: z.string(), payee: z.string(), kind: transactionKindSchema, amount: z.number().int(), version: z.number().int(), splits: z.array(z.object({ categoryId: z.uuid(), categoryName: z.string(), categoryArchived: z.boolean(), bucketId: z.uuid(), bucketName: z.string(), bucketArchived: z.boolean(), amount: z.number().int() })).min(1) });
export const ledgerPageSchema = z.object({ transactions: z.array(ledgerRecordSchema), total: z.number().int(), hasTransactions: z.boolean(), page: z.number().int(), pageSize: z.literal(50) });
export type LedgerRecord = z.infer<typeof ledgerRecordSchema>;
export type Draft = { kind: z.infer<typeof transactionKindSchema>; date: string; accountId: string; payee: string; amount: string; direction: "in" | "out"; splits: { key: string; amount: string; categoryId: string; bucketId: string }[]; splitMode: boolean };
export function localDate(date = new Date()) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
export function decimalAmount(amount: number | bigint, currency: string) {
  const precision = currencyPrecision(currency); const signed = BigInt(amount); const units = signed < 0n ? -signed : signed;
  const factor = 10n ** BigInt(precision); return `${units / factor}${precision ? `.${String(units % factor).padStart(precision, "0")}` : ""}`;
}
export function displayAmount(amount: number, currency: string, signed = false) {
  const formatter = new Intl.NumberFormat("en-US", { style: "currency", currency, signDisplay: signed ? "always" : "auto" });
  const precision = currencyPrecision(currency); const units = BigInt(amount); const magnitude = units < 0n ? -units : units; const factor = 10n ** BigInt(precision);
  const whole = magnitude / factor; const fraction = String(magnitude % factor).padStart(precision, "0");
  return formatter.formatToParts(units < 0n ? (whole === 0n ? -0 : -whole) : whole).map((part) => part.type === "fraction" ? fraction : part.value).join("");
}
export function recordDraft(record: LedgerRecord, currency: string): Draft {
  return { kind: record.kind, date: record.date, accountId: record.accountId, payee: record.payee, amount: decimalAmount(record.amount, currency), direction: record.amount > 0 ? "in" : "out", splitMode: record.splits.length > 1, splits: record.splits.map((split, index) => ({ ...split, key: `existing-${index}`, amount: decimalAmount(split.amount, currency) })) };
}
export function newDraft({ accountIds, categoryId, bucketId, date = localDate() }: { accountIds: string[]; categoryId: string; bucketId: string; date?: string }): Draft {
  return { kind: "expense", date, accountId: accountIds.length === 1 ? accountIds[0] ?? "" : "", payee: "", amount: "", direction: "out", splitMode: false, splits: [{ key: "initial", amount: "", categoryId, bucketId }] };
}
export function allocationBalance(draft: Draft, currency: string) {
  try {
    const amount = BigInt(parseMoney(draft.amount, currency));
    if (amount <= 0n) return { valid: false, message: "Enter a positive amount." };
    if (!draft.splitMode || (draft.kind !== "expense" && draft.kind !== "refund")) return { valid: true, message: "" };
    const sum = draft.splits.reduce((total, split) => {
      const units = BigInt(parseMoney(split.amount, currency)); if (units <= 0n) throw new Error("Enter positive split amounts."); return total + units;
    }, 0n);
    const remaining = amount - sum;
    return { valid: remaining === 0n, message: `Allocated ${decimalAmount(sum, currency)} ${currency} · ${remaining < 0n ? "Over by" : "Remaining"} ${decimalAmount(remaining, currency)} ${currency}` };
  } catch { return { valid: false, message: "Enter valid positive amounts with the currency's precision." }; }
}
export function draftInput(draft: Draft, currency: string, defaults: { categoryId: string; bucketId: string }) {
  if (parseMoney(draft.amount, currency) <= 0) throw new Error("Enter a positive amount.");
  const negative = draft.kind === "expense" || (draft.kind === "transfer" && draft.direction === "out");
  function signed(amount: string) { if (parseMoney(amount, currency) <= 0) throw new Error("Enter positive allocation amounts."); return `${negative ? "-" : ""}${amount}`; }
  const excluded = draft.kind === "income" || draft.kind === "transfer";
  const allocations = excluded ? [{ ...defaults, amount: draft.amount }] : draft.splitMode ? draft.splits : draft.splits.slice(0, 1).map((split) => ({ ...split, amount: draft.amount }));
  const result = transactionInput.parse({ ...draft, amount: signed(draft.amount), splits: allocations.map((split) => ({ categoryId: split.categoryId, bucketId: split.bucketId, amount: signed(split.amount) })) });
  if (!allocationBalance(draft, currency).valid) throw new Error("Allocations must add up exactly to the transaction amount.");
  return result;
}
