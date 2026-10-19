"use client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { loseSheetAccess } from "./sheet-access";
import { z } from "zod";
import { budgetPageSchema, type BudgetRow } from "@/budgets/presentation";
import { parseLimit } from "@/budgets/input";
import { decimalAmount, displayAmount } from "@/ledger/presentation";
import { Dialog } from "./dialog";
import { monthLabel } from "./shell-state";
import { Button, EmptyState, Field, LoadingState, Notice, Panel, ResponsiveRecords, Help } from "./ui";

import { PaymentPlans } from "./payment-plans";
import { BudgetBreakdown } from "./budget-breakdown";
type Editor = { row: BudgetRow; initial: string };
export function BudgetsScreen({ sheet, month, defaults = false, categoryRevision, initialResult }: { initialResult?: z.infer<typeof budgetPageSchema>; sheet: { id: string; currency: string; cycleVersion: number }; month: string; defaults?: boolean; categoryRevision?: string }) {
  const router = useRouter();
  const [result, setResult] = useState<z.infer<typeof budgetPageSchema> | null>(initialResult ?? null);
  const [loading, setLoading] = useState(!initialResult);
  const [serverResult, setServerResult] = useState(initialResult);
  if (serverResult !== initialResult) {
    setServerResult(initialResult);
    if (initialResult) { setResult(initialResult); setLoading(false); }
  }
  const [error, setError] = useState("");
  const [unavailable, setUnavailable] = useState(false);
  const [success, setSuccess] = useState("");
  const [editor, setEditor] = useState<Editor | null>(null);
  const [replaceCurrent, setReplaceCurrent] = useState(false);
  const [makeDefault, setMakeDefault] = useState(false);
  const [amount, setAmount] = useState("");
  const [message, setMessage] = useState("");
  const [fieldError, setFieldError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [reloadConfirm, setReloadConfirm] = useState(false);
  const [cancelConfirm, setCancelConfirm] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const requestId = useRef(0);
  const root = useRef<HTMLDivElement>(null);
  const focusAfterReload = useRef<string | null>(null);
  const endpoint = `/api/sheets/${sheet.id}/budgets`;
  const permissionLoss = useCallback((status: number) => {
    setUnavailable(true); setResult(null); setEditor(null);
    loseSheetAccess(sheet.id, status);
  }, [sheet.id]);
  const load = useCallback(async () => {
    const id = ++requestId.current; setLoading(true); setError("");
    try {
      const response = await fetch(`${endpoint}?month=${month}`, { cache: "no-store" });
      if (id !== requestId.current) return;
      if (response.status === 401 || response.status === 404) { permissionLoss(response.status); return; }
      const parsed = budgetPageSchema.safeParse(await response.json());
      if (id !== requestId.current) return;
      if (!response.ok || !parsed.success || parsed.data.month !== month) throw new Error("Could not load monthly limits. Try again.");
      if (parsed.data.cycle.version !== sheet.cycleVersion) { setResult(null); setError("The budget cycle changed. Refresh this page to use the latest cycle."); router.refresh(); return; }
      setResult(parsed.data);
    } catch { if (id === requestId.current) { setResult(null); setError("Could not load monthly limits. Try again."); } }
    finally { if (id === requestId.current) setLoading(false); }
  }, [endpoint, month, sheet.cycleVersion, permissionLoss, router]);
  const seededLoad = useRef(initialResult ? load : null);
  useEffect(() => { if (seededLoad.current === load) return; const timer = setTimeout(() => void load(), 0); const request = requestId; return () => { clearTimeout(timer); request.current++; }; }, [load, categoryRevision]);
  useEffect(() => {
    const categoryId = focusAfterReload.current;
    if (loading || !categoryId || !result) return;
    const trigger = Array.from(root.current?.querySelectorAll<HTMLButtonElement>("button[data-budget-category]") ?? []).find((button) => button.dataset.budgetCategory === categoryId && button.getClientRects().length > 0);
    (trigger ?? root.current)?.focus(); focusAfterReload.current = null;
  }, [loading, result]);
  function open(row: BudgetRow) {
    if (defaults) row = { ...row, limit: row.defaultLimit, version: row.defaultVersion };
    setMakeDefault(false); setReplaceCurrent(false);
    const initial = row.limit === null ? "" : decimalAmount(row.limit, sheet.currency);
    setEditor({ row, initial }); setAmount(initial); setMessage(""); setFieldError(""); setConflict(false); setReloadConfirm(false); setCancelConfirm(false); setRemoving(false);
  }
  async function reloadLatest() {
    if (!editor || inFlight.current) return;
    inFlight.current = true; setPending(true);
    try {
      const response = await fetch(`${endpoint}?month=${month}`, { cache: "no-store" });
      if (response.status === 401 || response.status === 404) { permissionLoss(response.status); return; }
      const parsed = budgetPageSchema.safeParse(await response.json());
      if (!response.ok || !parsed.success) throw new Error();
      if (parsed.data.cycle.version !== sheet.cycleVersion) { setMessage("The budget cycle changed. Refresh this page before editing a monthly limit."); router.refresh(); return; }
      const row = parsed.data.rows.find((item) => item.categoryId === editor.row.categoryId);
      setResult(parsed.data);
      if (row) open(row);
      else { setEditor(null); setSuccess("This spending category was archived. Restore it in Settings to set a new limit."); }
    } catch { setMessage("Could not reload. Your entries are preserved. Try again."); }
    finally { inFlight.current = false; setPending(false); }
  }
  async function submit(kind: "save" | "remove" | "useDefault") {
    if (!editor || inFlight.current || conflict) return;
    setMessage(""); setFieldError("");
    if (kind === "save") {
      try { parseLimit(amount, sheet.currency); }
      catch (error) { setFieldError(error instanceof Error ? error.message : "Enter a valid monthly limit."); return; }
    }
    inFlight.current = true; setPending(true);
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: defaults ? kind === "save" ? "saveDefault" : "removeDefault" : kind, categoryId: editor.row.categoryId, month, cycleVersion: sheet.cycleVersion, version: editor.row.version, effectiveFrom: editor.row.effectiveFrom, currentVersion: editor.row.currentVersion, replaceCurrent, ...(kind === "save" ? { amount, ...(!defaults ? { makeDefault, defaultVersion: editor.row.defaultVersion } : {}) } : {}) }) });
      if (response.status === 401 || response.status === 404) { permissionLoss(response.status); return; }
      const reply = z.object({ message: z.string() }).safeParse(await response.json());
      if (!response.ok) { setMessage(reply.success ? reply.data.message : "Could not save. Your entries are preserved. Try again."); setConflict(response.status === 409); if (response.status === 409) setRemoving(false); return; }
      focusAfterReload.current = editor.row.categoryId;
      setEditor(null); setSuccess(reply.success ? reply.data.message : "Budget updated."); await load(); router.refresh();
    } catch { setMessage("Could not connect. Your entries are preserved. Try again."); }
    finally { inFlight.current = false; setPending(false); }
  }
  const money = (value: number) => displayAmount(value, sheet.currency);
  const remaining = (value: number) => <span className={`budget-remaining${value < 0 ? " danger-text" : ""}`}>{money(value < 0 ? -value : value)}{value < 0 ? " overspent" : ""}</span>;
  const action = (row: BudgetRow) => row.archived && row.limit === null ? <span className="hint">Restore in Settings to set a limit</span> : <Button data-budget-category={row.categoryId} aria-label={`${row.limit === null ? "Set" : "Edit"} limit for ${row.name}`} onClick={() => open(row)}>{row.limit === null ? "Set limit" : "Edit limit"}</Button>;
  if (unavailable) return <EmptyState title="This sheet is no longer available">Choose another sheet to continue.</EmptyState>;
  const rows = result?.rows.map((row) => defaults ? { ...row, limit: row.defaultLimit, version: row.defaultVersion } : row) ?? [];
  const budgeted = rows.filter((row) => row.limit !== null);
  const unbudgeted = rows.filter((row) => row.limit === null);
  return <div className="budgets-screen" ref={root} tabIndex={-1}>{loading && result && <p className="refresh-indicator" role="status">Updating budgets…</p>}{success && <Notice>{success}</Notice>}{(loading && !result) || (result && result.cycle.version !== sheet.cycleVersion) ? <LoadingState /> : error ? <Panel><Notice tone="error">{error}</Notice><Button onClick={() => void load()}>Retry</Button></Panel> : result && <>
    {!defaults && <div className="summary-grid">{[{ label: "Total limits", value: result.totalLimits }, { label: "Used in budgeted categories", value: result.budgetedUsed }, { label: "Remaining in budgeted categories", value: result.remaining }].map((summary) => <Panel key={summary.label}><p className="summary-label">{summary.label}</p><p className={`summary-value${summary.label === "Remaining in budgeted categories" && summary.value < 0 ? " danger-text" : ""}`}>{summary.label === "Remaining in budgeted categories" && budgeted.length === 0 ? "No limits set" : money(summary.value)}</p>{summary.label === "Remaining in budgeted categories" && summary.value < 0 && <p className="danger-text">Over budget</p>}</Panel>)}</div>}
    <Help label={defaults ? "Default limits" : "Monthly limits"} text={defaults ? "Default limits" : "Monthly limits"}><p>{defaults ? "Defaults apply from the current period onward. Earlier periods and monthly overrides keep their limits." : "Monthly changes override defaults for this period. Use default restores the recurring limit. Unused budget does not roll over."}</p></Help>
    {defaults ? <div>{rows.map((row) => <div className="setting-row" key={row.categoryId}><div><strong>{row.name}</strong><p className="hint">{row.defaultLimit === null ? "No default limit" : money(row.defaultLimit)}{row.archived ? " · Archived" : ""}</p></div>{action(row)}</div>)}</div> : budgeted.length ? <Panel className="budget-table-panel"><ResponsiveRecords headers={["Spending category", "Monthly limit", "Budget breakdown", "Remaining", "Actions"]} rows={budgeted.map((row) => [<strong key="name">{row.name}{row.archived && <small className="hint"> · Archived</small>}</strong>, <span className="amount" key="limit">{money(row.limit ?? 0)}<small className="hint budget-source">{row.source === "default" ? "Default" : "This month"}</small></span>, <BudgetBreakdown key="spent" row={row} currency={sheet.currency} />, <span key="remaining">{remaining(row.remaining ?? 0)}</span>, action(row)])} cards={budgeted.map((row) => <><h2>{row.name}{row.archived && <small className="hint"> · Archived</small>}</h2><dl className="budget-card-values"><div><dt>Monthly limit</dt><dd>{money(row.limit ?? 0)}<small className="hint budget-source">{row.source === "default" ? "Default" : "This month"}</small></dd></div><div><dt>Recorded spending</dt><dd>{money(row.spent)}</dd></div><div><dt>Remaining</dt><dd>{remaining(row.remaining ?? 0)}</dd></div></dl><BudgetBreakdown row={row} currency={sheet.currency} />{action(row)}</>)} /></Panel> : <EmptyState title="No monthly limits set">Set a spending category limit below, or add a default to use every month.</EmptyState>}
    {!defaults && unbudgeted.length > 0 && <Panel><h2>Spending categories without limits</h2>{unbudgeted.map((row) => <div className="setting-row" key={row.categoryId}><div><strong>{row.name}{row.archived && <small className="hint"> · Archived</small>}</strong><p className="hint">{money(row.spent)} recorded spending · No limit</p><BudgetBreakdown row={row} currency={sheet.currency} /></div>{action(row)}</div>)}</Panel>}
    {!defaults && <PaymentPlans sheet={sheet} categories={result.rows} onSaved={() => void load()} />}
  </>}{editor && <Dialog open title={removing ? defaults ? "Remove default limit?" : "Remove monthly limit?" : reloadConfirm ? "Reload latest limit?" : defaults ? "Default budget" : editor.row.limit === null ? "Set limit" : "Edit limit"} dirty={amount !== editor.initial || makeDefault || replaceCurrent} pending={pending} onClose={() => setEditor(null)}>
    <p><strong>{editor.row.name}</strong> · {defaults ? `From ${editor.row.effectiveFrom} onward` : monthLabel(month)}</p>{message && <Notice tone="error">{message}</Notice>}
    {cancelConfirm ? <><p>Your unsaved amount will be discarded.</p><div className="actions"><Button onClick={() => setCancelConfirm(false)}>Keep editing</Button><Button variant="danger" onClick={() => setEditor(null)}>Discard changes</Button></div></> : reloadConfirm ? <><p>Your unsaved amount will be discarded and replaced with the latest limit.</p><div className="actions"><Button disabled={pending} onClick={() => setReloadConfirm(false)}>Keep editing</Button><Button pending={pending} onClick={() => void reloadLatest()}>Discard changes and reload</Button></div></> : removing ? <><p>{defaults ? "This removes the default from the current period onward. Earlier periods and explicit overrides keep their limits." : `This leaves ${monthLabel(month)} without a limit, even if a default is set. Other months and transactions remain.`}</p>{defaults && <p>Effective from {editor.row.effectiveFrom}. {editor.row.currentSource === "month" ? replaceCurrent ? "The current override will return to inheritance with no limit." : `Current override ${editor.row.currentLimit === null ? "Explicit no limit" : money(editor.row.currentLimit)} will remain unchanged.` : "The current period will inherit no limit."} Future explicit overrides remain unchanged.</p>}<div className="actions"><Button disabled={pending} onClick={() => setRemoving(false)}>Keep limit</Button><Button variant="danger" pending={pending} onClick={() => void submit("remove")}>Remove limit</Button></div></> : <form noValidate onSubmit={(event) => { event.preventDefault(); void submit("save"); }}>
      <Field autoFocus label={`${defaults ? "Default" : "Monthly"} limit (${sheet.currency})`} id="budget-limit" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} error={fieldError} hint={defaults ? "Zero is a real limit. Removing the default leaves inheriting current and future periods without a limit." : "Enter zero for a zero limit. Remove the limit to leave this spending category unbudgeted."} disabled={pending} maxLength={40} />
      {!defaults && <div className="budget-default-choice"><label className="checkbox-label"><input type="checkbox" checked={makeDefault} disabled={pending || conflict} onChange={(event) => setMakeDefault(event.target.checked)} />Also change the recurring default from the current period onward</label><p className="hint">Selected period default: {editor.row.periodDefaultLimit === null ? "No limit" : money(editor.row.periodDefaultLimit)}. Removing this period&apos;s limit creates an explicit no-limit override. Use default to return to inheritance.</p>{editor.row.source === "month" && <Button disabled={pending || conflict} onClick={() => void submit("useDefault")}>Use default{editor.row.periodDefaultLimit === null ? " (no limit)" : ""}</Button>}</div>}
      {(defaults || makeDefault) && <div className="budget-default-choice"><p>Effective from {editor.row.effectiveFrom}, the current budget period, into future periods. Earlier limits and spending comparisons stay unchanged. Future explicit overrides stay unchanged.</p>{!defaults && month !== editor.row.effectiveFrom && <p>The selected period {month} gets its own explicit amount. The recurring default starts at {editor.row.effectiveFrom}.</p>}{editor.row.currentSource === "month" ? <><p>Current period override: {editor.row.currentLimit === null ? "Explicit no limit" : money(editor.row.currentLimit)}. {replaceCurrent ? "It will return to the changed default." : "It will remain unchanged."}</p><label className="checkbox-label"><input type="checkbox" checked={replaceCurrent} disabled={pending || conflict} onChange={(event) => setReplaceCurrent(event.target.checked)} />Replace the current period override with this default</label></> : <p>The current period inherits the changed default.</p>}</div>}
      {conflict && <Button disabled={pending} onClick={() => setReloadConfirm(true)}>Reload latest</Button>}
      <div className="actions"><Button type="submit" variant="primary" pending={pending} disabled={conflict}>Save limit</Button><Button disabled={pending} onClick={() => amount !== editor.initial || makeDefault || replaceCurrent ? setCancelConfirm(true) : setEditor(null)}>Cancel</Button>{editor.row.limit !== null && <Button variant="danger" disabled={pending || conflict} onClick={() => setRemoving(true)}>Remove limit</Button>}</div>
    </form>}
  </Dialog>}</div>;
}
