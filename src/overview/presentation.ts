import { z } from "zod";
import { budgetPageSchema } from "../budgets/presentation";
import { ledgerRecordSchema } from "../ledger/presentation";
export const overviewSchema = budgetPageSchema.extend({
  attribution: z.array(z.object({ id: z.uuid(), name: z.string(), archived: z.boolean(), protected: z.boolean(), spent: z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER) })),
  uncategorizedId: z.uuid(), recent: z.array(ledgerRecordSchema).max(5), monthTransactionCount: z.number().int().nonnegative(), hasTransactions: z.boolean(),
});
