import { z } from "zod";
import { dateSchema, minorUnitsSchema, transactionInput } from "../ledger/input";
import { mappingSchema } from "./input";
export const sourceSchema = z.object({ date: dateSchema, payee: z.string().trim().min(1).max(200), amount: minorUnitsSchema, sourceId: z.string().min(1).max(200).nullable() });
export const originalSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("valid"), source: sourceSchema, selected: z.record(z.string(), z.string()).optional() }),
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
export const bulkAllocationInput = z.object({ version: z.number().int().positive(), categoryId: z.uuid().optional(), bucketId: z.uuid().optional() }).strict().refine((value) => value.categoryId || value.bucketId, "Choose a spending category or person or group.");
export const bulkAllocationResult = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("updated"), review: reviewSchema, updated: z.number().int(), skipped: z.number().int(), unchanged: z.number().int() }),
  confirmSchema.extend({ kind: z.literal("stale") }),
]);
export const profilesSchema = z.array(z.object({ id: z.uuid(), accountId: z.uuid(), name: z.string(), version: z.number().int(), mapping: mappingSchema }));
export const inspectionSchema = z.object({ headers: z.array(z.string()), samples: z.array(z.object({ sourceRow: z.number().int(), fields: z.array(z.string()) })), rowCount: z.number().int(), skippedBlankCount: z.number().int() });
export const parsedPreviewSchema = z.object({ rows: z.array(z.discriminatedUnion("status", [z.object({ status: z.literal("valid"), sourceRow: z.number(), fields: z.array(z.string()), source: sourceSchema, proposed: transactionInput }), z.object({ status: z.literal("invalid"), sourceRow: z.number(), fields: z.array(z.string()), errors: z.array(z.string()) })])), validCount: z.number(), invalidCount: z.number(), skippedBlankCount: z.number().int() });
export type Review = z.infer<typeof reviewSchema>;
export type ReviewRow = z.infer<typeof reviewRowSchema>;
export function importDisplayAmount(kind: NonNullable<ReviewRow["proposed"]>["kind"], amount: number) {
  return kind === "expense" ? Math.abs(amount) : kind === "refund" ? -Math.abs(amount) : amount;
}
export function importedExpensesHref(review: Pick<Review, "accountId" | "result" | "rows">) {
  if (!review.result) throw new Error("Import has no saved result.");
  const otherKinds = review.rows.some(row => row.proposed && (row.proposed.kind === "transfer" || row.proposed.kind === "income"));
  return `/transactions?${new URLSearchParams({ batchId: review.result.viewBatchId, accountId: review.accountId, from: "", to: "", view: otherKinds || review.result.repeatedFile ? "all" : "expenses" })}`;
}
export const importDecisionLabels = { pending: "Choose", keep: "Import", exclude: "Skip", skip: "Skip, keep matching count" } satisfies Record<ReviewRow["decision"], string>;

export function importResultSummary(review: Review) {
  if (!review.result) return [];
  const counted = review.result.repeatedFile ? 0 : review.rows.filter(row => row.source && row.matching.status !== "definite" && row.decision === "skip").length;
  return [
    { label: "Imported", count: review.result.added },
    { label: "Skipped", count: review.result.excluded },
    { label: "Skipped, kept matching count", count: counted },
    { label: "Already imported", count: review.result.skipped - counted },
  ];
}

export function confirmationStatus(value: unknown) {
  const parsed = reviewSchema.safeParse(value);
  if (!parsed.success) return { kind: "unknown" as const };
  return parsed.data.state === "committed" && parsed.data.result ? { kind: "committed" as const, review: parsed.data } : parsed.data.state === "review" && parsed.data.result === null ? { kind: "retryable" as const, review: parsed.data } : { kind: "unknown" as const };
}
export function rowStatus(row: ReviewRow, repeatedFile = false) {
  if (row.decision === "exclude") return "Skip";
  if (repeatedFile || row.matching.status === "definite") return "Already imported";
  if (!row.source) return "Invalid";
  if (row.decision === "skip") return "Skip, keep matching count";
  if (row.matching.status === "possible") return row.decision === "pending" ? "Needs review" : "Import as new";
  return "Ready to import";
}
export function rowDecisionLabel(row: ReviewRow, repeatedFile = false) {
  if (repeatedFile || row.matching.status === "definite") return "No decision required";
  return importDecisionLabels[row.decision];
}

