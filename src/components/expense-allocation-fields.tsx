import type { AllocationChange, AllocationDefaults, AllocationDraft } from "../ledger/expense-division";
import { divideExpense, divisionSummary } from "../ledger/expense-division";
import { Button, Field, Notice, Selector } from "./ui";

type Label = { id: string; name: string; isArchived: boolean };
export type ExpenseAllocationFieldsProps = {
  id: string;
  draft: AllocationDraft;
  currency: string;
  defaults: AllocationDefaults;
  categories: Label[];
  buckets: Label[];
  errors?: Record<string, string>;
  onChange: (change: AllocationChange) => void;
};

export function ExpenseAllocationFields({ id, draft, currency, defaults, categories, buckets, errors = {}, onChange }: ExpenseAllocationFieldsProps) {
  if (draft.kind === "income" || draft.kind === "transfer") return <Notice>Income and transfers do not count as spending. They use Uncategorized and Unassigned.</Notice>;
  const summary = divisionSummary(draft, currency);
  const purposeId = `${id}-purpose`;
  const summaryId = `${id}-summary`;
  function update(index: number, values: Partial<AllocationDraft["splits"][number]>) {
    onChange({ splitMode: draft.splitMode, splits: draft.splits.map((part, position) => position === index ? { ...part, ...values } : part) });
  }
  function options(items: Label[], selected: string) {
    return <><option value="">Choose an option</option>{items.filter((item) => !item.isArchived || item.id === selected).map((item) => <option key={item.id} value={item.id}>{item.name}{item.isArchived ? " (archived)" : ""}</option>)}</>;
  }
  return <section className="expense-division" aria-label="Spending allocation">
    <h3>{draft.splitMode ? "Divide this expense" : "Spending allocation"}</h3>
    <p className="hint" id={purposeId}>Divide the amount between spending categories or spending groups.</p>
    {!draft.splitMode && <Button aria-describedby={purposeId} onClick={() => onChange(divideExpense(draft, defaults, crypto.randomUUID()))}>Divide this expense</Button>}
    {draft.splitMode && <>
      <p className="hint">Enter positive amounts for every part. {draft.kind === "refund" ? "Refund parts reduce spending in the chosen categories and groups." : "Expense parts count as spending in the chosen categories and groups."}</p>
      <div className="division-summary" id={summaryId} role="status" aria-live="polite" aria-atomic="true">
        <p>Original total: <strong>{summary.total}</strong></p>
        <p className={summary.error ? "field-error" : ""}>{summary.remaining}</p>
        {summary.error && <p className="field-error">{summary.error}</p>}
      </div>
    </>}
    {(draft.splitMode ? draft.splits : draft.splits.slice(0, 1)).map((part, index) => <section className="allocation-row" key={part.key} aria-label={`Part ${index + 1}`}>
      {draft.splitMode && <><h4>Part {index + 1}</h4><Field id={`${id}-${part.key}-amount`} label={`Part ${index + 1} amount (${currency}, required)`} value={part.amount} inputMode="decimal" required aria-describedby={summaryId} error={summary.errors[index] ?? errors[`splits.${index}.amount`]} onChange={(event) => update(index, { amount: event.target.value })} /></>}
      <Selector id={`${id}-${part.key}-category`} label="Spending category (required)" required value={part.categoryId} error={!part.categoryId ? "Choose a spending category." : errors[`splits.${index}.categoryId`]} onChange={(event) => update(index, { categoryId: event.target.value })}>{options(categories, part.categoryId)}</Selector>
      <Selector id={`${id}-${part.key}-bucket`} label="Spending group (required)" required value={part.bucketId} error={!part.bucketId ? "Choose a spending group." : errors[`splits.${index}.bucketId`]} onChange={(event) => update(index, { bucketId: event.target.value })}>{options(buckets, part.bucketId)}</Selector>
      {draft.splitMode && <Button disabled={draft.splits.length === 1} aria-describedby={`${id}-parts-help`} onClick={() => onChange({ splitMode: true, splits: draft.splits.filter((item) => item.key !== part.key) })}>Remove part {index + 1}</Button>}
    </section>)}
    {draft.splitMode && <><p className="hint" id={`${id}-parts-help`}>Adding a part leaves its amount blank. Removing a part returns its amount to Still to assign. At least one part must remain.</p><Button disabled={draft.splits.length >= 100} aria-describedby={`${id}-parts-help`} onClick={() => onChange({ splitMode: true, splits: [...draft.splits, { ...defaults, key: crypto.randomUUID(), amount: "" }] })}>Add another part</Button>{draft.splits.length >= 100 && <p className="hint">You can divide an expense into up to 100 parts.</p>}</>}
  </section>;
}
