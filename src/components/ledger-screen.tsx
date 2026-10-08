"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { loseSheetAccess } from "./sheet-access";
import { z } from "zod";
import type { readSheet } from "@/sheets/service";
import { ledgerPageSchema, displayAmount, type LedgerRecord } from "@/ledger/presentation";
import { ledgerFilters } from "@/ledger/input";
import { sourceTypeSchema } from "@/sheets/settings-input";
import { Button, EmptyState, Field, LoadingState, Notice, Panel, ResponsiveRecords, Selector } from "./ui";
import { Dialog } from "./dialog";
import { TransactionEditor } from "./transaction-editor";

type Sheet = ReturnType<typeof readSheet>;
type Filters = { batchId: string; payee: string; from: string; to: string; accountId: string; kind: string; categoryId: string; bucketId: string };
const clearFilters: Filters = { batchId: "", payee: "", from: "", to: "", accountId: "", kind: "", categoryId: "", bucketId: "" };
function dateLabel(date: string) { return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(`${date}T12:00:00`)); }
export function LedgerScreen({ sheet, month, openNew = false, batchId, categoryId }: { sheet: Sheet; month: string; openNew?: boolean; batchId?: string; categoryId?: string }) {
  const router = useRouter();
  const [accounts, setAccounts] = useState(sheet.accounts);
  const organization = { ...sheet, accounts };
  const monthFilters = { ...clearFilters, from: `${month}-01`, to: `${month}-${new Date(Number(month.slice(0, 4)), Number(month.slice(5)), 0).getDate()}` };
  const [filters, setFilters] = useState<Filters>(batchId ? { ...clearFilters, batchId } : { ...monthFilters, categoryId: categoryId ?? "" });
  const [phoneFilters, setPhoneFilters] = useState(filters);
  const [filterDialog, setFilterDialog] = useState(false);
  const [filterError, setFilterError] = useState("");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<z.infer<typeof ledgerPageSchema> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [editor, setEditor] = useState<{ kind: "new" } | { kind: "edit"; record: LedgerRecord } | null>(openNew ? { kind: "new" } : null);
  const [unavailable, setUnavailable] = useState(false);
  const requestId = useRef(0);
  const [sequence, setSequence] = useState(0);
  const permissionLoss = useCallback((status: number) => { setUnavailable(true); setResult(null); setEditor(null); setFilterDialog(false); loseSheetAccess(sheet.id, status); }, [sheet.id, setEditor, setFilterDialog]);
  const load = useCallback(async () => {
    const current = ++requestId.current;
    const values = Object.fromEntries(Object.entries(filters).filter(([, value]) => value));
    const parsed = ledgerFilters.safeParse({ ...values, page });
    if (!parsed.success) { setFilterError(parsed.error.issues[0]?.message ?? "Check filters."); setLoading(false); return; }
    setFilterError(""); setLoading(true); setError("");
    let correctingPage = false;
    try {
      const params = new URLSearchParams({ ...values, page: String(page) });
      const response = await fetch(`/api/sheets/${sheet.id}/transactions?${params}`, { cache: "no-store" });
      if (current !== requestId.current) return;
      if (response.status === 401) { permissionLoss(response.status); return; }
      if (response.status === 404) {
        const access = await fetch(`/api/sheets/${sheet.id}`, { cache: "no-store" });
        if (current !== requestId.current) return;
        if (access.status === 401 || access.status === 404) { permissionLoss(access.status); return; }
        setError(access.ok ? "This import is no longer available. Clear the import filter to view other transactions." : "Could not verify access. Try again."); setResult(null); return;
      }
      const parsedResult = ledgerPageSchema.safeParse(await response.json());
      if (current !== requestId.current) return;
      if (!response.ok || !parsedResult.success) { setError("Could not load transactions. Try again."); setResult(null); return; }
      const lastPage = Math.max(1, Math.ceil(parsedResult.data.total / 50));
      if (page > lastPage) { correctingPage = true; setResult(null); setPage(lastPage); return; }
      setResult(parsedResult.data);
    } catch { if (current === requestId.current) { setError("Could not connect. Try again."); setResult(null); } }
    finally { if (current === requestId.current && !correctingPage) setLoading(false); }
  }, [filters, page, sheet.id, permissionLoss, setFilterError, setPage]);
  useEffect(() => { const timer = setTimeout(() => void load(), 200); const request = requestId; return () => { clearTimeout(timer); request.current++; }; }, [load]);
  function changeFilters(values: Partial<Filters>) { setFilters((current) => ({ ...current, ...values })); setPage(1); }
  function fields(current: Filters, update: (values: Partial<Filters>) => void, prefix: string) {
    return <><Field label="From date" id={`${prefix}-from`} type="date" value={current.from} onChange={(event) => update({ from: event.target.value })} /><Field label="Through date" id={`${prefix}-to`} type="date" value={current.to} onChange={(event) => update({ to: event.target.value })} />{([{ key: "accountId", label: "Account", items: sheet.accounts }, { key: "categoryId", label: "Category", items: sheet.categories }, { key: "bucketId", label: "Attribution", items: sheet.buckets }] satisfies { key: keyof Filters; label: string; items: { id: string; name: string; isArchived: boolean }[] }[]).map(({ key, label, items }) => <Selector label={label} id={`${prefix}-${key}`} key={key} value={current[key]} onChange={(event) => update({ [key]: event.target.value })}><option value="">All {label.toLowerCase()}</option>{items.map((item) => <option key={item.id} value={item.id}>{item.name}{item.isArchived ? " (archived)" : ""}</option>)}</Selector>)}<Selector label="Kind" id={`${prefix}-kind`} value={current.kind} onChange={(event) => update({ kind: event.target.value })}><option value="">All kinds</option>{["expense", "refund", "income", "transfer"].map((kind) => <option key={kind} value={kind}>{kind[0]?.toUpperCase()}{kind.slice(1)}</option>)}</Selector></>;
  }
  function summary(record: LedgerRecord, kind: "category" | "bucket") {
    const values = [...new Set(record.splits.map((split) => kind === "category" ? split.categoryName : split.bucketName))];
    return values.length === 1 ? values[0] : `Split across ${values.length} ${kind === "category" ? "categories" : "buckets"}`;
  }
  async function accountAdded() {
    const response = await fetch(`/api/sheets/${sheet.id}`, { cache: "no-store" });
    if (response.status === 401 || response.status === 404) { permissionLoss(response.status); return; }
    const parsed = z.object({ accounts: z.array(z.object({ id: z.uuid(), sheetId: z.uuid(), name: z.string(), sourceType: sourceTypeSchema, isArchived: z.boolean(), createdAt: z.coerce.date(), updatedAt: z.coerce.date() })) }).parse(await response.json());
    setAccounts(parsed.accounts); return parsed.accounts;
  }
  if (unavailable) return <EmptyState title="This sheet is no longer available">Choose another sheet to continue.</EmptyState>;
  const active = Object.entries(filters).filter(([, value]) => Boolean(value));
  const onlyMonth = JSON.stringify(filters) === JSON.stringify(monthFilters);
  return <><div className="ledger-toolbar"><Field label="Search payees" id="ledger-search" value={filters.payee} type="search" onChange={(event) => changeFilters({ payee: event.target.value })} maxLength={200} /><Button variant="primary" onClick={() => { setSequence((current) => current + 1); setEditor({ kind: "new" }); }}>Add transaction</Button><Button className="phone-filter-button" onClick={() => { setPhoneFilters(filters); setFilterDialog(true); }}>Filters</Button></div><Panel className="desktop-filters"><div className="filter-grid">{fields(filters, changeFilters, "ledger")}</div></Panel>
    {active.length > 0 && <div className="active-filters"><p className="hint">Active filters: {active.map(([key, value]) => { const items = key === "accountId" ? sheet.accounts : key === "categoryId" ? sheet.categories : key === "bucketId" ? sheet.buckets : []; return `${key === "batchId" ? "Import batch" : key === "accountId" ? "Account" : key === "categoryId" ? "Category" : key === "bucketId" ? "Attribution" : key === "from" ? "From" : key === "to" ? "Through" : key === "payee" ? "Payee" : "Kind"}: ${items.find((item) => item.id === value)?.name ?? value}`; }).join(" · ")}</p><div className="actions">{filters.batchId && <Button onClick={() => { changeFilters({ batchId: "" }); router.replace(`/sheets/${sheet.id}/transactions`); }}>Remove import filter</Button>}<Button onClick={() => { setFilters(clearFilters); setPage(1); router.replace(`/sheets/${sheet.id}/transactions`); }}>Clear filters</Button></div></div>}
    {filterError && <Notice tone="error">{filterError}</Notice>}{success && <Notice>{success}</Notice>}
    {loading ? <LoadingState /> : error ? <Panel><Notice tone="error">{error}</Notice><Button onClick={() => void load()}>Retry</Button></Panel> : result && result.total === 0 ? <EmptyState title={!result.hasTransactions ? "No transactions yet" : onlyMonth ? "No transactions this month" : "No matching transactions"} action={result.hasTransactions ? <Button onClick={() => { setFilters(clearFilters); setPage(1); }}>Clear filters</Button> : <Button variant="primary" onClick={() => setEditor({ kind: "new" })}>Add transaction</Button>}>{result.hasTransactions ? "Change or clear the filters to see transactions." : "Add your first transaction to start tracking spending."}</EmptyState> : result && <Panel><ResponsiveRecords onActivate={(index) => { const record = result.transactions[index]; if (record) setEditor({ kind: "edit", record }); }} headers={["Date", "Payee", "Account", "Category", "Attribution", "Amount"]} rows={result.transactions.map((record) => [dateLabel(record.date), <div key={record.id}><Button className="payee-edit" aria-label={`Edit ${record.payee}`} onClick={(event) => { event.stopPropagation(); setEditor({ kind: "edit", record }); }}>{record.payee}</Button><p className="hint">{record.kind[0]?.toUpperCase()}{record.kind.slice(1)}{record.kind === "transfer" || record.kind === "income" ? " · Excluded from spending" : ""}</p></div>, record.accountName, summary(record, "category"), summary(record, "bucket"), <span className="amount" key="amount">{displayAmount(record.amount, sheet.currency, true)}</span>])} cards={result.transactions.map((record) => <div key={record.id}><div className="transaction-card-heading"><strong>{record.payee}</strong><span className="amount">{displayAmount(record.amount, sheet.currency, true)}</span></div><p className="hint">{dateLabel(record.date)} · {record.accountName} · {record.kind}</p><p className="hint">Category: {summary(record, "category")}<br />Attribution: {summary(record, "bucket")}</p>{(record.kind === "transfer" || record.kind === "income") && <p className="hint">Excluded from spending</p>}<Button onClick={() => setEditor({ kind: "edit", record })}>Edit {record.payee}</Button></div>)} /><div className="ledger-pagination"><span>{(page - 1) * 50 + 1}–{Math.min(page * 50, result.total)} of {result.total} transactions</span><div className="actions"><Button disabled={page === 1} onClick={() => setPage((current) => current - 1)}>Previous</Button><Button disabled={page * 50 >= result.total} onClick={() => setPage((current) => current + 1)}>Next</Button></div></div></Panel>}
    {editor && <TransactionEditor key={editor.kind === "edit" ? editor.record.id : `new-${sequence}`} sheet={organization} record={editor.kind === "edit" ? editor.record : null} onClose={() => { setEditor(null); void load(); }} onUnavailable={permissionLoss} onAccount={accountAdded} onSaved={() => { setEditor(null); setSuccess("Transaction changes saved."); void load(); router.refresh(); }} />}
    {filterDialog && <Dialog title="Filters" open onClose={() => setFilterDialog(false)} dirty={JSON.stringify(phoneFilters) !== JSON.stringify(filters)}><form onSubmit={(event) => { event.preventDefault(); const parsed = ledgerFilters.safeParse(Object.fromEntries(Object.entries(phoneFilters).filter(([, value]) => value))); if (!parsed.success) { setFilterError(parsed.error.issues[0]?.message ?? "Check filters."); return; } setFilters(phoneFilters); setPage(1); setFilterDialog(false); }}><div>{fields(phoneFilters, (values) => setPhoneFilters((current) => ({ ...current, ...values })), "phone")}</div>{filterError && <Notice tone="error">{filterError}</Notice>}<Button type="submit" variant="primary">Apply filters</Button></form></Dialog>}
  </>;
}
