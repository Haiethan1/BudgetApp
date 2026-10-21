import type { DebtSummary } from "./debt-input";
import { decimalAmount, localDate } from "../ledger/presentation";

export function repaymentDateLabel(debt: DebtSummary) {
  return debt.remaining === 0 ? { label: "Completed", date: debt.completionDate } : { label: "Last received", date: debt.lastReceivedDate };
}
export function receivedDraft(debt: Pick<DebtSummary, "remaining">, currency: string, today = localDate()) {
  return { amount: decimalAmount(debt.remaining, currency), date: today, comment: "" };
}
