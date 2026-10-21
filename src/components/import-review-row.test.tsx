import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { reviewRowSchema } from "../imports/presentation";
import { inlineReviewDraft } from "../imports/inline-review";
import { sessionRowDraft } from "../imports/session-review";
import { ImportReviewRow } from "./import-review-row";

const id = "123e4567-e89b-42d3-a456-426614174000";
const source = { date: "2026-10-09", payee: "Purchase", amount: -1000, sourceId: null };
const row = reviewRowSchema.parse({ id, sourceRow: 2, original: { status: "valid", source }, source,
  proposed: { accountId: id, date: source.date, payee: source.payee, kind: "expense", amount: "-10.00", splits: [{ categoryId: id, bucketId: id, amount: "-10.00" }] }, errors: [], matching: { status: "new", reason: "No match", candidates: [], earlierRow: null, occurrence: 1, existingOccurrences: 0 }, decision: "keep", kindReviewed: false, transactionId: null });
const sheet = { id, name: "Household", currency: "USD", setup: { accounts: 0, categories: 0, groups: 0, budgets: 0, formats: 0, cycleDay: 1, completed: false }, cycleStartDay: 1, cycleVersion: 1, cycleHistory: { baselineDay: 1, revisions: [] }, role: "owner", people: [], accounts: [], categories: [{ id, sheetId: id, name: "Uncategorized", isProtected: true, isArchived: false }], buckets: [{ id, sheetId: id, name: "Unassigned", trackRepayment: false, trackingVersion: 1, repaymentRecipient: null, isProtected: true, isArchived: false }] } satisfies Parameters<typeof ImportReviewRow>[0]["sheet"];
function render(value = row, draft?: Parameters<typeof ImportReviewRow>[0]["draft"]) {
  return renderToStaticMarkup(<ImportReviewRow row={value} sheet={sheet} draft={draft} pending={false} repeated={false} changed={false} onChange={() => undefined} onFullReview={() => undefined} onUseLatest={() => undefined} onKeepEdits={() => undefined} />);
}
it("exposes exactly one set of key review fields without a popup or expandable card", () => {
  const html = render();
  for (const field of ["kind", "decision", "category", "bucket"]) expect(html.match(new RegExp(`id="review-${field}-${id}"`, "g"))).toHaveLength(1);
  expect(html).not.toContain("<dialog"); expect(html).toContain("Category (optional)");
  expect(html).not.toContain('type="submit"');
  expect(html).toContain("Details");
});
it("summarizes splits and disables inline kind conversion while retaining the detail path", () => {
  const splitRow = reviewRowSchema.parse({ ...row, proposed: { ...row.proposed, splits: [{ categoryId: id, bucketId: id, amount: "-6.00" }, { categoryId: id, bucketId: id, amount: "-4.00" }] } });
  const html = render(splitRow);
  expect(html).toContain("2 person/category parts:");
  expect(html).toContain("Edit amounts and categories in Details");
  expect(html).toContain(`disabled="" id="review-kind-${id}"`);
  expect(html).not.toContain(`id="review-category-${id}"`);
});
it("shows saving only for optional changes and explicit duplicate decisions", () => {
  const html = render(row, { ...inlineReviewDraft(row), kind: "transfer" });
  expect(html).not.toContain("Save row review");
  expect(html).toContain("Pending edits");
  const duplicate = { ...row, decision: "pending", matching: { ...row.matching, status: "possible", reason: "Matches another purchase" } } satisfies typeof row;
  expect(render(duplicate)).toContain("Matches another purchase");
  expect(render(duplicate, { ...inlineReviewDraft(duplicate), decision: "skip" })).not.toContain("Save row review");
});
it("keeps blocking source errors visible beside the correction action", () => {
  const html = render({ ...row, source: null, proposed: null, errors: ["Enter a valid date", "Enter a nonzero amount"] });
  expect(html).toContain("Enter a valid date Enter a nonzero amount");
  expect(html).toContain("Correct or skip");
});
it("uses grid signs for a refund and retains an outgoing transfer draft's direction", () => {
  expect(render()).toContain('<span class="amount">$10.00</span>');
  expect(render(row, { ...inlineReviewDraft(row), kind: "refund" })).toContain('<span class="amount">-$10.00</span>');
  const transaction = { ...sessionRowDraft(row, "USD").transaction, kind: "transfer" as const, direction: "out" as const };
  const html = renderToStaticMarkup(<ImportReviewRow row={row} sheet={sheet} draft={{ ...inlineReviewDraft(row), kind: "transfer" }} transaction={transaction} pending={false} repeated={false} changed={false} onChange={() => {}} onFullReview={() => {}} onUseLatest={() => {}} onKeepEdits={() => {}} />);
  expect(html).toContain('<span class="amount">-$10.00</span>'); expect(html).toContain("Excluded from spending");
});
