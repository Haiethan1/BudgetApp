import { z } from "zod";
import { cycleSchema } from "./cycle";
export const cyclePreviewSchema = z.object({
  previewToken: z.string(), transitionKind: z.enum(["short", "long", "aligned"]), original: cycleSchema, currentBefore: cycleSchema, currentAfter: cycleSchema, transition: cycleSchema, next: cycleSchema,
  retainedLimits: z.array(z.object({ category: z.string(), limit: z.number().nullable(), inheritsDefault: z.boolean(), version: z.number() })),
  mappings: z.array(z.object({ category: z.string(), oldPeriod: cycleSchema, newPeriod: cycleSchema, limit: z.number().nullable(), effectiveLimit: z.number().nullable(), inheritsDefault: z.boolean(), version: z.number() })),
});
