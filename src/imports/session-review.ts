import { z } from "zod";
import type { readSheet } from "../sheets/service";
import { parseMoney } from "../ledger/input";
import { allocationBalance, decimalAmount, draftInput, type Draft } from "../ledger/presentation";
import { normalizeCsv } from "./csv";
import { reviewRowSignature } from "./inline-review";
import { reviewRowSchema, type Review, type ReviewRow } from "./presentation";

type Sheet = Pick<ReturnType<typeof readSheet>, "currency" | "categories" | "buckets">;
export type SessionRowDraft = { baseline: string; transaction: Draft; proposalEdited: boolean; correction: Record<string, string> | null; decision: ReviewRow["decision"] };
export function sessionRowDraft(row: ReviewRow, currency: string): SessionRowDraft {
  const p = row.proposed;
  return { baseline: reviewRowSignature(row), proposalEdited: false, decision: row.decision, correction: !row.source && row.original.status === "invalid" ? { ...row.original.selected } : null,
    transaction: p ? { kind: p.kind, date: p.date, accountId: p.accountId, payee: p.payee, amount: decimalAmount(parseMoney(p.amount, currency), currency), direction: parseMoney(p.amount, currency) < 0 ? "out" : "in", splitMode: p.splits.length > 1, splits: p.splits.map((s, i) => ({ ...s, key: `${row.id}-${i}`, amount: decimalAmount(parseMoney(s.amount, currency), currency) })) }
      : { kind: "expense", date: "", accountId: "", payee: "", amount: "", direction: "out", splitMode: false, splits: [] } };
}
export function sessionDefaults(sheet: Sheet) {
  const categoryId = sheet.categories.find((c) => c.isProtected)?.id;
  const bucketId = sheet.buckets.find((b) => b.isProtected)?.id;
  if (!categoryId || !bucketId) throw new Error("Missing sheet defaults.");
  return { categoryId, bucketId };
}
export function correctedRow(review: Review, row: ReviewRow, draft: SessionRowDraft, sheet: Sheet) {
  if (!draft.correction) return row;
  const selected = draft.correction;
  const result = normalizeCsv({ headers: Object.keys(selected), records: [Object.values(selected)] }, review.mapping, sheet.currency, { accountId: review.accountId, ...sessionDefaults(sheet) })[0];
  if (!result || result.status !== "valid") throw new Error(result?.errors.join(" ") || "Correct the mapped source fields.");
  return reviewRowSchema.parse({ ...row, source: result.source, proposed: result.proposed, errors: [] });
}
export function sessionRowInput(review: Review, row: ReviewRow, draft: SessionRowDraft, sheet: Sheet) {
  if (draft.baseline !== reviewRowSignature(row)) throw new Error("This row changed. Compare the latest values and explicitly keep or replace your edits.");
  if (draft.decision === "exclude" || draft.decision === "skip") return { rowId: row.id, decision: draft.decision };
  if (draft.decision !== "keep") throw new Error("Choose an Import action for this possible duplicate.");
  const normalized = correctedRow(review, row, draft, sheet);
  if (!normalized.source) throw new Error("Correct the mapped source fields or don't import this row.");
  const proposed = draft.transaction.accountId ? draftInput(draft.transaction, sheet.currency, sessionDefaults(sheet)) : normalized.proposed;
  return { rowId: row.id, decision: draft.decision, matching: JSON.stringify(row.matching), ...(draft.correction ? { correction: draft.correction } : {}), proposed: proposed ?? undefined, kindReviewed: true };
}
function reviewValidationMessage(error: unknown, draft: SessionRowDraft | undefined, currency: string) {
  if (error instanceof z.ZodError) {
    if (draft) {
      const balance = allocationBalance(draft.transaction, currency);
      if (!balance.valid) return balance.message;
    }
    return "Check the date, payee, and spending allocations in Full review.";
  }
  return error instanceof Error ? error.message : "Review this row in Full review.";
}
export function sessionReview(review: Review, drafts: Record<string, SessionRowDraft>, sheet: Sheet) {
  const errors: Record<string, string> = {};
  const counts = { new: 0, definite: 0, possible: 0, invalid: 0, excluded: 0, added: 0, skipped: 0 };
  for (const row of review.rows) {
    const draft = drafts[row.id]; const decision = draft?.decision ?? row.decision;
    if (draft && draft.baseline !== reviewRowSignature(row)) { errors[row.id] = "This row changed. Compare the latest values and explicitly keep or replace your edits."; counts.possible++; continue; }
    if (decision === "exclude") { counts.excluded++; continue; }
    let status = row.matching.status;
    if (draft?.correction) {
      try { if (JSON.stringify(correctedRow(review, row, draft, sheet).source) !== JSON.stringify(row.source)) status = "new"; }
      catch (error) { errors[row.id] = reviewValidationMessage(error, draft, sheet.currency); counts.invalid++; continue; }
    }
    if (review.repeatedFile || status === "definite") { counts.skipped++; counts.definite++; continue; }
    if (decision === "skip") { counts.skipped++; counts[status]++; continue; }
    try {
      const input = sessionRowInput(review, row, draft ?? sessionRowDraft(row, sheet.currency), sheet);
      if ("proposed" in input && input.proposed) { counts.added++; counts[status]++; }
    } catch (error) { errors[row.id] = reviewValidationMessage(error, draft, sheet.currency); if (!row.source) counts.invalid++; else counts.possible++; }
  }
  return { counts, errors, ready: Object.keys(errors).length === 0 };
}
