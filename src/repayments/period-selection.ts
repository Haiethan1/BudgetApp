import type { PeriodPreview } from "./period-input";

export function periodSelection(preview: PeriodPreview, selected: ReadonlySet<string>) {
  const sources = preview.sources.filter(source => selected.has(`${source.transactionId}:${source.position}`));
  const debts = preview.debts.filter(debt => selected.has(debt.id));
  const gross = sources.reduce((sum, source) => sum + BigInt(source.amount), 0n) + debts.reduce((sum, debt) => sum + BigInt(debt.total), 0n);
  const paid = debts.reduce((sum, debt) => sum + BigInt(debt.paid), 0n);
  return { sources, debts, gross, paid, remaining: gross - paid, count: sources.length + debts.reduce((sum, debt) => sum + debt.sources.length, 0) };
}
