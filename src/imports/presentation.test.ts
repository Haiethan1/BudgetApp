import { expect, it } from "vitest";
import { confirmationStatus, importDecisionLabels, importDisplayAmount, importedExpensesHref, importResultSummary, rowDecisionLabel, rowStatus, reviewSchema } from "./presentation";
import { initialGridFilters, gridFilterInput } from "../ledger/grid-filters";
const id = "123e4567-e89b-42d3-a456-426614174000";
const review = reviewSchema.parse({ id, sheetId: id, accountId: id, profileId: id, mapping: { version: 1, profile: "Synthetic", date: "Date", payee: "Payee", dateFormat: "YYYY-MM-DD", decimalSeparator: ".", money: { mode: "signed", amount: "Amount", outflowSign: "negative" } }, state: "review", version: 1, counts: { new: 1, definite: 0, possible: 0, invalid: 0, excluded: 0, added: 1, skipped: 0 }, ready: false, repeatedFile: false, result: null,
  rows: [{ id, sourceRow: 2, original: { status: "valid", source: { date: "2026-09-05", payee: "Synthetic purchase", amount: -1000, sourceId: null } }, source: { date: "2026-09-05", payee: "Synthetic purchase", amount: -1000, sourceId: null }, proposed: { accountId: id, date: "2026-09-05", payee: "Synthetic purchase", kind: "expense", amount: "-10.00", splits: [{ categoryId: id, bucketId: id, amount: "-10.00" }] }, errors: [], matching: { status: "new", reason: "No match", candidates: [], earlierRow: null, occurrence: 1, existingOccurrences: 0, candidateCount: 0 }, decision: "keep", kindReviewed: false, transactionId: null }] });
it("permits retry only after a complete uncommitted status response and recognizes a saved commit", () => {
  expect(confirmationStatus(review).kind).toBe("retryable");
  const result = { added: 1, skipped: 0, excluded: 0, transactionIds: [id], repeatedFile: false, viewBatchId: id };
  expect(confirmationStatus({ ...review, state: "committed", result })).toMatchObject({ kind: "committed", review: { result } });
  for (const value of [null, { state: "review" }, { ...review, state: "committed" }, { ...review, result }, { ...review, version: "wrong" }]) expect(confirmationStatus(value)).toEqual({ kind: "unknown" });
});
it("distinguishes optional review from unresolved duplicates, skip, exclusion, and definite repeats", () => {
  const row = review.rows[0]; if (!row) throw new Error("Missing fixture row.");
  expect(rowStatus(row)).toBe("Ready to import");
  expect(rowDecisionLabel(row)).toBe("Import");
  expect(rowStatus({ ...row, kindReviewed: true })).toBe("Ready to import");
  expect(rowStatus({ ...row, matching: { ...row.matching, status: "possible" }, decision: "pending" })).toBe("Needs review");
  expect(rowStatus({ ...row, decision: "skip" })).toBe("Skip, keep matching count");
  expect(rowStatus({ ...row, decision: "exclude" })).toBe("Skip");
  expect(rowStatus(row, true)).toBe("Already imported");
  expect(rowDecisionLabel({ ...row, decision: "pending" }, true)).toBe("No decision required");
  expect(rowDecisionLabel({ ...row, decision: "pending", matching: { ...row.matching, status: "definite" } })).toBe("No decision required");
  expect(rowDecisionLabel({ ...row, decision: "pending" })).toBe("Choose");
});
it("keeps plain Skip, matching-count Skip, and automatic duplicates distinct in saved results", () => {
  const row = review.rows[0];
  const committed = { ...review, state: "committed" as const, rows: [
    { ...row, decision: "keep" as const },
    { ...row, decision: "exclude" as const },
    { ...row, decision: "skip" as const },
    { ...row, matching: { ...row.matching, status: "definite" as const } },
  ], result: { added: 1, excluded: 1, skipped: 2, transactionIds: [id], repeatedFile: false, viewBatchId: id } };
  expect(importResultSummary(committed)).toEqual([
    { label: "Imported", count: 1 }, { label: "Skipped", count: 1 },
    { label: "Skipped, kept matching count", count: 1 }, { label: "Already imported", count: 1 },
  ]);
  expect(importResultSummary({ ...committed, result: { ...committed.result, repeatedFile: true } }).at(-1)).toEqual({ label: "Already imported", count: 2 });
  expect(importDecisionLabels.exclude).toBe("Skip");
  expect(importDecisionLabels.skip).toBe("Skip, keep matching count");
});

it("uses purchase-positive/refund-negative grid signs while preserving income and transfer direction", () => {
  expect(importDisplayAmount("expense", -1234)).toBe(1234);
  expect(importDisplayAmount("refund", 1234)).toBe(-1234);
  expect(importDisplayAmount("transfer", -1234)).toBe(-1234);
  expect(importDisplayAmount("transfer", 1234)).toBe(1234);
  expect(importDisplayAmount("income", 1234)).toBe(1234);
});
it("returns historical imported rows in the batch/account without period bounds and exposes transfer-only batches", () => {
  const completed = { ...review, result: { added: 1, skipped: 0, excluded: 0, transactionIds: [id], repeatedFile: false, viewBatchId: id } };
  const url = new URL(importedExpensesHref(completed), "https://homebooks.test");
  const query = Object.fromEntries(url.searchParams);
  const filters = initialGridFilters({ from: "2026-10-01", to: "2026-10-31", query });
  expect(filters).toMatchObject({ from: "", to: "", batchId: id, accountId: id, view: "expenses" });
  expect(gridFilterInput(filters)).not.toHaveProperty("from"); expect(gridFilterInput(filters)).not.toHaveProperty("to");
  const transfer = reviewSchema.parse({ ...completed, rows: completed.rows.map(row => ({ ...row, proposed: { ...row.proposed, kind: "transfer" } })) });
  expect(new URL(importedExpensesHref(transfer), url).searchParams.get("view")).toBe("all");
  expect(new URL(importedExpensesHref({ ...completed, result: { ...completed.result, repeatedFile: true } }), url).searchParams.get("view")).toBe("all");
});
