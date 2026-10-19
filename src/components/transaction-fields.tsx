import { currencyPrecision, parseMoney, transactionKindSchema } from "../ledger/input";
import type { Draft } from "../ledger/presentation";
import { Field, Help, Selector } from "./ui";

type AccountField = { kind: "editable"; accounts: { id: string; name: string; isArchived: boolean }[] } | { kind: "fixed"; name: string };
export function TransactionFields({ id, draft, currency, account, errors = {}, autoFocus = false, validateRequired = false, onChange }: {
  id: string; draft: Draft; currency: string; account: AccountField; errors?: Record<string, string>; autoFocus?: boolean; validateRequired?: boolean;
  onChange: (values: Partial<Draft>) => void;
}) {
  let amountError = errors.amount;
  if (validateRequired && !amountError) {
    try { if (parseMoney(draft.amount, currency) <= 0) amountError = "Enter a positive amount."; }
    catch { amountError = `Use a positive amount with up to ${currencyPrecision(currency)} decimal places.`; }
  }
  const direction = draft.kind === "expense" ? "Money out" : draft.kind === "refund" ? "Money received · reduces spending" : draft.kind === "income" ? "Money in · excluded from spending" : "Excluded from spending";
  return <section className="transaction-core" aria-label="Transaction details">
    <div className="transaction-primary-fields">
      <Field autoFocus={autoFocus} id={`${id}-payee`} label="Description" value={draft.payee} maxLength={200} required error={errors.payee ?? (validateRequired && !draft.payee.trim() ? "Enter a description." : undefined)} onChange={event => onChange({ payee: event.target.value })} />
      <Field className="transaction-amount-input" id={`${id}-amount`} label={`Amount (${currency})`} value={draft.amount} inputMode="decimal" required hint={direction} error={amountError} onChange={event => onChange({ amount: event.target.value })} />
    </div>
    <div className="transaction-detail-fields">
      <Field id={`${id}-date`} label="Date" type="date" value={draft.date} required error={errors.date ?? (validateRequired && !draft.date ? "Enter a real date." : undefined)} onChange={event => onChange({ date: event.target.value })} />
      <Selector id={`${id}-kind`} label="Type" value={draft.kind} onChange={event => onChange({ kind: transactionKindSchema.parse(event.target.value) })}>{["expense", "refund", "income", "transfer"].map(kind => <option key={kind} value={kind}>{kind[0]?.toUpperCase()}{kind.slice(1)}</option>)}</Selector>
      {account.kind === "editable" ? <Selector id={`${id}-account`} label="Account" value={draft.accountId} error={errors.accountId} onChange={event => onChange({ accountId: event.target.value })}><option value="">Choose account</option>{account.accounts.filter(item => !item.isArchived || item.id === draft.accountId).map(item => <option key={item.id} value={item.id}>{item.name}{item.isArchived ? " (archived)" : ""}</option>)}</Selector> : <div className="field fixed-account"><span id={`${id}-account-label`}>Account</span><p aria-labelledby={`${id}-account-label`}>{account.name}</p></div>}
      {draft.kind === "transfer" && <Selector id={`${id}-direction`} label="Transfer direction" value={draft.direction} onChange={event => onChange({ direction: event.target.value === "in" ? "in" : "out" })}><option value="out">Money out</option><option value="in">Money in</option></Selector>}
    </div>
    <Help label="Transaction type"><p>Card payments are Transfers. Expenses add spending; refunds reduce it. Income and transfers are excluded from spending. Enter positive amounts; the type and transfer direction determine the money flow.</p></Help>
  </section>;
}
