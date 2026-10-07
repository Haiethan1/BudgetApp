import { z } from "zod";

export const minorUnitsSchema = z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER).refine((value) => value !== 0, "Enter a nonzero amount.").brand<"MinorUnits">();
export type MinorUnits = z.infer<typeof minorUnitsSchema>;
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.").refine((value) => {
  const year = Number(value.slice(0, 4)); const month = Number(value.slice(5, 7)); const day = Number(value.slice(8, 10));
  if (year < 1 || month < 1 || month > 12) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day >= 1 && day <= (days[month - 1] ?? 0);
}, "Enter a real calendar date.");
export const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).refine((month) => !month.startsWith("0000"));
export const transactionKindSchema = z.enum(["expense", "refund", "income", "transfer"]);
export const decimalSchema = z.string().max(40).regex(/^-?\d+(\.\d+)?$/, "Enter an amount using digits and a decimal point.");
export function currencyPrecision(currency: string) {
  const precision = new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits;
  if (precision === undefined) throw new Error("Currency precision is unavailable.");
  return precision;
}
export function parseMoney(value: string, currency: string): MinorUnits {
  const parsed = decimalSchema.parse(value); const precision = currencyPrecision(currency);
  const negative = parsed.startsWith("-"); const digits = negative ? parsed.slice(1) : parsed;
  const [whole = "", fraction = ""] = digits.split(".");
  if (fraction.length > precision) throw new Error(`Use at most ${precision} decimal places for ${currency}.`);
  const units = BigInt(whole) * 10n ** BigInt(precision) + BigInt(fraction.padEnd(precision, "0") || "0");
  return minorUnitsSchema.parse(Number(negative ? -units : units));
}
const splitInput = z.object({ categoryId: z.uuid(), bucketId: z.uuid(), amount: decimalSchema });
export const transactionInput = z.object({ accountId: z.uuid(), date: dateSchema, payee: z.string().trim().min(1, "Enter a payee.").max(200), kind: transactionKindSchema, amount: decimalSchema, splits: z.array(splitInput).min(1).max(100) });
export const updateInput = transactionInput.extend({ version: z.number().int().positive() });
export const deleteInput = z.object({ version: z.number().int().positive() });
export const ledgerFilters = z.object({ batchId: z.uuid().optional(), payee: z.string().max(200).optional(), from: dateSchema.optional(), to: dateSchema.optional(), accountId: z.uuid().optional(), kind: transactionKindSchema.optional(), categoryId: z.uuid().optional(), bucketId: z.uuid().optional(), page: z.coerce.number().int().min(1).max(1000000).default(1) }).refine((input) => !input.from || !input.to || input.from <= input.to, "The start date must be before the end date.");

