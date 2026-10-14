import type { readSheet } from "../sheets/service";
import { Button, Selector } from "./ui";

export function ImportBulkAllocation({ sheet, categoryId, bucketId, disabled, conflict, onCategory, onBucket, onApply, onReload }: {
  sheet: Pick<ReturnType<typeof readSheet>, "categories" | "buckets">; categoryId: string; bucketId: string; disabled: boolean; conflict: boolean;
  onCategory: (value: string) => void; onBucket: (value: string) => void; onApply: () => void; onReload: () => void;
}) {
  return <section className="import-bulk-allocation" aria-labelledby="bulk-allocation-heading">
    <h2 id="bulk-allocation-heading">Apply allocations</h2>
    <p className="hint">Applies across the entire file to valid kept expenses and refunds with one split. Split transactions, income, transfers, invalid rows, unresolved duplicates, skipped and excluded rows, and already imported rows stay unchanged. Rows with an unavailable remaining allocation are also skipped.</p>
    <div className="import-bulk-controls">
      <Selector id="bulk-import-category" label="Spending category for eligible rows" value={categoryId} disabled={disabled} onChange={(event) => onCategory(event.target.value)}><option value="">Keep each spending category</option>{sheet.categories.filter((item) => !item.isArchived).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Selector>
      <Selector id="bulk-import-bucket" label="Spending group for eligible rows" value={bucketId} disabled={disabled} onChange={(event) => onBucket(event.target.value)}><option value="">Keep each spending group</option>{sheet.buckets.filter((item) => !item.isArchived).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Selector>
      <Button variant="primary" disabled={disabled || conflict || (!categoryId && !bucketId)} onClick={onApply}>Apply to eligible rows</Button>
    </div>
    {conflict && <Button disabled={disabled} onClick={onReload}>Reload latest review</Button>}
  </section>;
}
