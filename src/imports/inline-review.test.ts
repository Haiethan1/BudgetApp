import { expect, it } from "vitest";
import { reviewRowSchema } from "./presentation";
import { inlineReviewChanged, inlineReviewDraft, inlineReviewInput, reviewRowSignature } from "./inline-review";

const id = "123e4567-e89b-42d3-a456-426614174000";
const category = "123e4567-e89b-42d3-a456-426614174001";
const bucket = "123e4567-e89b-42d3-a456-426614174002";
const source = { date: "2026-10-09", payee: "Purchase", amount: -1000, sourceId: null };
const row = reviewRowSchema.parse({ id, sourceRow: 2, original: { status: "valid", source }, source,
  proposed: { accountId: id, date: source.date, payee: source.payee, kind: "expense", amount: "-10.00", splits: [{ categoryId: category, bucketId: bucket, amount: "-10.00" }] }, errors: [],
  matching: { status: "new", reason: "No match", candidates: [], earlierRow: null, occurrence: 1, existingOccurrences: 0 }, decision: "keep", kindReviewed: false, transactionId: null });
const sheet = { currency: "USD", categories: [{ id, sheetId: id, name: "Uncategorized", isProtected: true, isArchived: false }], buckets: [{ id, sheetId: id, name: "Unassigned", trackRepayment: false, trackingVersion: 1, repaymentRecipient: null, isProtected: true, isArchived: false }] };

it("saves an untouched row as reviewed and keeps source-only transaction fields intact", () => {
  const draft = inlineReviewDraft(row);
  expect(inlineReviewChanged(row, draft)).toBe(false);
  expect(inlineReviewInput(row, draft, sheet)).toEqual({ rowId: id, decision: "keep", kindReviewed: true, proposed: row.proposed });
  expect(inlineReviewInput(row, { ...draft, categoryId: id, bucketId: id }, sheet)).toMatchObject({ proposed: { date: "2026-10-09", payee: "Purchase", accountId: id, amount: "-10.00", splits: [{ categoryId: id, bucketId: id, amount: "-10.00" }] } });
});
it("normalizes signs and defaults when changing kind, retaining transfer direction", () => {
  const draft = inlineReviewDraft(row);
  expect(inlineReviewInput(row, { ...draft, kind: "transfer" }, sheet)).toMatchObject({ proposed: { kind: "transfer", amount: "-10.00", splits: [{ categoryId: id, bucketId: id, amount: "-10.00" }] } });
  expect(inlineReviewInput(row, { ...draft, kind: "income" }, sheet)).toMatchObject({ proposed: { kind: "income", amount: "10.00", splits: [{ categoryId: id, bucketId: id, amount: "10.00" }] } });
  expect(inlineReviewInput(row, { ...draft, kind: "refund" }, sheet)).toMatchObject({ proposed: { kind: "refund", amount: "10.00", splits: [{ categoryId: category, bucketId: bucket, amount: "10.00" }] } });
});
it("blocks stale row drafts even after a batch reload and requires an explicit new duplicate decision", () => {
  const draft = inlineReviewDraft(row);
  const latest = { ...row, decision: "pending", matching: { ...row.matching, status: "possible", reason: "Another row now matches" } } satisfies typeof row;
  expect(() => inlineReviewInput(latest, draft, sheet)).toThrow("This row changed");
  expect(() => inlineReviewInput(latest, { ...draft, baseline: reviewRowSignature(latest), decision: "pending" }, sheet)).toThrow("Choose Import or Skip");
});
it("preserves exact multi-split allocations and rejects flattening or converting their kind inline", () => {
  const splitRow = reviewRowSchema.parse({ ...row, proposed: { ...row.proposed, splits: [{ categoryId: category, bucketId: bucket, amount: "-6.00" }, { categoryId: id, bucketId: id, amount: "-4.00" }] } });
  const draft = inlineReviewDraft(splitRow);
  expect(inlineReviewInput(splitRow, draft, sheet)).toMatchObject({ proposed: { splits: [{ categoryId: category, bucketId: bucket, amount: "-6.00" }, { categoryId: id, bucketId: id, amount: "-4.00" }] } });
  expect(() => inlineReviewInput(splitRow, { ...draft, kind: "income" }, sheet)).toThrow("Use Details");
  expect(() => inlineReviewInput(splitRow, { ...draft, bucketId: id }, sheet)).toThrow("Use Details");
  expect(inlineReviewInput(splitRow, { ...draft, decision: "skip" }, sheet)).toEqual({ rowId: id, decision: "skip" });
});
