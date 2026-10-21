import { z } from "zod";
import { dateSchema } from "../ledger/input";
import { organizationName } from "../sheets/settings-input";

export const periodScopeSchema = z.object({ bucketId: z.uuid(), recipient: organizationName, accountId: z.uuid().optional(), from: dateSchema, to: dateSchema }).refine(scope => scope.from <= scope.to, "Start date must be on or before end date.");
export const periodGuardSchema = z.object({ scope: periodScopeSchema, digest: z.string().regex(/^[a-f0-9]{64}$/), refundAcknowledged: z.boolean() });
const amount = z.number().int().safe();
export const periodSourceSchema = z.object({ transactionId: z.uuid(), version: z.number().int().positive(), position: z.number().int().nonnegative(), amount, payee: z.string(), date: dateSchema, accountName: z.string() });
export const periodDebtSchema = z.object({ id: z.uuid(), version: z.number().int().positive(), description: z.string(), total: amount, paid: amount, remaining: amount, sources: z.array(periodSourceSchema) });
export const periodPreviewSchema = z.object({ scope: periodScopeSchema, debtor: z.string(), recipient: z.string(), accountName: z.string(), digest: z.string(), expenseTotal: amount, refundTotal: amount, netSpending: amount, eligibleTotal: amount, eligiblePaid: amount, sources: z.array(periodSourceSchema), debts: z.array(periodDebtSchema), exclusions: z.array(z.object({ label: z.string(), reason: z.string(), transactionId: z.uuid().optional(), debtId: z.uuid().optional() })) });
export type PeriodPreview = z.infer<typeof periodPreviewSchema>;
