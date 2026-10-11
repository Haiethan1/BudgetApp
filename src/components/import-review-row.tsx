import type { readSheet } from "../sheets/service";
import { displayAmount } from "../ledger/presentation";
import { parseMoney, transactionKindSchema } from "../ledger/input";
import { inlineDecisionSchema, inlineReviewDraft, reviewRowSignature, type InlineReviewDraft } from "../imports/inline-review";
import { rowStatus, type ReviewRow } from "../imports/presentation";
import { Badge, Button, Notice, Selector } from "./ui";

export function ImportReviewRow({ row, sheet, draft: savedDraft, pending, repeated, changed, onChange, onSave, onFullReview, onUseLatest, onKeepEdits }: {
  row: ReviewRow; sheet: ReturnType<typeof readSheet>; draft?: InlineReviewDraft; pending: boolean; repeated: boolean; changed: boolean;
  onChange: (draft: InlineReviewDraft) => void; onSave: () => void; onFullReview: () => void; onUseLatest: () => void; onKeepEdits: () => void;
}) {
  const draft = savedDraft ?? inlineReviewDraft(row);
  const stale = draft.baseline !== reviewRowSignature(row);
  const editable = Boolean(row.source && row.proposed && row.matching.status !== "definite" && !repeated);
  const split = Boolean(row.proposed && row.proposed.splits.length > 1);
  const excluded = draft.kind === "income" || draft.kind === "transfer";
  const disabled = pending || !editable || stale;
  const change = (values: Partial<InlineReviewDraft>) => onChange({ ...draft, ...values });
  const allocation = row.proposed?.splits.map((item) => `${sheet.categories.find((category) => category.id === item.categoryId)?.name ?? "Unavailable category"} / ${sheet.buckets.find((bucket) => bucket.id === item.bucketId)?.name ?? "Unavailable attribution"}`).join("; ");
  function options(items: { id: string; name: string; isArchived: boolean }[], selected: string) {
    return items.filter((item) => !item.isArchived || item.id === selected).map((item) => <option key={item.id} value={item.id} disabled={item.isArchived}>{item.name}{item.isArchived ? " (archived)" : ""}</option>);
  }
  return <form className={`import-review-row${changed || stale ? " import-row-changed" : ""}`} aria-label={`Review source row ${row.sourceRow}`} onSubmit={(event) => { event.preventDefault(); onSave(); }}>
    <div className="import-review-identity"><strong>{row.proposed?.payee ?? "Invalid source row"}</strong><div className="import-review-meta"><span>Row {row.sourceRow} · {row.proposed?.date ?? "Needs correction"}</span><span className="amount">{row.proposed ? displayAmount(parseMoney(row.proposed.amount, sheet.currency), sheet.currency, true) : "Check amount"}</span><Badge tone={row.matching.status === "possible" || !row.source ? "warning" : "neutral"}>{rowStatus(row, repeated)}</Badge></div>{changed && <p className="field-error">Changed since preview</p>}</div>
    <div className="import-review-controls">
      {editable ? <>
        <Selector id={`review-kind-${row.id}`} label="Kind" value={draft.kind} disabled={disabled || split} onChange={(event) => change({ kind: transactionKindSchema.parse(event.target.value) })}>{["expense", "refund", "income", "transfer"].map((kind) => <option key={kind} value={kind}>{kind[0]?.toUpperCase()}{kind.slice(1)}</option>)}</Selector>
        <Selector id={`review-decision-${row.id}`} label="Row decision" value={draft.decision} disabled={disabled} onChange={(event) => change({ decision: inlineDecisionSchema.parse(event.target.value) })}><option value="pending">Choose keep or skip</option><option value="keep">Keep as new</option><option value="skip">Skip this row</option><option value="exclude">Exclude this row</option></Selector>
        {split ? <p className="hint import-review-allocation">{row.proposed?.splits.length} splits: {allocation}. Edit kind and allocations in Full review.</p> : <>
          <Selector id={`review-category-${row.id}`} label="Category" value={excluded ? sheet.categories.find((item) => item.isProtected)?.id ?? "" : draft.categoryId} disabled={disabled || excluded} onChange={(event) => change({ categoryId: event.target.value })}>{options(sheet.categories, draft.categoryId)}</Selector>
          <Selector id={`review-bucket-${row.id}`} label="Attribution" value={excluded ? sheet.buckets.find((item) => item.isProtected)?.id ?? "" : draft.bucketId} disabled={disabled || excluded} onChange={(event) => change({ bucketId: event.target.value })}>{options(sheet.buckets, draft.bucketId)}</Selector>
        </>}
        {excluded && <p className="hint import-review-allocation">Income and transfers do not count as spending. Transfer direction can be changed in Full review.</p>}
      </> : <p className="hint import-review-allocation">{allocation ?? "Correct mapped source fields or exclude this row in Full review."}</p>}
      {!row.source && row.errors.length > 0 && <p className="field-error import-review-allocation">{row.errors.join(" ")}</p>}
      {row.matching.status === "possible" && <p className="hint import-review-allocation">{row.matching.reason}</p>}
      {stale && <div className="import-review-allocation"><Notice tone="warning">This row changed. Your unsaved choices are preserved. Compare latest saved values in Full review or explicitly keep your edits.</Notice><p className="hint">Latest saved: {row.proposed?.kind} · {row.decision} · {allocation}</p><div className="actions import-actions"><Button disabled={pending} onClick={onUseLatest}>Use latest values</Button><Button disabled={pending} onClick={onKeepEdits}>Keep my edits against latest</Button></div></div>}
      <div className="actions import-actions import-review-actions">{editable && savedDraft && <Button type="submit" variant="primary" disabled={disabled || draft.decision === "pending"}>Save row review</Button>}<Button disabled={pending || repeated} onClick={onFullReview}>{row.source ? "Full review" : "Correct or exclude"} {row.sourceRow}</Button>{savedDraft && <span className="hint">Unsaved changes</span>}</div>
    </div>
  </form>;
}
