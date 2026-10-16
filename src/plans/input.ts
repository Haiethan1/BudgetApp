import { z } from "zod";
import { dateSchema } from "../ledger/input";
const guard = { requestId: z.uuid(), cycleVersion: z.number().int().positive(), currentPeriod: dateSchema };
const fields = { name: z.string().trim().min(1).max(120), categoryId: z.uuid(), amount: z.string().trim().min(1).max(40), dueDate: dateSchema, recurrence: z.union([z.literal(0), z.literal(1), z.literal(6), z.literal(12)]) };
const existing = { ...guard, id: z.uuid(), version: z.number().int().positive() };
export const planMutation = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("create"), ...guard, ...fields }),
  z.object({ kind: z.literal("edit"), ...existing, ...fields }),
  z.object({ kind: z.literal("cancel"), ...existing }), z.object({ kind: z.literal("skip"), ...existing }),
  z.object({ kind: z.literal("match"), ...existing, transactionId: z.uuid(), sourceVersion: z.number().int().positive() }),
  z.object({ kind: z.literal("release"), ...existing, sourceVersion: z.number().int().nonnegative() }),
  z.object({ kind: z.literal("next"), ...existing, ...fields }),
]);
const integer = z.number().int().safe();
export const contributionSchema = z.object({ from: dateSchema, to: dateSchema, amount: integer });
export const planRecordSchema = z.object({
  id: z.uuid(), name: z.string(), categoryId: z.uuid(), expected: integer, dueDate: dateSchema, recurrence: integer, anchorDay: integer, createdDate: dateSchema, createdAt: integer,
  status: z.enum(["active", "fulfilled", "cancelled", "skipped"]), version: integer, nextPlanId: z.string().nullable(),
  contributions: z.array(contributionSchema), adjustments: z.array(z.object({ date: dateSchema, amount: integer, reason: z.string() })),
  matchedTransactionId: z.string().nullable(), matchedAmount: integer.nullable(), matchedDate: dateSchema.nullable(), matchedPayee: z.string().nullable(),
  sourceVersion: integer.nullable(), currentSourceVersion: integer, needsReview: z.boolean(), currentSourceDescription: z.string().nullable(),
  nextDueDate: dateSchema.nullable(), skippedOccurrences: integer, overdue: z.boolean(),
});
export type PlanRecord = z.infer<typeof planRecordSchema>;
export const planPageSchema = z.object({ plans: z.array(planRecordSchema), currentPeriod: dateSchema, cycleVersion: integer,
  candidates: z.array(z.object({ id: z.uuid(), version: integer, date: dateSchema, payee: z.string(), amount: integer, categoryId: z.uuid(), createdAt: integer })),
});
