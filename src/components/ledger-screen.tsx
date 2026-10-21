"use client";
import { resolvePeriod } from "../sheets/cycle";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import type { readSheet } from "../sheets/service";
import { ledgerPageSchema, displayAmount, reconcileCycleDates, type Draft, type LedgerRecord } from "../ledger/presentation";
import { emptyGridFilters, gridFilterInput, initialGridFilters, type GridFilters, type LedgerQuery } from "../ledger/grid-filters";
import { gridColumns } from "../ledger/grid-layout";
import { sourceTypeSchema } from "../sheets/settings-input";
import { Button, EmptyState, LoadingState, Notice, Panel } from "./ui";
import { Dialog } from "./dialog";
import { TransactionEditor } from "./transaction-editor";
import { consumedEntryHref } from "./shell-state";
import { loseSheetAccess } from "./sheet-access";
import { useExpenseColumns, ExpenseColumns } from "./expense-columns";
import { ExpenseGridRecords, OtherShares } from "./expense-grid-records";
import { ExpenseRowForm } from "./expense-row-form";
import { ExpenseToolbar, ExpenseFilters } from "./expense-toolbar";
import { useExpenseRow } from "./use-expense-row";
import { PeriodGroupingDialog } from "./period-grouping-dialog";

type Sheet = ReturnType<typeof readSheet>;
type Detail = { record: LedgerRecord | null; transfer?: { draft: Draft; hint: string }; sequence: number };
export function LedgerScreen({ sheet, userId, month, initialAccountId, openNew = false, initialQuery, initialResult }: {
  initialResult?: z.infer<typeof ledgerPageSchema>; sheet: Sheet; userId: string; month: string; initialAccountId?: string; openNew?: boolean; initialQuery?: LedgerQuery;
}) {
  const router = useRouter();
  const { from: cycleFrom, to: cycleTo } = resolvePeriod(month, sheet);
  const serverFilters = initialGridFilters({ from: cycleFrom, to: cycleTo, query: initialQuery });
  const serverQuery = JSON.stringify(serverFilters);
  const [filters, setFilters] = useState(serverFilters);
  const [renderedCycle, setRenderedCycle] = useState({ from: cycleFrom, to: cycleTo, version: sheet.cycleVersion });
  const [renderedQuery, setRenderedQuery] = useState(serverQuery);
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<z.infer<typeof ledgerPageSchema> | null>(initialResult ?? null);
  const [loading, setLoading] = useState(!initialResult);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [filterDialog, setFilterDialog] = useState(false);
  const [columnDialog, setColumnDialog] = useState(false);
  const [periodDialog, setPeriodDialog] = useState(false);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [accounts, setAccounts] = useState(sheet.accounts);
  const [unavailable, setUnavailable] = useState(false);
  const requestSequence = useRef(0);
  const root = useRef<HTMLDivElement>(null);
  const focusAfterReload = useRef<string | null>(null);
  const { layout, save: saveLayout } = useExpenseColumns(userId, sheet.id);
  const organization = { ...sheet, accounts };
  const permissionLoss = useCallback((status: number) => { setUnavailable(true); setResult(null); setDetail(null); setFilterDialog(false); setColumnDialog(false); setPeriodDialog(false); loseSheetAccess(sheet.id, status); }, [sheet.id]);
  const load = useCallback(async () => {
    const current = ++requestSequence.current;
    let parsed: ReturnType<typeof gridFilterInput>;
    try { parsed = gridFilterInput(filters, page); } catch { setError("Check the date range and filters."); setLoading(false); return; }
    setLoading(true); setError("");
    let correctingPage = false;
    try {
      const params = new URLSearchParams(Object.entries(parsed).map(([key, value]) => [key, String(value)]));
      if (filters.from === cycleFrom && filters.to === cycleTo) params.set("cycleVersion", String(sheet.cycleVersion));
      const response = await fetch(`/api/sheets/${sheet.id}/transactions?${params}`, { cache: "no-store" });
      if (current !== requestSequence.current) return;
      if (response.status === 401) { permissionLoss(401); return; }
      if (response.status === 404) {
        const access = await fetch(`/api/sheets/${sheet.id}`, { cache: "no-store" });
        if (current !== requestSequence.current) return;
        if (access.status === 401 || access.status === 404) { permissionLoss(access.status); return; }
        setError(access.ok ? "This import is unavailable. Remove its filter to see other expenses." : "Could not verify access. Try again."); setResult(null); return;
      }
      if (response.status === 409) { setResult(null); setError("The budget cycle changed. Refresh this page to use the latest cycle."); router.refresh(); return; }
      const next = ledgerPageSchema.safeParse(await response.json());
      if (current !== requestSequence.current) return;
      if (!response.ok || !next.success) { setResult(null); setError("Could not load expenses. Try again."); return; }
      const lastPage = Math.max(1, Math.ceil(next.data.total / 50));
      if (page > lastPage) { correctingPage = true; setPage(lastPage); return; }
      setResult(next.data);
    } catch { if (current === requestSequence.current) { setResult(null); setError("Could not connect. Try again."); } }
    finally { if (current === requestSequence.current && !correctingPage) setLoading(false); }
  }, [filters, page, cycleFrom, cycleTo, sheet.id, sheet.cycleVersion, permissionLoss, router]);
  const editing = useExpenseRow({ sheet: organization, onUnavailable: permissionLoss,
    onSaved: () => { focusAfterReload.current = editing.row?.record?.id ?? "new"; setSuccess("Expense saved."); void load(); router.refresh(); },
    onDetails: (record, transfer) => setDetail({ record, transfer, sequence: Date.now() }) });
  const cycleChanged = renderedCycle.version !== sheet.cycleVersion || renderedCycle.from !== cycleFrom || renderedCycle.to !== cycleTo;
  if (cycleChanged || renderedQuery !== serverQuery) {
    const nextCycle = { from: cycleFrom, to: cycleTo, version: sheet.cycleVersion };
    const nextFilters = cycleChanged ? reconcileCycleDates(filters, renderedCycle, nextCycle) : serverFilters;
    setRenderedCycle(nextCycle); setRenderedQuery(serverQuery); setFilters(nextFilters); setPage(1);
    const seed = JSON.stringify(nextFilters) === serverQuery ? initialResult : undefined;
    setResult(seed ?? null); setLoading(!seed);
  }
  const seededLoad = useRef(initialResult ? load : null);
  const previousSeed = useRef(initialResult);
  useEffect(() => {
    const newSeed = previousSeed.current !== initialResult; previousSeed.current = initialResult;
    if (initialResult && page === 1 && JSON.stringify(filters) === serverQuery && (newSeed || seededLoad.current === load)) {
      const timer = setTimeout(() => { setResult(initialResult); setLoading(false); }, 0); return () => clearTimeout(timer);
    }
    const timer = setTimeout(() => { void load(); }, 160);
    const sequence = requestSequence;
    return () => { clearTimeout(timer); sequence.current++; };
  }, [load, initialResult, filters, page, serverQuery]);
  useEffect(() => {
    if (!openNew) return;
    const href = consumedEntryHref(window.location.href); if (href) router.replace(href, { scroll: false });
    const timer = setTimeout(() => editing.open(null, "payee", initialAccountId), 0); return () => clearTimeout(timer);
    // Entry URLs are consumed once; edits must not retrigger their initial action.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openNew, initialAccountId, router]);
  useEffect(() => {
    function open(event: Event) {
      if (!(event instanceof CustomEvent) || detail) return;
      const parsed = z.object({ accountId: z.string() }).safeParse(event.detail);
      if (parsed.success) editing.open(null, "payee", parsed.data.accountId);
    }
    window.addEventListener("homebooks-add-transaction", open); return () => window.removeEventListener("homebooks-add-transaction", open);
  }, [detail, editing]);
  useEffect(() => {
    const target = focusAfterReload.current;
    if (loading || !target) return;
    focusAfterReload.current = null;
    if (document.activeElement !== document.body) return;
    const trigger = Array.from(root.current?.querySelectorAll<HTMLButtonElement>("button[data-transaction-id]") ?? []).find(button => button.dataset.transactionId === target);
    (trigger ?? root.current?.querySelector<HTMLButtonElement>("[data-add-expense]"))?.focus();
  }, [loading, result]);
  function changeFilters(values: Partial<GridFilters>) { editing.request(() => { editing.clear(); setResult(null); setLoading(true); setFilters(current => ({ ...current, ...values })); setPage(1); }); }
  function clearFilters(allDates = false) { editing.request(() => { editing.clear(); setResult(null); setLoading(true); setFilters({ ...emptyGridFilters, ...(allDates ? {} : { from: cycleFrom, to: cycleTo }) }); setPage(1); router.replace(`/transactions?month=${cycleFrom}${allDates ? "&from=&to=" : ""}`, { scroll: false }); }); }
  function newExpense() { editing.open(null, "payee", filters.accountId || initialAccountId); }
  function showDetails(record: LedgerRecord) { editing.request(() => { editing.clear(); setDetail({ record, sequence: Date.now() }); }); }
  async function accountAdded() {
    const response = await fetch(`/api/sheets/${sheet.id}`, { cache: "no-store" });
    if (response.status === 401 || response.status === 404) { permissionLoss(response.status); return; }
    const parsed = z.object({ accounts: z.array(z.object({ id: z.uuid(), sheetId: z.uuid(), name: z.string(), sourceType: sourceTypeSchema, isArchived: z.boolean(), createdAt: z.coerce.date(), updatedAt: z.coerce.date() })) }).parse(await response.json());
    setAccounts(parsed.accounts); return parsed.accounts;
  }
  if (unavailable) return <EmptyState title="This sheet is no longer available">Choose another sheet to continue.</EmptyState>;
  const columns = gridColumns(sheet.buckets, layout);
  const matching = result?.summary;
  return <div ref={root} className="expense-screen">
    <ExpenseToolbar sheet={organization} filters={filters} period={{ from: cycleFrom, to: cycleTo }} onChange={changeFilters} onNew={newExpense} onColumns={() => setColumnDialog(true)} onFilters={() => editing.request(() => setFilterDialog(true))} onTrack={() => editing.request(() => { editing.clear(); setPeriodDialog(true); })} />
    {loading && result && <p className="refresh-indicator" role="status">Updating expenses…</p>}
    {matching && <section className="expense-totals" aria-label="Totals for all matching expenses"><div><span>Net spending</span><strong>{displayAmount(matching.total, sheet.currency)}</strong></div>{columns.map(person => <div key={person.id}><span>{person.name}{person.isArchived ? " (archived)" : ""}</span><strong>{displayAmount(matching.buckets[person.id] ?? 0, sheet.currency)}</strong></div>)}<OtherShares shares={new Map(Object.entries(matching.buckets).map(([id, amount]) => [id, BigInt(amount)]))} people={sheet.buckets} visible={columns} currency={sheet.currency} /></section>}
    {(filters.categoryId || filters.bucketId) && <p className="hint">Totals include all shares of matching purchases, across every page.</p>}
    {success && <Notice>{success}</Notice>}
    {loading && !result ? <LoadingState /> : error ? <Panel><Notice tone="error">{error}</Notice><Button onClick={() => void load()}>Retry</Button></Panel> : result && <Panel className="expense-grid-panel">
      {result.total === 0 && <div className="expense-empty"><h2>{!result.hasTransactions ? "No expenses yet" : "No matching expenses"}</h2><p>{!result.hasTransactions ? "Add an expense below or import a CSV to start." : "Choose another period or clear the filters."}</p></div>}
      <ExpenseGridRecords sheet={organization} records={result.transactions} layout={layout} editing={editing} onDetails={showDetails} onNew={newExpense} />
      {result.total > 0 && <div className="ledger-pagination"><span>{(page - 1) * 50 + 1}–{Math.min(page * 50, result.total)} of {result.total} {filters.view === "expenses" ? "expenses & refunds" : "transactions"}</span><div className="actions"><Button disabled={page === 1 || editing.blocked} onClick={() => editing.request(() => { editing.clear(); setResult(null); setLoading(true); setPage(current => current - 1); })}>Previous</Button><Button disabled={page * 50 >= result.total || editing.blocked} onClick={() => editing.request(() => { editing.clear(); setResult(null); setLoading(true); setPage(current => current + 1); })}>Next</Button></div></div>}
    </Panel>}
    {!result && editing.row && <Panel><ExpenseRowForm sheet={organization} editing={editing} /></Panel>}
    {detail && <TransactionEditor key={detail.sequence} sheet={organization} record={detail.record} initialAccountId={filters.accountId || initialAccountId} initialDraft={detail.transfer?.draft} allocationHint={detail.transfer?.hint} onClose={() => setDetail(null)} onSaved={() => { focusAfterReload.current = detail.record?.id ?? "new"; setDetail(null); setSuccess("Transaction saved."); void load(); router.refresh(); }} onUnavailable={permissionLoss} onAccount={accountAdded} />}
    {columnDialog && <ExpenseColumns people={sheet.buckets} layout={layout} onChange={saveLayout} onClose={() => setColumnDialog(false)} />}
    {periodDialog && <PeriodGroupingDialog sheet={organization} initial={{ from: filters.from || cycleFrom, to: filters.to || cycleTo, accountId: filters.accountId }} onClose={() => setPeriodDialog(false)} onLost={permissionLoss} onSaved={() => { setPeriodDialog(false); setSuccess("Period amount tracked. Repayment history preserved."); router.refresh(); }} />}
    {filterDialog && <ExpenseFilters sheet={organization} filters={filters} onClose={() => setFilterDialog(false)} onClear={allDates => { setFilterDialog(false); clearFilters(allDates); }} onApply={next => { setResult(null); setLoading(true); setFilters(next); setPage(1); setFilterDialog(false); }} />}
    {editing.exit && <Dialog title="Discard row changes?" open onClose={editing.keepEditing}><p>Your unsaved expense row will be discarded.</p><div className="actions"><Button onClick={editing.keepEditing}>Keep editing</Button><Button variant="danger" onClick={editing.discard}>Discard changes</Button></div></Dialog>}
  </div>;
}
