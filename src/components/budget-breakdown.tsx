import type { BudgetRow } from "../budgets/presentation";
import { displayAmount } from "../ledger/presentation";
export function BudgetBreakdown({ row, currency }: { row: BudgetRow; currency: string }) {
  const money = (value: number) => displayAmount(value, currency);
  return <details className="budget-breakdown"><summary>{money(row.budgetUsed)} budget used</summary><dl><div><dt>Recorded spending</dt><dd>{money(row.spent)}</dd></div><div><dt>Planned contributions</dt><dd>{money(row.planned)}</dd></div><div><dt>Reconciliation</dt><dd>{money(row.reconciliation)}</dd></div><div><dt>Matched expense excluded</dt><dd>{money(row.matched)}</dd></div></dl><p className="hint">Budget used = recorded spending + Planned contributions + reconciliation − matched expense excluded. Each matched expense counts once through its plan. Recorded spending retains its full amount and date.</p></details>;
}
