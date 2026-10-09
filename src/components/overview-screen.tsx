"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { loseSheetAccess } from "./sheet-access";
import { z } from "zod";
import type { readSheet } from "@/sheets/service";
import { overviewSchema } from "@/overview/presentation";
import { displayAmount, type LedgerRecord } from "@/ledger/presentation";
import { BudgetBar, Button, EmptyState, LoadingState, Notice, Panel, ResponsiveRecords } from "./ui";
import { TransactionEditor } from "./transaction-editor";
import { monthLabel, sheetHref } from "./shell-state";

export function OverviewScreen({ sheet, month }: { sheet: ReturnType<typeof readSheet>; month: string }) {
  const router = useRouter();
  const [result, setResult] = useState<z.infer<typeof overviewSchema> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [unavailable, setUnavailable] = useState(false);
  const [editor, setEditor] = useState<LedgerRecord | null>(null);
  const requestId = useRef(0);
  const root = useRef<HTMLDivElement>(null);
  const focusAfterReload = useRef<string | null>(null);
  const viewAll = useRef<HTMLAnchorElement>(null);
  const permissionLoss = useCallback((status: number) => { setUnavailable(true); setResult(null); setEditor(null); loseSheetAccess(sheet.id, status); }, [sheet.id]);
  const load = useCallback(async () => {
    const id = ++requestId.current; setLoading(true); setError("");
    try {
      const response = await fetch(`/api/sheets/${sheet.id}/overview?month=${month}`, { cache: "no-store" });
      if (id !== requestId.current) return;
      if (response.status === 401 || response.status === 404) { permissionLoss(response.status); return; }
      const parsed = overviewSchema.safeParse(await response.json());
      if (id !== requestId.current) return;
      if (!response.ok || !parsed.success || parsed.data.month !== month) throw new Error();
      setResult(parsed.data);
    } catch { if (id === requestId.current) { setResult(null); setError("Could not load spending. Try again."); } }
    finally { if (id === requestId.current) setLoading(false); }
  }, [sheet.id, month, permissionLoss]);
  useEffect(() => { const timer = setTimeout(() => void load(), 0); const request = requestId; return () => { clearTimeout(timer); request.current++; }; }, [load]);
  useEffect(() => {
    const id = focusAfterReload.current;
    if (loading || !id || !result) return;
    focusAfterReload.current = null;
    if (document.activeElement !== document.body) return;
    const trigger = Array.from(root.current?.querySelectorAll<HTMLButtonElement>("button[data-transaction-id]") ?? []).find((button) => button.dataset.transactionId === id && button.getClientRects().length > 0);
    (trigger ?? viewAll.current)?.focus();
  }, [loading, result]);
  const ledgerHref = sheetHref(sheet.id, "transactions", month);
  const budgetsHref = sheetHref(sheet.id, "budgets", month);
  const money = (value: number) => displayAmount(value, sheet.currency);
  const budgeted = result?.rows.filter((row) => row.limit !== null) ?? [];
  const dateLabel = (date: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(`${date}T12:00:00`));
  function allocation(record: LedgerRecord, kind: "category" | "bucket") {
    const names = [...new Set(record.splits.map((split) => kind === "category" ? split.categoryName : split.bucketName))];
    return names.length === 1 ? names[0] : `Split across ${names.length} ${kind === "category" ? "categories" : "buckets"}`;
  }
  if (unavailable) return <EmptyState title="This sheet is no longer available">Choose another sheet to continue.</EmptyState>;
  if (loading) return <LoadingState />;
  if (error) return <Panel><Notice tone="error">{error}</Notice><Button onClick={() => void load()}>Retry</Button></Panel>;
  if (!result) return null;
  return <div className="overview-screen" ref={root}>{success && <Notice>{success}</Notice>}
    {!result.hasTransactions && <EmptyState title="No transactions yet" action={<div className="actions"><Link className="button primary" href={`${ledgerHref}&add=1`}>Add transaction</Link><Link className="button" href={sheetHref(sheet.id, "import", month)}>Import CSV</Link></div>}>Add your first transaction or import a CSV to start tracking spending.</EmptyState>}
    <div className="summary-grid"><Panel><p className="summary-label">Net spending</p><p className="summary-value">{money(result.total)}</p><p className="hint">Expenses minus refunds; income and transfers excluded</p></Panel><Panel><p className="summary-label">Remaining in budgeted categories</p><p className={`summary-value${result.remaining < 0 ? " danger-text" : ""}`}>{budgeted.length ? money(result.remaining) : "No limits set"}</p>{budgeted.length > 0 && <p className="hint">{money(result.budgetedSpent)} net spent against {money(result.totalLimits)} in limits{result.remaining < 0 ? " · Overspent" : ""}</p>}<Link href={budgetsHref}>View budgets</Link></Panel><Panel><p className="summary-label">Uncategorized spending</p><p className="summary-value">{money(result.uncategorized)}</p><Link href={`${ledgerHref}&categoryId=${result.uncategorizedId}`}>Review uncategorized</Link></Panel></div>
    {result.hasTransactions && result.monthTransactionCount === 0 && <Notice>No transactions this month. Spending for {monthLabel(month)} is {money(0)}.</Notice>}
    <div className="overview-grid"><Panel><div className="panel-heading"><h2>Category budgets</h2><Link href={budgetsHref}>Edit budgets</Link></div>{budgeted.length ? budgeted.map((row) => <div className="overview-budget-row" key={row.categoryId}><div className="overview-budget-top"><strong>{row.name}{row.archived && <small className="hint"> · Archived</small>}</strong><span>{money(row.spent)} / {money(row.limit ?? 0)}</span></div><BudgetBar spent={row.spent} limit={row.limit ?? 0} label={`${row.name}: ${money(row.spent)} net spent against ${money(row.limit ?? 0)}`} /><div className="overview-budget-detail"><span>Net spent / Monthly limit</span><span className={(row.remaining ?? 0) < 0 ? "danger-text" : ""}>{money(Math.abs(row.remaining ?? 0))} {(row.remaining ?? 0) < 0 ? "overspent" : "remaining"}</span></div></div>) : <><h2>No monthly limits set</h2><p>Set category limits for {monthLabel(month)} to compare spending with your plan.</p><Link className="button" href={budgetsHref}>Set budgets</Link></>}
    <p className="hint">Categories without limits still count toward net spending.</p></Panel><Panel><h2>Expense attribution</h2>{result.attribution.length ? result.attribution.map((bucket) => <div className="attribution-row" key={bucket.id}><span>{bucket.name}{bucket.archived && <small className="hint"> · Archived</small>}</span><span>{money(bucket.spent)}</span></div>) : <p className="hint">No attributed spending this month.</p>}<p className="hint attribution-note">Net expenses by attribution bucket. These amounts do not represent balances or amounts owed.</p></Panel></div>
    <Panel><div className="panel-heading"><h2>Recent transactions</h2><Link ref={viewAll} href={ledgerHref}>View all</Link></div>{result.recent.length ? <ResponsiveRecords headers={["Date", "Payee", "Account", "Category", "Attribution", "Amount"]} rows={result.recent.map((record) => [dateLabel(record.date), <div key="payee"><button data-transaction-id={record.id} className="payee-edit" onClick={() => setEditor(record)} aria-label={`Edit ${record.payee}`}>{record.payee}</button><p className="hint">{record.kind}{record.kind === "income" || record.kind === "transfer" ? " · Excluded from spending" : ""}</p></div>, record.accountName, allocation(record, "category"), allocation(record, "bucket"), <span className="amount" key="amount">{displayAmount(record.amount, sheet.currency, true)}</span>])} cards={result.recent.map((record) => <><div className="transaction-card-heading"><strong>{record.payee}</strong><span className="amount">{displayAmount(record.amount, sheet.currency, true)}</span></div><p className="hint">{dateLabel(record.date)} · {record.accountName} · {record.kind}</p><p className="hint">{allocation(record, "category")} · {allocation(record, "bucket")}</p>{(record.kind === "income" || record.kind === "transfer") && <p className="hint">Excluded from spending</p>}<Button data-transaction-id={record.id} onClick={() => setEditor(record)}>Edit {record.payee}</Button></>)} /> : <p>No transactions this month.</p>}</Panel>
    {editor && <TransactionEditor key={editor.id} sheet={sheet} record={editor} onClose={() => setEditor(null)} onSaved={() => { focusAfterReload.current = editor.id; setEditor(null); setSuccess("Transaction changes saved."); void load(); router.refresh(); }} onUnavailable={permissionLoss} onAccount={async () => sheet.accounts} />}
  </div>;
}
