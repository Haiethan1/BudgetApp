import { cycleSchema, periodKeySchema } from "../sheets/cycle";
import { z } from "zod";

const amount = z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);
export const budgetRowSchema = z.object({ effectiveFrom: z.string(), currentVersion: z.number().int().nonnegative(), currentSource: z.enum(["default", "month"]), currentLimit: amount.nonnegative().nullable(), periodDefaultLimit: amount.nonnegative().nullable(), categoryId: z.uuid(), name: z.string(), archived: z.boolean(), version: z.number().int().nonnegative(), defaultVersion: z.number().int().nonnegative(), defaultLimit: amount.nonnegative().nullable(), source: z.enum(["default", "month"]), limit: amount.nonnegative().nullable(), planned: amount.default(0), reconciliation: amount.default(0), matched: amount.default(0), budgetUsed: amount.default(0), spent: amount, remaining: amount.nullable() });
export const budgetPageSchema = z.object({ month: periodKeySchema, cycle: cycleSchema, total: amount, uncategorized: amount, categories: z.record(z.string(), amount), buckets: z.record(z.string(), amount), rows: z.array(budgetRowSchema), totalLimits: amount, budgetedSpent: amount, budgetedUsed: amount.default(0), remaining: amount });
export type BudgetRow = z.infer<typeof budgetRowSchema>;
