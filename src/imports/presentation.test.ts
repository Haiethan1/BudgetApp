import { expect, it } from "vitest";
import { confirmationStatus, rowDecisionLabel, rowStatus, reviewSchema } from "./presentation";
const id = "123e4567-e89b-42d3-a456-426614174000";
const review = reviewSchema.parse({ id, sheetId: id, accountId: id, profileId: id, mapping: { version: 1, profile: "Synthetic", date: "Date", payee: "Payee", dateFormat: "YYYY-MM-DD", decimalSeparator: ".", money: { mode: "signed", amount: "Amount", outflowSign: "negative" } }, state: "review", version: 1, counts: { new: 1, definite: 0, possible: 0, invalid: 0, excluded: 0, added: 1, skipped: 0 }, ready: false, repeatedFile: false, result: null,
  rows: [{ id, sourceRow: 2, original: { status: "valid", source: { date: "2026-09-05", payee: "Synthetic purchase", amount: -1000, sourceId: null } }, source: { date: "2026-09-05", payee: "Synthetic purchase", amount: -1000, sourceId: null }, proposed: { accountId: id, date: "2026-09-05", payee: "Synthetic purchase", kind: "expense", amount: "-10.00", splits: [{ categoryId: id, bucketId: id, amount: "-10.00" }] }, errors: [], matching: { status: "new", reason: "No match", candidates: [], earlierRow: null, occurrence: 1, existingOccurrences: 0, candidateCount: 0 }, decision: "keep", kindReviewed: false, transactionId: null }] });
it("permits retry only after a complete uncommitted status response and recognizes a saved commit", () => {
  expect(confirmationStatus(review).kind).toBe("retryable");
  const result = { added: 1, skipped: 0, excluded: 0, transactionIds: [id], repeatedFile: false, viewBatchId: id };
  expect(confirmationStatus({ ...review, state: "committed", result })).toMatchObject({ kind: "committed", review: { result } });
  for (const value of [null, { state: "review" }, { ...review, state: "committed" }, { ...review, result }, { ...review, version: "wrong" }]) expect(confirmationStatus(value)).toEqual({ kind: "unknown" });
});
it("distinguishes unresolved kind/duplicate review, deliberate skip, exclusion, and definite repeats", () => {
  const row = review.rows[0]; if (!row) throw new Error("Missing fixture row.");
  expect(rowStatus(row)).toBe("Review kind");
  expect(rowStatus({ ...row, kindReviewed: true })).toBe("New");
  expect(rowStatus({ ...row, matching: { ...row.matching, status: "possible" }, decision: "pending" })).toBe("Needs review");
  expect(rowStatus({ ...row, decision: "skip" })).toBe("Skipped");
  expect(rowStatus({ ...row, decision: "exclude" })).toBe("Excluded");
  expect(rowStatus(row, true)).toBe("Already imported");
  expect(rowDecisionLabel({ ...row, decision: "pending" }, true)).toBe("No decision required");
  expect(rowDecisionLabel({ ...row, decision: "pending", matching: { ...row.matching, status: "definite" } })).toBe("No decision required");
  expect(rowDecisionLabel({ ...row, decision: "pending" })).toBe("Decision required");
});
