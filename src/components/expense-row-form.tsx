"use client";
import { useEffect, useRef } from "react";
import type { readSheet } from "../sheets/service";
import { gridBalance, gridTransaction } from "../ledger/expense-grid";
import { Button, Field, Notice, Selector } from "./ui";
import type { useExpenseRow } from "./use-expense-row";

export function ExpenseRowForm({ sheet, editing }: { sheet: ReturnType<typeof readSheet>; editing: ReturnType<typeof useExpenseRow> }) {
  const root = useRef<HTMLFormElement>(null);
  const row = editing.row;
  const focus = row?.focus, sequence = row?.sequence;
  useEffect(() => {
    const control = Array.from(root.current?.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input,textarea") ?? []).find(control => control.dataset.cell === focus);
    control?.focus(); control?.select();
  }, [focus, sequence]);
  if (!row) return null;
  const { draft, record } = row;
  const me = sheet.buckets.find(person => person.isProtected), category = sheet.categories.find(item => item.isProtected);
  const people = sheet.buckets.filter(person => !person.isArchived || draft.shares[person.id]);
  const balance = gridBalance(draft, sheet.currency);
  let valid = false, complex = "";
  try { if (category) { gridTransaction(draft, record, sheet.currency, category.id); valid = true; } } catch (error) { if (error instanceof Error && error.message.startsWith("Edit category")) complex = error.message; }
  function change(values: Partial<typeof draft>) { editing.change({ ...draft, ...values }); }
  return <form ref={root} className="expense-row-form" aria-label={record ? `Edit expense ${record.payee}` : "New expense"} aria-busy={editing.state.kind === "pending"} noValidate onSubmit={event => { event.preventDefault(); editing.save(); }} onKeyDown={event => {
    if (event.key === "Escape") { event.preventDefault(); editing.cancel(); }
    if (event.key === "Enter" && (!(event.target instanceof HTMLTextAreaElement) || event.ctrlKey || event.metaKey) && !(event.target instanceof HTMLButtonElement)) { event.preventDefault(); editing.save(); }
  }}>
    <h3>{record ? "Edit expense" : "New expense"}</h3>{editing.message && <Notice tone="error">{editing.message}</Notice>}
    {editing.state.kind === "uncertain" && <Button onClick={editing.retry}>Retry same save</Button>}
    {editing.state.kind === "conflict" && <Button onClick={editing.reload}>Reload latest</Button>}
    <fieldset disabled={editing.blocked || editing.state.kind === "missing"}>
      <div className="expense-row-core"><Field data-cell="payee" label="What" id="expense-row-what" value={draft.payee} maxLength={200} required onChange={event => change({ payee: event.target.value })} />
        <Field data-cell="total" label={`Total (${sheet.currency})`} id="expense-row-total" value={draft.total} inputMode="decimal" required hint="Purchases positive; refunds negative." onChange={event => {
          const total = event.target.value;
          const followsTotal = !record && me && Object.entries(draft.shares).every(([id, amount]) => !amount || id === me.id && amount === draft.total);
          change({ total, ...(followsTotal && me ? { shares: { ...draft.shares, [me.id]: total } } : {}) });
        }} />
      </div>
      <div className="expense-row-shares">{people.map(person => <Field data-cell={person.id} key={person.id} label={`${person.name}${person.isArchived ? " (archived)" : ""} (${sheet.currency})`} id={`expense-row-${person.id}`} inputMode="decimal" value={draft.shares[person.id] ?? ""} onChange={event => change({ shares: { ...draft.shares, [person.id]: event.target.value } })} />)}</div>
      <div className="expense-allocation-status"><p role="status" aria-live="polite">{balance.message}</p><Button onClick={editing.fillMe}>Put remaining under Me</Button></div>
      {complex && <Notice tone="warning">{complex}</Notice>}
      {!record && <div className="expense-row-core"><Field label="Date" id="expense-row-date" type="date" value={draft.date} required onChange={event => change({ date: event.target.value })} /><Selector label="Account" id="expense-row-account" value={draft.accountId} required onChange={event => change({ accountId: event.target.value })}><option value="">Choose account</option>{sheet.accounts.filter(account => !account.isArchived).map(account => <option key={account.id} value={account.id}>{account.name}</option>)}</Selector></div>}
      <div className="field"><label htmlFor="expense-row-notes">Notes (optional)</label><textarea data-cell="notes" id="expense-row-notes" rows={2} maxLength={2000} value={draft.notes} onChange={event => change({ notes: event.target.value })} /></div>
    </fieldset>
    <div className="actions"><Button type="submit" variant="primary" pending={editing.state.kind === "pending"} disabled={!valid || editing.blocked || editing.state.kind !== "idle"}>Save expense</Button><Button disabled={editing.blocked} onClick={editing.cancel}>Cancel</Button><Button disabled={editing.blocked || editing.state.kind === "missing"} onClick={editing.details}>Details</Button></div>
    <p className="hint">Tab moves between fields. Enter saves a balanced row; Escape cancels. Notes use Ctrl/⌘ + Enter to save.</p>
  </form>;
}
