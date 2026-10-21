"use client";
import { useState } from "react";
import { z } from "zod";
import type { readSheet } from "../sheets/service";
import { gridFilterInput, type GridFilters } from "../ledger/grid-filters";
import { Button, Field, Notice, Selector } from "./ui";
import { Dialog } from "./dialog";

type Sheet = ReturnType<typeof readSheet>;
export function ExpenseToolbar({ sheet, filters, period, onChange, onNew, onColumns, onFilters, onTrack }: {
  sheet: Sheet; filters: GridFilters; period: { from: string; to: string }; onChange: (filters: Partial<GridFilters>) => void; onNew: () => void; onColumns: () => void; onFilters: () => void; onTrack: () => void;
}) {
  const customDates = filters.from !== period.from || filters.to !== period.to;
  const extra = [filters.view === "all" ? "All transactions" : "", customDates ? `${filters.from || "All earlier dates"} through ${filters.to || "all later dates"}` : "", filters.batchId ? "Imported rows" : "", sheet.categories.find(item => item.id === filters.categoryId)?.name, sheet.buckets.find(item => item.id === filters.bucketId)?.name, filters.kind].filter(Boolean);
  const count = Number(customDates) + Number(filters.view === "all") + [filters.batchId, filters.categoryId, filters.bucketId, filters.kind].filter(Boolean).length;
  return <><div className="expense-toolbar">
    <Selector label="Account" id="expense-account" value={filters.accountId} onChange={event => onChange({ accountId: event.target.value })}><option value="">All accounts</option>{sheet.accounts.map(account => <option key={account.id} value={account.id}>{account.name}{account.isArchived ? " (archived)" : ""}</option>)}</Selector>
    <Field label="Search descriptions" id="expense-search" value={filters.payee} type="search" maxLength={200} onChange={event => onChange({ payee: event.target.value })} />
    <div className="actions"><Button data-add-expense variant="primary" onClick={onNew}>Add expense</Button><a className="button secondary" href={`/import${filters.accountId ? `?accountId=${filters.accountId}` : ""}`}>Import CSV</a><Button onClick={onFilters}>Filters{count ? ` (${count})` : ""}</Button><Button aria-label="Columns" title="Columns" onClick={onColumns}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16M15 4v16" /></svg></Button></div>
  </div><div className="expense-period-action"><Button onClick={onTrack}>Track period amount</Button>{extra.length > 0 && <p className="expense-filter-note hint">{extra.join(" · ")}{customDates && filters.from && filters.to ? " · Both dates included" : ""}</p>}</div></>;
}
export function ExpenseFilters({ sheet, filters, onClose, onApply, onClear }: { sheet: Sheet; filters: GridFilters; onClose: () => void; onApply: (next: GridFilters) => void; onClear: (allDates?: boolean) => void }) {
  const [draft, setDraft] = useState(filters), [error, setError] = useState("");
  return <Dialog title="Expense filters" open onClose={onClose} dirty={JSON.stringify(draft) !== JSON.stringify(filters)}><form onSubmit={event => { event.preventDefault(); try { gridFilterInput(draft); onApply(draft); } catch (error) { setError(error instanceof z.ZodError ? error.issues[0]?.message ?? "Check filters." : "Check filters."); } }}>
    <Selector label="Show" id="expense-view" value={draft.view} onChange={event => setDraft(current => ({ ...current, view: event.target.value === "all" ? "all" : "expenses", kind: "" }))}><option value="expenses">Expenses & refunds</option><option value="all">All transactions</option></Selector>
    <Field label="From date" id="expense-from" type="date" value={draft.from} onChange={event => setDraft(current => ({ ...current, from: event.target.value }))} />
    <Field label="Through date" id="expense-to" type="date" value={draft.to} onChange={event => setDraft(current => ({ ...current, to: event.target.value }))} />
    {([{ key: "categoryId", label: "Category", items: sheet.categories }, { key: "bucketId", label: "Person", items: sheet.buckets }] satisfies { key: "categoryId" | "bucketId"; label: string; items: { id: string; name: string; isArchived: boolean }[] }[]).map(({ key, label, items }) => <Selector key={key} label={label} id={`expense-${key}`} value={draft[key]} onChange={event => setDraft(current => ({ ...current, [key]: event.target.value }))}><option value="">All</option>{items.map(item => <option key={item.id} value={item.id}>{item.name}{item.isArchived ? " (archived)" : ""}</option>)}</Selector>)}
    {draft.view === "all" && <Selector label="Kind" id="expense-kind" value={draft.kind} onChange={event => setDraft(current => ({ ...current, kind: event.target.value }))}><option value="">All kinds</option>{["expense", "refund", "income", "transfer"].map(kind => <option key={kind} value={kind}>{kind}</option>)}</Selector>}
    {error && <Notice tone="error">{error}</Notice>}<div className="actions expense-filter-actions"><Button type="submit" variant="primary">Apply filters</Button><Button onClick={() => onClear()}>Clear filters</Button><Button onClick={() => onClear(true)}>All dates</Button></div>
  </form></Dialog>;
}
