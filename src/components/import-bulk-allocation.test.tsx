import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ImportBulkAllocation } from "./import-bulk-allocation";

const id = "123e4567-e89b-42d3-a456-426614174000";
const category = { id, sheetId: id, name: "Groceries", isArchived: false, isProtected: false };
const bucket = { ...category, name: "Household", trackRepayment: false, trackingVersion: 1 };
const sheet = { categories: [category, { ...category, id: `${id}1`, name: "Archived spending category", isArchived: true }], buckets: [bucket, { ...bucket, id: `${id}2`, name: "Archived spending group", isArchived: true }] };
function render(categoryId = "", bucketId = "", disabled = false, conflict = false) {
  return renderToStaticMarkup(<ImportBulkAllocation sheet={sheet} categoryId={categoryId} bucketId={bucketId} disabled={disabled} conflict={conflict} onCategory={() => undefined} onBucket={() => undefined} onApply={() => undefined} onReload={() => undefined} />);
}
it("explains entire-file eligibility and offers independent keep-current allocation choices", () => {
  const html = render();
  expect(html).toContain("across the entire file"); expect(html).toContain("Split transactions");
  expect(html).toContain("Keep each spending category"); expect(html).toContain("Keep each spending group");
  expect(html).not.toContain("Archived spending category"); expect(html).not.toContain("Archived spending group");
  expect(html).toContain('disabled="">Apply to eligible rows');
  expect(render(id)).not.toContain('disabled="">Apply to eligible rows');
  expect(render("", id)).not.toContain('disabled="">Apply to eligible rows');
});
it("disables bulk changes during pending or unsaved-row states and exposes conflict reload", () => {
  expect(render(id, id, true).match(/disabled=""/g)).toHaveLength(3);
  const conflict = render(id, id, false, true);
  expect(conflict).toContain('disabled="">Apply to eligible rows');
  expect(conflict).toContain("Reload latest review");
  expect(conflict).toContain('<option value="123e4567-e89b-42d3-a456-426614174000" selected="">Groceries');
});
