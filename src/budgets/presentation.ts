import { z } from "zod";
import { monthSchema } from "../ledger/input";
const amount = z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);
export const budgetRowSchema = z.object({ categoryId: z.uuid(), name: z.string(), archived: z.boolean(), version: z.number().int().nonnegative(), limit: amount.nonnegative().nullable(), spent: amount, remaining: amount.nullable() });
export const budgetPageSchema = z.object({ month: monthSchema, total: amount, uncategorized: amount, categories: z.record(z.string(), amount), buckets: z.record(z.string(), amount), rows: z.array(budgetRowSchema), totalLimits: amount, budgetedSpent: amount, remaining: amount });
export type BudgetRow = z.infer<typeof budgetRowSchema>;
