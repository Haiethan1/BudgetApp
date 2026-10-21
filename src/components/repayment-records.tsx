import type { DebtSummary } from "../repayments/debt-input";
import { displayAmount } from "../ledger/presentation";
import { repaymentDateLabel } from "../repayments/presentation";
import { Button, Badge, ResponsiveRecords } from "./ui";

function dateLabel(date: string) { return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`)); }
export function RepaymentRecords({ debts, currency, loading, selecting, selected, onSelect, onDetails, onReceived }: {
  debts: DebtSummary[]; currency: string; loading: boolean; selecting: boolean; selected: DebtSummary[];
  onSelect: (debt: DebtSummary, checked: boolean) => void; onDetails: (debt: DebtSummary) => void; onReceived: (debt: DebtSummary) => void;
}) {
  function who(debt: DebtSummary) { return <div className="repayment-who"><strong>{debt.debtor}</strong><span>{debt.recipient ? `to ${debt.recipient}` : "Needs recipient"}</span></div>; }
  function status(debt: DebtSummary) { return <div className="repayment-status">{!debt.recipient && <Badge tone="warning">Needs recipient</Badge>}{debt.needsReview && <Badge tone="warning">Review source</Badge>}{debt.remaining > 0 && debt.paid > 0 && <Badge>Partial</Badge>}{debt.remaining === 0 && <Badge>Paid</Badge>}</div>; }
  function received(debt: DebtSummary) { const date = repaymentDateLabel(debt); return date.date ? <div className="repayment-date"><span>{date.label}</span><time dateTime={date.date}>{dateLabel(date.date)}</time></div> : "—"; }
  function actions(debt: DebtSummary) { return <div className="actions repayment-row-actions">{debt.remaining > 0 && debt.recipient && <Button variant="primary" disabled={loading} onClick={() => onReceived(debt)} aria-label={`Received repayment for ${debt.description}`}>Received</Button>}<Button disabled={loading} onClick={() => onDetails(debt)}>{debt.recipient ? "Details" : "Set recipient"}</Button></div>; }
  function checkbox(debt: DebtSummary) { return <label className="checkbox-row"><input type="checkbox" checked={selected.some(item => item.id === debt.id)} disabled={!debt.recipient || debt.needsReview || debt.total <= 0} onChange={event => onSelect(debt, event.target.checked)} />Select{!debt.recipient ? " · Set recipient first" : debt.needsReview ? " · Review source first" : ""}</label>; }
  function notes(debt: DebtSummary) { return debt.hasNotes ? <Button className="repayment-note-button" disabled={loading} onClick={() => onDetails(debt)} aria-label={`View notes for ${debt.description}`}>View notes</Button> : "—"; }
  return <div className="repayment-records"><ResponsiveRecords headers={[...(selecting ? ["Select"] : []), "Who", "For what", "Owed", "Paid back", "Still owed", "Received on", "Notes", "Actions"]}
    rows={debts.map(debt => [...(selecting ? [checkbox(debt)] : []), who(debt), <div key="what" className="repayment-description">{debt.description}{status(debt)}</div>, <span key="owed" className="amount">{displayAmount(debt.total, currency)}</span>, <span key="paid" className="amount">{displayAmount(debt.paid, currency)}</span>, <strong key="remaining" className="amount">{displayAmount(debt.remaining, currency)}</strong>, received(debt), notes(debt), actions(debt)])}
    cards={debts.map(debt => <div key={debt.id}>{who(debt)}<h3>{debt.description}</h3>{status(debt)}<dl className="repayment-card-amounts"><div><dt>Owed</dt><dd>{displayAmount(debt.total, currency)}</dd></div><div><dt>Paid back</dt><dd>{displayAmount(debt.paid, currency)}</dd></div><div><dt>Still owed</dt><dd><strong>{displayAmount(debt.remaining, currency)}</strong></dd></div></dl>{received(debt)}{debt.hasNotes && <p>{notes(debt)}</p>}{selecting && checkbox(debt)}{actions(debt)}</div>)} /></div>;
}
