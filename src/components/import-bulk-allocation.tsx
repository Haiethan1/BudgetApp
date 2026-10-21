import type { readSheet } from "../sheets/service";
import { Button, Selector, Help } from "./ui";

export function ImportBulkAllocation({ sheet, categoryId, bucketId, disabled, conflict, onCategory, onBucket, onApply, onReload }: {
  sheet: Pick<ReturnType<typeof readSheet>, "categories" | "buckets">; categoryId: string; bucketId: string; disabled: boolean; conflict: boolean;
  onCategory: (value: string) => void; onBucket: (value: string) => void; onApply: () => void; onReload: () => void;
}) {
  return <section className="import-bulk-allocation" aria-labelledby="bulk-allocation-heading">
    <div className="help-label"><h2 id="bulk-allocation-heading">Assign person</h2><Help label="Eligible rows"><p>Applies across every page to valid, kept expenses and refunds with one part and no pending edits. Existing drafts, divided purchases, unavailable allocations, duplicate decisions, corrections, notes, income and transfers stay unchanged. Final Import saves these changes.</p></Help></div>

    <div className="import-bulk-controls">
      <Selector id="bulk-import-bucket" label="Person for eligible rows" value={bucketId} disabled={disabled} onChange={(event) => onBucket(event.target.value)}><option value="">Keep each person</option>{sheet.buckets.filter((item) => !item.isArchived).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Selector>
      <details><summary>Category (optional)</summary><Selector id="bulk-import-category" label="Spending category for eligible rows" value={categoryId} disabled={disabled} onChange={(event) => onCategory(event.target.value)}><option value="">Keep each spending category</option>{sheet.categories.filter((item) => !item.isArchived).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Selector></details>
      <Button variant="primary" disabled={disabled || conflict || (!categoryId && !bucketId)} onClick={onApply}>Apply to eligible rows</Button>
    </div>
    {conflict && <Button disabled={disabled} onClick={onReload}>Reload latest review</Button>}
  </section>;
}
