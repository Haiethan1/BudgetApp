import { z } from "zod";
import { cycleSchema } from "./cycle";
import { contributionSchema } from "../plans/input";
export const cyclePreviewSchema = z.object({
  previewToken: z.string(), transitionKind: z.enum(["short", "long", "aligned"]), original: cycleSchema, currentBefore: cycleSchema, currentAfter: cycleSchema, transition: cycleSchema, next: cycleSchema,
  retainedLimits: z.array(z.object({ category: z.string(), limit: z.number().nullable(), inheritsDefault: z.boolean(), version: z.number() })),
  mappings: z.array(z.object({ category: z.string(), oldPeriod: cycleSchema, newPeriod: cycleSchema, limit: z.number().nullable(), effectiveLimit: z.number().nullable(), inheritsDefault: z.boolean(), version: z.number() })),
  paymentPlans: z.array(z.object({ id: z.uuid(), name: z.string(), completed: z.number(), oldSchedule: z.array(contributionSchema), newSchedule: z.array(contributionSchema) })).default([]),
});
