"use client";
import { Fragment, useSyncExternalStore } from "react";
import { expenseShares } from "../ledger/expense-grid";
import { displayAmount, type LedgerRecord } from "../ledger/presentation";
import { gridColumns, type GridLayout, type PersonColumn } from "../ledger/grid-layout";
import { Button } from "./ui";
import type { useExpenseRow } from "./use-expense-row";
import type { readSheet } from "../sheets/service";
import { ExpenseRowForm } from "./expense-row-form";

function subscribePhone(notify: () => void) { const media = window.matchMedia("(max-width: 767px)"); media.addEventListener("change", notify); return () => media.removeEventListener("change", notify); }
function phoneSnapshot() { return window.matchMedia("(max-width: 767px)").matches; }
function dateLabel(date: string) { return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`)); }
export function OtherShares({ shares, people, visible, currency }: { shares: Map<string, bigint>; people: PersonColumn[]; visible: PersonColumn[]; currency: string }) {
  const hidden = [...shares].filter(([id]) => !visible.some(person => person.id === id));
  if (!hidden.length) return null;
  const total = hidden.reduce((sum, [, amount]) => sum + amount, 0n);
  return <details className="expense-other-shares"><summary>Other shares · {displayAmount(total, currency)}</summary><dl>{hidden.map(([id, amount]) => {
    const person = people.find(person => person.id === id);
    return <div key={id}><dt>{person?.name ?? "Historical person"}{person?.isArchived ? " (archived)" : ""}</dt><dd>{displayAmount(amount, currency)}</dd></div>;
  })}</dl></details>;
}
export function ExpenseGridRecords({ sheet, records, layout, editing, onDetails, onNew }: {
  sheet: ReturnType<typeof readSheet>; records: LedgerRecord[]; layout: GridLayout; editing: ReturnType<typeof useExpenseRow>;
  onDetails: (record: LedgerRecord) => void; onNew: () => void;
}) {
  const phone = useSyncExternalStore(subscribePhone, phoneSnapshot, () => false);
  const columns = gridColumns(sheet.buckets, layout);
  const hidden = records.some(record => record.kind === "expense" || record.kind === "refund" ? [...expenseShares(record).keys()].some(id => !columns.some(person => person.id === id)) : false);
  const form = <ExpenseRowForm sheet={sheet} editing={editing} />;
  const isNew = editing.row?.record === null;
  const orphan = editing.row?.record && !records.some(record => record.id === editing.row?.record?.id);
  function edit(record: LedgerRecord, cell: string) { editing.open(record, cell); }
  function newRow() { return isNew ? form : <div className="expense-blank-row"><input aria-label="What for a new expense" placeholder="Add an expense…" readOnly onFocus={() => { if (!editing.dirty && !editing.blocked) onNew(); }} onClick={onNew} onKeyDown={event => { if (event.key === "Enter") onNew(); }} /><Button onClick={onNew}>Add expense</Button></div>; }
  function personAmount(record: LedgerRecord, person: PersonColumn) {
    const value = expenseShares(record).get(person.id);
    return <Button className="expense-cell" aria-label={`Edit ${person.name} share for ${record.payee}`} onClick={() => edit(record, person.id)}>{value === undefined ? "—" : displayAmount(value, sheet.currency)}</Button>;
  }
  if (phone) return <div className="expense-cards">{records.map(record => {
    const expense = record.kind === "expense" || record.kind === "refund";
    return <article key={record.id} className="expense-card">{editing.row?.record?.id === record.id ? form : <>
      <div className="expense-card-heading"><Button className="expense-what" data-transaction-id={record.id} onClick={() => edit(record, "payee")}>{record.payee}</Button><strong className="amount">{displayAmount(expense ? -record.amount : record.amount, sheet.currency)}</strong></div>
      <p className="hint">{dateLabel(record.date)} · {record.accountName}{record.accountArchived ? " (archived)" : ""}{record.kind === "refund" ? " · Refund" : !expense ? ` · ${record.kind} · Excluded from spending` : ""}</p>
      {expense && <><dl className="expense-card-shares">{columns.map(person => <div key={person.id}><dt>{person.name}{person.isArchived ? " (archived)" : ""}</dt><dd>{personAmount(record, person)}</dd></div>)}</dl><OtherShares shares={expenseShares(record)} people={sheet.buckets} visible={columns} currency={sheet.currency} /></>}
      {record.notes && <p className="expense-note">{record.notes}</p>}
      <div className="actions">{expense && <Button onClick={() => edit(record, "payee")}>Edit amounts</Button>}<Button onClick={() => onDetails(record)}>Details</Button></div>
    </>}</article>;
  })}{orphan && form}<div className="expense-card">{newRow()}</div></div>;
  const count = 4 + columns.length + Number(hidden) + Number(layout.date) + Number(layout.account);
  return <div className="expense-table-scroll"><table className="expense-table"><thead><tr><th scope="col">What</th><th scope="col">Total</th>{columns.map(person => <th scope="col" key={person.id}>{person.name}{person.isArchived ? " (archived)" : ""}</th>)}{hidden && <th scope="col">Other shares</th>}<th scope="col">Notes</th>{layout.date && <th scope="col">Date</th>}{layout.account && <th scope="col">Account</th>}<th scope="col"><span className="sr-only">Actions</span></th></tr></thead><tbody>
    {records.map(record => {
      const expense = record.kind === "expense" || record.kind === "refund";
      return <Fragment key={record.id}>{editing.row?.record?.id === record.id ? <tr className="expense-editing-row"><td colSpan={count}>{form}</td></tr> : <tr>
        <td><Button className="expense-what" data-transaction-id={record.id} onClick={() => edit(record, "payee")}>{record.payee}</Button>{record.kind === "refund" && <span className="hint">Refund</span>}{!expense && <span className="hint">{record.kind} · Excluded from spending</span>}</td>
        <td><Button className="expense-cell" aria-label={`Edit total for ${record.payee}`} onClick={() => edit(record, "total")}>{displayAmount(expense ? -record.amount : record.amount, sheet.currency)}</Button></td>
        {columns.map(person => <td key={person.id}>{expense ? personAmount(record, person) : "—"}</td>)}
        {hidden && <td>{expense && <OtherShares shares={expenseShares(record)} people={sheet.buckets} visible={columns} currency={sheet.currency} />}</td>}
        <td><Button className="expense-note expense-cell" aria-label={`Edit notes for ${record.payee}`} onClick={() => edit(record, "notes")}>{record.notes || "Add note"}</Button></td>
        {layout.date && <td>{dateLabel(record.date)}</td>}{layout.account && <td>{record.accountName}{record.accountArchived ? " (archived)" : ""}</td>}
        <td><Button onClick={() => onDetails(record)}>Details</Button></td>
      </tr>}</Fragment>;
    })}
    {orphan && <tr><td colSpan={count}>{form}</td></tr>}
    <tr className="expense-new-row"><td colSpan={count}>{newRow()}</td></tr>
  </tbody></table></div>;
}
