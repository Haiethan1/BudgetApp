import type { readSheet } from "../sheets/service";
import { displayAmount, type Draft } from "../ledger/presentation";
import { parseMoney, transactionKindSchema } from "../ledger/input";
import { inlineReviewDraft, reviewRowSignature, type InlineReviewDraft } from "../imports/inline-review";
import { importDecisionLabels, importDisplayAmount, rowStatus, type ReviewRow } from "../imports/presentation";
import { ImportDecision } from "./import-decision";
import { Badge, Button, Notice, Selector } from "./ui";

export function ImportReviewRow({ row, sheet, draft: savedDraft, pending, repeated, changed, error, transaction, onChange, onFullReview, onUseLatest, onKeepEdits }: {
  row: ReviewRow; sheet: ReturnType<typeof readSheet>; draft?: InlineReviewDraft; pending: boolean; repeated: boolean; changed: boolean; error?: string; transaction?: Draft;
  onChange: (draft: InlineReviewDraft) => void; onFullReview: () => void; onUseLatest: () => void; onKeepEdits: () => void;
}) {
  const draft = savedDraft ?? inlineReviewDraft(row);
  const stale = draft.baseline !== reviewRowSignature(row);
  const editable = Boolean(row.source && row.proposed && row.matching.status !== "definite" && !repeated);
  const split = transaction ? transaction.splitMode : Boolean(row.proposed && row.proposed.splits.length > 1);
  const excluded = draft.kind === "income" || draft.kind === "transfer";
  const disabled = pending || !editable || stale;
  const change = (values: Partial<InlineReviewDraft>) => onChange({ ...draft, ...values });
  const latestAllocation = row.proposed?.splits.map((item) => `${sheet.categories.find((label) => label.id === item.categoryId)?.name ?? "Unavailable category"} / ${sheet.buckets.find((label) => label.id === item.bucketId)?.name ?? "Unavailable group"}`).join("; ");
  const allocation = (transaction?.splits ?? row.proposed?.splits)?.map((item) => `${sheet.categories.find((category) => category.id === item.categoryId)?.name ?? "Unavailable spending category"} / ${sheet.buckets.find((bucket) => bucket.id === item.bucketId)?.name ?? "Unavailable person or group"}`).join("; ");
  let amount = "Check amount";
  try {
    const value = transaction?.amount ?? row.proposed?.amount;
    if (value) {
      const minor = parseMoney(value, sheet.currency);
      const flow = draft.kind === "transfer" && transaction ? (transaction.direction === "out" ? -Math.abs(minor) : Math.abs(minor)) : minor;
      amount = displayAmount(importDisplayAmount(draft.kind, flow), sheet.currency);
    }
  } catch { /* Incomplete draft amounts remain editable in Details. */ }
  function options(items: { id: string; name: string; isArchived: boolean }[], selected: string) {
    return items.filter((item) => !item.isArchived || item.id === selected).map((item) => <option key={item.id} value={item.id} disabled={item.isArchived}>{item.name}{item.isArchived ? " (archived)" : ""}</option>);
  }
  return <form className={`import-review-row${changed || stale ? " import-row-changed" : ""}`} aria-label={`Review source row ${row.sourceRow}`} onSubmit={(event) => { event.preventDefault();  }}>
    <div className="import-review-identity"><strong>{transaction?.payee || row.proposed?.payee || "Invalid source row"}</strong><div className="import-review-meta"><span>Row {row.sourceRow} · {transaction?.date || row.proposed?.date || "Needs correction"}</span><span className="amount">{amount}</span><Badge tone={row.matching.status === "possible" || !row.source ? "warning" : "neutral"}>{savedDraft && row.original.status === "invalid" && transaction?.accountId ? "Pending corrected source" : rowStatus({ ...row, decision: draft.decision }, repeated)}</Badge></div>{changed && <p className="field-error">Changed since preview</p>}</div>
    <div className="import-review-controls">
      {editable ? <>
        <Selector id={`review-kind-${row.id}`} label="Type" value={draft.kind} disabled={disabled || split} onChange={(event) => change({ kind: transactionKindSchema.parse(event.target.value) })}>{["expense", "refund", "income", "transfer"].map((kind) => <option key={kind} value={kind}>{kind[0]?.toUpperCase()}{kind.slice(1)}</option>)}</Selector>
        <ImportDecision id={`review-decision-${row.id}`} value={draft.decision} required={row.matching.status === "possible"} allowMatchingCount={row.original.status === "valid"} error={draft.decision === "pending" ? "Choose Import or Skip. Details shows possible matches." : undefined} disabled={disabled} onChange={decision => change({ decision })} />
        {split ? <p className="hint import-review-allocation">{transaction?.splits.length ?? row.proposed?.splits.length} person/category parts: {allocation}. Edit amounts and categories in Details.</p> : <>
          <Selector id={`review-bucket-${row.id}`} label="Person" value={excluded ? sheet.buckets.find((item) => item.isProtected)?.id ?? "" : draft.bucketId} disabled={disabled || excluded} onChange={(event) => change({ bucketId: event.target.value })}>{options(sheet.buckets, draft.bucketId)}</Selector>
          <details className="import-review-category"><summary>Category (optional)</summary><Selector id={`review-category-${row.id}`} label="Spending category" value={excluded ? sheet.categories.find((item) => item.isProtected)?.id ?? "" : draft.categoryId} disabled={disabled || excluded} onChange={(event) => change({ categoryId: event.target.value })}>{options(sheet.categories, draft.categoryId)}</Selector></details>
        </>}
        {excluded && <p className="hint import-review-allocation">Excluded from spending. Change transfer direction in Details.</p>}
      </> : <p className="hint import-review-allocation">{allocation ?? "Correct mapped source fields or skip this row in Details."}</p>}
      {!row.source && !transaction?.accountId && row.errors.length > 0 && <p className="field-error import-review-allocation">{row.errors.join(" ")}</p>}
      {row.matching.status === "possible" && <p className="hint import-review-allocation">{row.matching.reason}</p>}
      {stale && <div className="import-review-allocation"><Notice tone="warning">This row changed. Your pending choices are preserved. Compare the latest review below and matching details in Details or explicitly keep your edits.</Notice><p className="hint">Latest review: {row.proposed?.date} · {row.proposed?.payee} · {row.proposed?.kind} · {row.proposed?.amount} · {importDecisionLabels[row.decision]} · {latestAllocation}</p><div className="actions import-actions"><Button disabled={pending} onClick={onUseLatest}>Use latest values</Button><Button disabled={pending} onClick={onKeepEdits}>Keep my edits against latest</Button></div></div>}
      {error && <p className="field-error import-review-allocation">{error}</p>}<div className="actions import-actions import-review-actions"><Button disabled={pending || repeated} onClick={onFullReview}>{row.source ? "Details" : "Correct or skip"} {row.sourceRow}</Button>{savedDraft && <span className="hint">Pending edits</span>}</div>
    </div>
  </form>;
}
