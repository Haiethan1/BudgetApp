import { decimalAmount } from "../ledger/presentation";
import { parseMoney } from "../ledger/input";
import type { readSheet } from "../sheets/service";
import { reviewRowSchema, type ReviewRow } from "./presentation";

export type InlineReviewDraft = {
  baseline: string; kind: NonNullable<ReviewRow["proposed"]>["kind"]; decision: ReviewRow["decision"];
  categoryId: string; bucketId: string;
};
export function reviewRowSignature(row: ReviewRow) {
  return JSON.stringify({ proposed: row.proposed, source: row.source, decision: row.decision, kindReviewed: row.kindReviewed, matching: row.matching });
}
export function inlineReviewDraft(row: ReviewRow): InlineReviewDraft {
  return { baseline: reviewRowSignature(row), kind: row.proposed?.kind ?? "expense", decision: row.decision,
    categoryId: row.proposed?.splits[0]?.categoryId ?? "", bucketId: row.proposed?.splits[0]?.bucketId ?? "" };
}
export function inlineReviewChanged(row: ReviewRow, draft: InlineReviewDraft) {
  return JSON.stringify(inlineReviewDraft(row)) !== JSON.stringify(draft);
}
export function inlineReviewInput(row: ReviewRow, draft: InlineReviewDraft, sheet: Pick<ReturnType<typeof readSheet>, "currency" | "categories" | "buckets">) {
  if (draft.baseline !== reviewRowSignature(row)) throw new Error("This row changed. Compare your edits with the latest row before saving.");
  const decision = reviewRowSchema.shape.decision.parse(draft.decision);
  if (decision === "exclude" || decision === "skip") return { rowId: row.id, decision };
  if (decision !== "keep") throw new Error("Choose Import or Skip for this row.");
  const proposed = row.proposed;
  if (!row.source || !proposed) throw new Error("Correct this source row in Details first.");
  const split = proposed.splits[0];
  if (!split) throw new Error("Open Details to repair this row's allocation.");
  if (proposed.splits.length > 1) {
    if (draft.kind !== proposed.kind || draft.categoryId !== split.categoryId || draft.bucketId !== split.bucketId) throw new Error("Use Details to change a split transaction's kind or allocations.");
    return { rowId: row.id, decision, kindReviewed: true, proposed };
  }
  const kind = reviewRowSchema.shape.proposed.unwrap().shape.kind.parse(draft.kind);
  const amount = parseMoney(proposed.amount, sheet.currency);
  const negative = kind === "expense" || (kind === "transfer" && amount < 0);
  const signedAmount = `${negative ? "-" : ""}${decimalAmount(amount, sheet.currency)}`;
  const excluded = kind === "income" || kind === "transfer";
  const categoryId = excluded ? sheet.categories.find((item) => item.isProtected)?.id : draft.categoryId;
  const bucketId = excluded ? sheet.buckets.find((item) => item.isProtected)?.id : draft.bucketId;
  if (!categoryId || !bucketId) throw new Error("Choose a valid spending category and person or group.");
  return { rowId: row.id, decision, kindReviewed: true, proposed: { ...proposed, kind, amount: signedAmount,
    splits: [{ categoryId, bucketId, amount: signedAmount }] } };
}
export const inlineDecisionSchema = reviewRowSchema.shape.decision;
