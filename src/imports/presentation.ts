import { z } from "zod";
import { dateSchema, minorUnitsSchema, transactionInput } from "../ledger/input";
import { mappingSchema } from "./input";
export const sourceSchema = z.object({ date: dateSchema, payee: z.string().trim().min(1).max(200), amount: minorUnitsSchema, sourceId: z.string().min(1).max(200).nullable() });
export const originalSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("valid"), source: sourceSchema }),
  z.object({ status: z.literal("invalid"), selected: z.record(z.string(), z.string()), errors: z.array(z.string()) }),
]);
export const matchingSchema = z.object({ status: z.enum(["new", "definite", "possible"]), reason: z.string(),
  candidates: z.array(z.object({ id: z.uuid(), date: z.string(), payee: z.string(), amount: z.number().int(), kind: z.string(), version: z.number().int(), deleted: z.boolean(), source: sourceSchema.nullable() })),
  earlierRow: z.number().int().nullable(), occurrence: z.number().int(), existingOccurrences: z.number().int(), candidateCount: z.number().int().default(0) });
export const resultSchema = z.object({ added: z.number().int(), skipped: z.number().int(), excluded: z.number().int(), transactionIds: z.array(z.uuid()), repeatedFile: z.boolean(), viewBatchId: z.uuid() });
export const reviewRowSchema = z.object({ id: z.uuid(), sourceRow: z.number().int(), original: originalSchema, source: sourceSchema.nullable(), proposed: transactionInput.nullable(), errors: z.array(z.string()), matching: matchingSchema, decision: z.enum(["pending", "keep", "skip", "exclude"]), kindReviewed: z.boolean(), transactionId: z.uuid().nullable() });
export const reviewSchema = z.object({ id: z.uuid(), sheetId: z.uuid(), accountId: z.uuid(), profileId: z.uuid(), mapping: mappingSchema, state: z.enum(["review", "committed"]), version: z.number().int(), rows: z.array(reviewRowSchema),
  counts: z.object({ new: z.number().int(), definite: z.number().int(), possible: z.number().int(), invalid: z.number().int(), excluded: z.number().int(), added: z.number().int(), skipped: z.number().int() }), ready: z.boolean(), repeatedFile: z.boolean(), result: resultSchema.nullable() });
export const confirmSchema = z.object({ kind: z.enum(["committed", "stale"]), review: reviewSchema, changedRowIds: z.array(z.uuid()), changedDecisions: z.array(z.object({ rowId: z.uuid(), previousDecision: reviewRowSchema.shape.decision, decision: reviewRowSchema.shape.decision })).optional() });
export const profilesSchema = z.array(z.object({ id: z.uuid(), accountId: z.uuid(), name: z.string(), version: z.number().int(), mapping: mappingSchema }));
export const inspectionSchema = z.object({ headers: z.array(z.string()), samples: z.array(z.array(z.string())), rowCount: z.number().int() });
export const parsedPreviewSchema = z.object({ rows: z.array(z.discriminatedUnion("status", [z.object({ status: z.literal("valid"), sourceRow: z.number(), source: sourceSchema, proposed: transactionInput }), z.object({ status: z.literal("invalid"), sourceRow: z.number(), errors: z.array(z.string()) })])), validCount: z.number(), invalidCount: z.number() });
export type Review = z.infer<typeof reviewSchema>;
export type ReviewRow = z.infer<typeof reviewRowSchema>;

export function confirmationStatus(value: unknown) {
  const parsed = reviewSchema.safeParse(value);
  if (!parsed.success) return { kind: "unknown" as const };
  return parsed.data.state === "committed" && parsed.data.result ? { kind: "committed" as const, review: parsed.data } : parsed.data.state === "review" && parsed.data.result === null ? { kind: "retryable" as const, review: parsed.data } : { kind: "unknown" as const };
}
export function rowStatus(row: ReviewRow, repeatedFile = false) {
  if (row.decision === "exclude") return "Excluded";
  if (repeatedFile || row.matching.status === "definite") return "Already imported";
  if (!row.source) return "Invalid";
  if (row.decision === "skip") return "Skipped";
  if (row.matching.status === "possible") return row.decision === "pending" ? "Needs review" : "Keep as new";
  return row.kindReviewed ? "New" : "Review kind";
}
export function rowDecisionLabel(row: ReviewRow, repeatedFile = false) {
  if (repeatedFile || row.matching.status === "definite") return "No decision required";
  return `${row.decision === "pending" ? "Decision required" : row.decision}${!row.kindReviewed && row.source && row.decision === "keep" ? " · Kind acknowledgment required" : ""}`;
}

