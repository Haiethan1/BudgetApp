import { z } from "zod";
import { currencyPrecision, decimalSchema, monthSchema, parseMoney } from "../ledger/input";

const identity = z.object({ categoryId: z.uuid(), month: monthSchema, version: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER - 1) });
export const budgetMutation = z.discriminatedUnion("kind", [identity.extend({ kind: z.literal("save"), amount: decimalSchema }), identity.extend({ kind: z.literal("remove") })]);
export function parseLimit(amount: string, currency: string) {
  const parsed = decimalSchema.safeParse(amount);
  if (!parsed.success) throw new Error("Enter a limit using digits and a decimal point.");
  if (amount.startsWith("-")) throw new Error("Enter a nonnegative monthly limit.");
  if ((amount.split(".")[1]?.length ?? 0) > currencyPrecision(currency)) throw new Error(`Use at most ${currencyPrecision(currency)} decimal places for ${currency}.`);
  if (/^0+(\.0+)?$/.test(amount)) return 0;
  try { return parseMoney(amount, currency); }
  catch (error) { if (error instanceof z.ZodError) throw new Error("Enter a monthly limit within the supported range."); throw error; }
}
