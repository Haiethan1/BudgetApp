import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { reviewRowSchema } from "../imports/presentation";
import { ImportReviewRow } from "./import-review-row";

const id = "123e4567-e89b-42d3-a456-426614174000";
const source = { date: "2026-10-09", payee: "Purchase", amount: -1000, sourceId: null };
const row = reviewRowSchema.parse({ id, sourceRow: 2, original: { status: "valid", source }, source,
  proposed: { accountId: id, date: source.date, payee: source.payee, kind: "expense", amount: "-10.00", splits: [{ categoryId: id, bucketId: id, amount: "-10.00" }] }, errors: [], matching: { status: "new", reason: "No match", candidates: [], earlierRow: null, occurrence: 1, existingOccurrences: 0 }, decision: "keep", kindReviewed: false, transactionId: null });
const sheet = { id, name: "Household", currency: "USD", role: "owner", people: [], accounts: [], categories: [{ id, sheetId: id, name: "Uncategorized", isProtected: true, isArchived: false }], buckets: [{ id, sheetId: id, name: "Unassigned", trackRepayment: false, trackingVersion: 1, isProtected: true, isArchived: false }] } satisfies Parameters<typeof ImportReviewRow>[0]["sheet"];
function render(value = row) {
  return renderToStaticMarkup(<ImportReviewRow row={value} sheet={sheet} pending={false} repeated={false} changed={false} onChange={() => undefined} onSave={() => undefined} onFullReview={() => undefined} onUseLatest={() => undefined} onKeepEdits={() => undefined} />);
}
it("exposes exactly one set of key review fields without a popup or expandable card", () => {
  const html = render();
  for (const field of ["kind", "decision", "category", "bucket"]) expect(html.match(new RegExp(`id="review-${field}-${id}"`, "g"))).toHaveLength(1);
  expect(html).not.toContain("<dialog"); expect(html).not.toContain("<details");
  expect(html).toContain('<button type="submit" class="button primary ">Save row review</button>');
  expect(html).toContain("Full review");
});
it("summarizes splits and disables inline kind conversion while retaining the detail path", () => {
  const splitRow = reviewRowSchema.parse({ ...row, proposed: { ...row.proposed, splits: [{ categoryId: id, bucketId: id, amount: "-6.00" }, { categoryId: id, bucketId: id, amount: "-4.00" }] } });
  const html = render(splitRow);
  expect(html).toContain("2 splits:");
  expect(html).toContain("Edit allocations in Full review");
  expect(html).toContain(`disabled="" id="review-kind-${id}"`);
  expect(html).not.toContain(`id="review-category-${id}"`);
});
