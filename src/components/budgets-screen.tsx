"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { loseSheetAccess } from "./sheet-access";
import { z } from "zod";
import { budgetPageSchema, type BudgetRow } from "@/budgets/presentation";
import { parseLimit } from "@/budgets/input";
import { decimalAmount, displayAmount } from "@/ledger/presentation";
import { Dialog } from "./dialog";
import { monthLabel } from "./shell-state";
import { Button, EmptyState, Field, LoadingState, Notice, Panel, ResponsiveRecords } from "./ui";

type Editor = { row: BudgetRow; initial: string };
export function BudgetsScreen({ sheet, month }: { sheet: { id: string; currency: string }; month: string }) {
  const [result, setResult] = useState<z.infer<typeof budgetPageSchema> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [unavailable, setUnavailable] = useState(false);
  const [success, setSuccess] = useState("");
  const [editor, setEditor] = useState<Editor | null>(null);
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
      setResult(parsed.data);
    } catch { if (id === requestId.current) { setResult(null); setError("Could not load monthly limits. Try again."); } }
    finally { if (id === requestId.current) setLoading(false); }
  }, [endpoint, month, permissionLoss]);
  useEffect(() => { const timer = setTimeout(() => void load(), 0); const request = requestId; return () => { clearTimeout(timer); request.current++; }; }, [load]);
  useEffect(() => {
    const categoryId = focusAfterReload.current;
    if (loading || !categoryId || !result) return;
    const trigger = Array.from(root.current?.querySelectorAll<HTMLButtonElement>("button[data-budget-category]") ?? []).find((button) => button.dataset.budgetCategory === categoryId && button.getClientRects().length > 0);
    (trigger ?? root.current)?.focus(); focusAfterReload.current = null;
  }, [loading, result]);
  function open(row: BudgetRow) {
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
      const row = parsed.data.rows.find((item) => item.categoryId === editor.row.categoryId);
      setResult(parsed.data);
      if (row) open(row);
      else { setEditor(null); setSuccess("This category was archived. Restore it in Settings to set a new limit."); }
    } catch { setMessage("Could not reload. Your entries are preserved. Try again."); }
    finally { inFlight.current = false; setPending(false); }
  }
  async function submit(kind: "save" | "remove") {
    if (!editor || inFlight.current || conflict) return;
    setMessage(""); setFieldError("");
    if (kind === "save") {
      try { parseLimit(amount, sheet.currency); }
      catch (error) { setFieldError(error instanceof Error ? error.message : "Enter a valid monthly limit."); return; }
    }
    inFlight.current = true; setPending(true);
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, categoryId: editor.row.categoryId, month, version: editor.row.version, ...(kind === "save" ? { amount } : {}) }) });
      if (response.status === 401 || response.status === 404) { permissionLoss(response.status); return; }
      const reply = z.object({ message: z.string() }).safeParse(await response.json());
      if (!response.ok) { setMessage(reply.success ? reply.data.message : "Could not save. Your entries are preserved. Try again."); setConflict(response.status === 409); if (response.status === 409) setRemoving(false); return; }
      focusAfterReload.current = editor.row.categoryId;
      setEditor(null); setSuccess(kind === "save" ? "Monthly limit saved." : "Monthly limit removed."); await load();
    } catch { setMessage("Could not connect. Your entries are preserved. Try again."); }
    finally { inFlight.current = false; setPending(false); }
  }
  const money = (value: number) => displayAmount(value, sheet.currency);
  const remaining = (value: number) => <span className={`budget-remaining${value < 0 ? " danger-text" : ""}`}>{money(value < 0 ? -value : value)}{value < 0 ? " overspent" : ""}</span>;
  const action = (row: BudgetRow) => row.archived && row.limit === null ? <span className="hint">Restore in Settings to set a limit</span> : <Button data-budget-category={row.categoryId} aria-label={`${row.limit === null ? "Set" : "Edit"} limit for ${row.name}`} onClick={() => open(row)}>{row.limit === null ? "Set limit" : "Edit limit"}</Button>;
  if (unavailable) return <EmptyState title="This sheet is no longer available">Choose another sheet to continue.</EmptyState>;
  const budgeted = result?.rows.filter((row) => row.limit !== null) ?? [];
  const unbudgeted = result?.rows.filter((row) => row.limit === null) ?? [];
  return <div className="budgets-screen" ref={root} tabIndex={-1}>{success && <Notice>{success}</Notice>}{loading ? <LoadingState /> : error ? <Panel><Notice tone="error">{error}</Notice><Button onClick={() => void load()}>Retry</Button></Panel> : result && <>
    <div className="summary-grid">{[{ label: "Total limits", value: result.totalLimits }, { label: "Net spent in budgeted categories", value: result.budgetedSpent }, { label: "Remaining in budgeted categories", value: result.remaining }].map((summary) => <Panel key={summary.label}><p className="summary-label">{summary.label}</p><p className={`summary-value${summary.label === "Remaining in budgeted categories" && summary.value < 0 ? " danger-text" : ""}`}>{summary.label === "Remaining in budgeted categories" && budgeted.length === 0 ? "No limits set" : money(summary.value)}</p>{summary.label === "Remaining in budgeted categories" && summary.value < 0 && <p className="danger-text">Overspent in budgeted categories</p>}</Panel>)}</div>
    <p className="hint">All attribution buckets count. Income and transfers are excluded. Limits apply only to {monthLabel(month)}; there is no rollover.</p>
    {budgeted.length ? <Panel className="budget-table-panel"><ResponsiveRecords headers={["Category", "Monthly limit", "Net spent", "Remaining", "Actions"]} rows={budgeted.map((row) => [<strong key="name">{row.name}{row.archived && <small className="hint"> · Archived</small>}</strong>, <span className="amount" key="limit">{money(row.limit ?? 0)}</span>, <span className="amount" key="spent">{money(row.spent)}</span>, <span key="remaining">{remaining(row.remaining ?? 0)}</span>, action(row)])} cards={budgeted.map((row) => <><h2>{row.name}{row.archived && <small className="hint"> · Archived</small>}</h2><dl className="budget-card-values"><div><dt>Monthly limit</dt><dd>{money(row.limit ?? 0)}</dd></div><div><dt>Net spent</dt><dd>{money(row.spent)}</dd></div><div><dt>Remaining</dt><dd>{remaining(row.remaining ?? 0)}</dd></div></dl>{action(row)}</>)} /></Panel> : <EmptyState title="No monthly limits set">Set a category limit below. Limits from other months are not copied automatically.</EmptyState>}
    {unbudgeted.length > 0 && <Panel><h2>Categories without limits</h2>{unbudgeted.map((row) => <div className="setting-row" key={row.categoryId}><div><strong>{row.name}{row.archived && <small className="hint"> · Archived</small>}</strong><p className="hint">{money(row.spent)} net spent · No limit</p></div>{action(row)}</div>)}</Panel>}
  </>}{editor && <Dialog open title={removing ? "Remove monthly limit?" : reloadConfirm ? "Reload latest limit?" : editor.row.limit === null ? "Set limit" : "Edit limit"} dirty={amount !== editor.initial} pending={pending} onClose={() => setEditor(null)}>
    <p><strong>{editor.row.name}</strong> · {monthLabel(month)}</p>{message && <Notice tone="error">{message}</Notice>}
    {cancelConfirm ? <><p>Your unsaved amount will be discarded.</p><div className="actions"><Button onClick={() => setCancelConfirm(false)}>Keep editing</Button><Button variant="danger" onClick={() => setEditor(null)}>Discard changes</Button></div></> : reloadConfirm ? <><p>Your unsaved amount will be discarded and replaced with the latest monthly limit.</p><div className="actions"><Button disabled={pending} onClick={() => setReloadConfirm(false)}>Keep editing</Button><Button pending={pending} onClick={() => void reloadLatest()}>Discard changes and reload</Button></div></> : removing ? <><p>This removes the limit for {monthLabel(month)}. The month’s transactions remain.</p><div className="actions"><Button disabled={pending} onClick={() => setRemoving(false)}>Keep limit</Button><Button variant="danger" pending={pending} onClick={() => void submit("remove")}>Remove limit</Button></div></> : <form noValidate onSubmit={(event) => { event.preventDefault(); void submit("save"); }}>
      <Field autoFocus label={`Monthly limit (${sheet.currency})`} id="budget-limit" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} error={fieldError} hint="Enter zero for a zero limit. Remove the limit to leave this category unbudgeted." disabled={pending} maxLength={40} />
      {conflict && <Button disabled={pending} onClick={() => setReloadConfirm(true)}>Reload latest</Button>}
      <div className="actions"><Button type="submit" variant="primary" pending={pending} disabled={conflict}>Save limit</Button><Button disabled={pending} onClick={() => amount !== editor.initial ? setCancelConfirm(true) : setEditor(null)}>Cancel</Button>{editor.row.limit !== null && <Button variant="danger" disabled={pending || conflict} onClick={() => setRemoving(true)}>Remove limit</Button>}</div>
    </form>}
  </Dialog>}</div>;
}
