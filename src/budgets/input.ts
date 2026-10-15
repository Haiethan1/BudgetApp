import { z } from "zod";
import { currencyPrecision, decimalSchema, parseMoney } from "../ledger/input";

import { periodKeySchema } from "../sheets/cycle";
const identity = z.object({ cycleVersion: z.number().int().positive().optional(), categoryId: z.uuid(), month: periodKeySchema, version: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER - 1) });
const defaultIdentity = z.object({ categoryId: z.uuid(), version: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER - 1) });
export const budgetMutation = z.discriminatedUnion("kind", [
  identity.extend({ kind: z.literal("save"), amount: decimalSchema, makeDefault: z.boolean().optional(), defaultVersion: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER - 1).optional() }).refine((value) => !value.makeDefault || value.defaultVersion !== undefined, "Include the default revision."),
  identity.extend({ kind: z.literal("remove") }),
  identity.extend({ kind: z.literal("useDefault") }),
  defaultIdentity.extend({ kind: z.literal("saveDefault"), amount: decimalSchema }),
  defaultIdentity.extend({ kind: z.literal("removeDefault") }),
]);
export function parseLimit(amount: string, currency: string) {
  const parsed = decimalSchema.safeParse(amount);
  if (!parsed.success) throw new Error("Enter a limit using digits and a decimal point.");
  if (amount.startsWith("-")) throw new Error("Enter a nonnegative monthly limit.");
  if ((amount.split(".")[1]?.length ?? 0) > currencyPrecision(currency)) throw new Error(`Use at most ${currencyPrecision(currency)} decimal places for ${currency}.`);
  if (/^0+(\.0+)?$/.test(amount)) return 0;
  try { return parseMoney(amount, currency); }
  catch (error) { if (error instanceof z.ZodError) throw new Error("Enter a monthly limit within the supported range."); throw error; }
}
