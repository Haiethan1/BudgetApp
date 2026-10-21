import type { AllocationChange, AllocationDefaults, AllocationDraft } from "../ledger/expense-division";
import { divideExpense, divisionSummary } from "../ledger/expense-division";
import { Button, Field, Notice, Selector, Help } from "./ui";

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
  compact?: boolean;
};

export function ExpenseAllocationFields({ id, draft, currency, defaults, categories, buckets, errors = {}, onChange, compact = false }: ExpenseAllocationFieldsProps) {
  if (draft.kind === "income" || draft.kind === "transfer") return <Notice>Income and transfers do not count as spending. They use Uncategorized and Me.</Notice>;
  const summary = divisionSummary(draft, currency);
  const summaryId = `${id}-summary`;
  function update(index: number, values: Partial<AllocationDraft["splits"][number]>) {
    onChange({ splitMode: draft.splitMode, splits: draft.splits.map((part, position) => position === index ? { ...part, ...values } : part) });
  }
  function options(items: Label[], selected: string) {
    return <><option value="">Choose an option</option>{items.filter((item) => !item.isArchived || item.id === selected).map((item) => <option key={item.id} value={item.id}>{item.name}{item.isArchived ? " (archived)" : ""}</option>)}</>;
  }
  function categoryField(part: AllocationDraft["splits"][number], index: number) {
    return <Selector id={`${id}-${part.key}-category`} label="Spending category (required)" required value={part.categoryId} error={!part.categoryId ? "Choose a spending category." : errors[`splits.${index}.categoryId`]} onChange={(event) => update(index, { categoryId: event.target.value })}>{options(categories, part.categoryId)}</Selector>;
  }
  return <section className="expense-division" aria-label="Spending allocation">
    <div className="panel-heading"><h3>{draft.splitMode ? "Divide this expense" : "Allocation"}</h3></div>
    {!draft.splitMode && <Button onClick={() => onChange(divideExpense(draft, defaults, crypto.randomUUID()))}>Divide this expense</Button>}
    {draft.splitMode && <>
      <div className="division-summary" id={summaryId} role="status" aria-live="polite" aria-atomic="true">
        <p>Original total: <strong>{summary.total}</strong></p>
        <p className={summary.error ? "field-error" : ""}>{summary.remaining}</p>
        {summary.error && <p className="field-error">{summary.error}</p>}
      </div>
    </>}
    {(draft.splitMode ? draft.splits : draft.splits.slice(0, 1)).map((part, index) => <section className="allocation-row" key={part.key} aria-label={`Part ${index + 1}`}>
      {draft.splitMode && <><h4>Part {index + 1}</h4><Field id={`${id}-${part.key}-amount`} label={`Part ${index + 1} amount (${currency}, required)`} value={part.amount} inputMode="decimal" required aria-describedby={summaryId} error={summary.errors[index] ?? errors[`splits.${index}.amount`]} onChange={(event) => update(index, { amount: event.target.value })} /></>}
      {compact ? <details open={!part.categoryId || Boolean(errors[`splits.${index}.categoryId`])}><summary>Category (optional to change): {categories.find(category => category.id === part.categoryId)?.name ?? "Choose category"}</summary>{categoryField(part, index)}</details> : categoryField(part, index)}
      <Selector id={`${id}-${part.key}-bucket`} label={compact ? "Person" : "Responsible for (required)"} labelHelp={<Help label="Responsible for"><p>Choose whose spending this is, regardless of which account was charged. Covered lunch for your parents? Assign their share to Parents. Repayment tracking is optional in Repayments.</p></Help>} required value={part.bucketId} error={!part.bucketId ? "Choose a person or group." : errors[`splits.${index}.bucketId`]} onChange={(event) => update(index, { bucketId: event.target.value })}>{options(buckets, part.bucketId)}</Selector>
      {draft.splitMode && <Button disabled={draft.splits.length === 1} onClick={() => onChange({ splitMode: true, splits: draft.splits.filter((item) => item.key !== part.key) })}>Remove part {index + 1}</Button>}
    </section>)}
    {draft.splitMode && <><div className="help-label"><Help label="Dividing an expense"><p>Enter positive amounts. Parts must equal the original total. Removing a part returns its amount to Still to assign; at least one part must remain.</p></Help><Button disabled={draft.splits.length >= 100} onClick={() => onChange({ splitMode: true, splits: [...draft.splits, { ...defaults, key: crypto.randomUUID(), amount: "" }] })}>Add another part</Button></div>{draft.splits.length >= 100 && <p className="hint">You can divide an expense into up to 100 parts.</p>}</>}
  </section>;
}
