import { sessionRowDraft } from "../imports/session-review";
import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ImportRowEditor } from "./import-row-editor";
import { reviewRowSchema } from "../imports/presentation";

const id = "123e4567-e89b-42d3-a456-426614174000";
const sheet = { id, name: "Household", currency: "USD", setup: { accounts: 0, categories: 0, groups: 0, budgets: 0, formats: 0, cycleDay: 1 }, cycleStartDay: 1, cycleVersion: 1, cycleHistory: { baselineDay: 1, revisions: [] }, role: "owner", people: [], accounts: [],
  categories: [{ id, sheetId: id, name: "Uncategorized", isProtected: true, isArchived: false }],
  buckets: [{ id, sheetId: id, name: "Unassigned", trackRepayment: false, trackingVersion: 1, isProtected: true, isArchived: false }],
} satisfies Parameters<typeof ImportRowEditor>[0]["sheet"];
const source = { date: "2026-10-09", payee: "Card payment", amount: -1000, sourceId: null };
const row = reviewRowSchema.parse({ id, sourceRow: 2, original: { status: "valid", source }, source,
  proposed: { accountId: id, date: source.date, payee: source.payee, kind: "expense", amount: "-10.00", splits: [{ categoryId: id, bucketId: id, amount: "-10.00" }] },
  errors: [], matching: { status: "new", reason: "No match", candidates: [], earlierRow: null, occurrence: 1, existingOccurrences: 0 },
  decision: "keep", kindReviewed: false, transactionId: null,
});
function render(value = row, pending = false) {
  return renderToStaticMarkup(<ImportRowEditor sheet={sheet} row={value} pending={pending} onClose={() => undefined} value={sessionRowDraft(value, "USD")} onChange={() => undefined} />);
}
it("highlights Kind and allows a valid unreviewed row to be saved without a checkbox", () => {
  const html = render();
  expect(html).toContain("Card payments are Transfers");
  expect(html).toContain('aria-describedby="import-entry-kind-hint"');
  expect(html).not.toContain('type="checkbox"');
  expect(html).toContain("Close review");
  expect(html).not.toContain("Save row review");
  expect(render(row, true)).toContain('disabled=""');
});
it("explains that a valid source correction is ready unless a duplicate decision is required", () => {
  const html = render({ ...row, source: null, proposed: null, original: { status: "invalid", selected: { Date: "wrong", Payee: "", Amount: "0" }, errors: ["Invalid date"] }, errors: ["Invalid date"] });
  expect(html).toContain("Correct mapped values");
  expect(html).toContain("A valid correction is ready to import");
  expect(html).toContain("unless a duplicate decision is required");
  expect(html).not.toContain('id="import-entry-kind"');
});
