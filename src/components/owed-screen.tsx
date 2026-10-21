"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import type { readSheet } from "@/sheets/service";
import { displayAmount, localDate, decimalAmount } from "@/ledger/presentation";
import { debtFilters, debtPageSchema, debtRecordSchema, debtPreviewSchema, sourcePageSchema, type DebtRecord, type DebtSummary } from "@/repayments/debt-input";
import { receivedDraft } from "../repayments/presentation";
import { RepaymentRecords } from "./repayment-records";
import { Button, EmptyState, Field, LoadingState, Notice, Panel, Selector } from "./ui";
import { Dialog } from "./dialog";
import { loseSheetAccess } from "./sheet-access";
type Sheet = ReturnType<typeof readSheet>;
type DebtMode = "history" | "edit" | "payment" | "correction" | "resolve";
type Page = z.infer<typeof debtPageSchema>;
type Preview = z.infer<typeof debtPreviewSchema>;
type Sources = z.infer<typeof sourcePageSchema>;
function GroupNameField({ sheet, id, label, value, onChange, otherNames = [] }: { sheet: Sheet; id: string; label: string; value: string; onChange: (name: string) => void; otherNames?: string[] }) {
  const [adding, setAdding] = useState(false);
  const names = [...new Set([...sheet.buckets.filter(g => !g.isArchived).map(g => g.name), value, ...otherNames].filter(Boolean))].sort((a, b) => a.localeCompare(b));
  return <><Selector id={id} label={label} required value={adding ? "__new__" : value ? `name:${value}` : ""} onChange={e => { if (e.target.value === "__new__") { setAdding(true); onChange(""); } else { setAdding(false); onChange(e.target.value.slice(5)); } }}>
    <option value="">Choose a person or group</option>{names.map(name => <option key={name} value={`name:${name}`}>{name}</option>)}<option value="__new__">Add person or group…</option>
  </Selector>{adding && <Field id={`${id}-new`} label="New person or group name" required maxLength={80} value={value} onChange={e => onChange(e.target.value)} hint="Also available for transaction allocations." />}</>;
}
function combineSelectionError(selected: Pick<DebtSummary, "debtor" | "recipient" | "needsReview" | "total">[]) {
  const first = selected[0];
  if (!first) return "";
  if (selected.some(d => !d.recipient || d.needsReview || d.total <= 0)) return "Set missing recipients and review changed expenses before combining.";
  if (selected.some(d => d.debtor !== first.debtor || d.recipient !== first.recipient)) return "Choose amounts owed by the same person to the same recipient.";
  return "";
}
function formatDate(value: string) { return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`)); }
function proposedAmount(debt: DebtRecord) { const n = BigInt(debt.total) - debt.sources.reduce((n, s) => n + BigInt(s.amount), 0n) + debt.sources.reduce((n, s) => n + BigInt(s.currentAmount), 0n); return n < 0n || n > BigInt(Number.MAX_SAFE_INTEGER) ? null : Number(n); }
function updated(value: number) { return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(value); }
async function errorMessage(response: Response) { const parsed = z.object({ message: z.string() }).safeParse(await response.json()); return parsed.success ? parsed.data.message : "Could not complete this action. Your entries are preserved."; }
function useDebtAction(sheet: Sheet, onSaved: () => void, onLost: (status: number) => void) {
  const [pending, setPending] = useState(false), [error, setError] = useState(""), [conflict, setConflict] = useState(false), [uncertain, setUncertain] = useState(false);
  const lock = useRef(false); const retry = useRef<unknown>(null);
  async function send(body: unknown) {
    if (lock.current) return; lock.current = true; setPending(true); setError("");
    try {
      const response = await fetch(`/api/sheets/${sheet.id}/debts`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (response.status === 401) { onLost(401); return; }
      if (response.status === 404) { const access = await fetch(`/api/sheets/${sheet.id}`, { cache: "no-store" }); if (access.status === 401 || access.status === 404) { onLost(access.status); return; } }
      if (!response.ok) { setError(await errorMessage(response)); setConflict(response.status === 409); if (response.status >= 500) { retry.current = body; setUncertain(true); } else { retry.current = null; setUncertain(false); } return; }
      retry.current = null; setUncertain(false); onSaved();
    } catch { retry.current = body; setUncertain(true); setError("The save outcome is unknown. Retry the same action safely before making another change."); }
    finally { lock.current = false; setPending(false); }
  }
  return { pending, error, conflict, uncertain, setError, send, retry: () => send(retry.current) };
}
function useDebtPage(sheetId: string, query: string, onLost: (code: number) => void, initial?: Page) {
  const [state, setState] = useState<{ query: string; result: Page | null; loading: boolean; error: string }>({ query, result: initial ?? null, loading: !initial, error: "" });
  const sequence = useRef(0), first = useRef(Boolean(initial));
  const load = useCallback(async () => {
    const request = ++sequence.current;
    setState(old => ({ query, result: old.query === query ? old.result : null, loading: true, error: "" }));
    try {
      const response = await fetch(`/api/sheets/${sheetId}/debts?${query}`, { cache: "no-store" });
      if (request !== sequence.current) return;
      if (response.status === 401 || response.status === 404) { onLost(response.status); return; }
      if (!response.ok) {
        const error = await errorMessage(response);
        if (request === sequence.current) setState(old => ({ ...old, loading: false, error }));
        return;
      }
      const result = debtPageSchema.parse(await response.json());
      if (request === sequence.current) setState({ query, result, loading: false, error: "" });
    } catch { if (request === sequence.current) setState(old => ({ ...old, loading: false, error: "Could not load this section. Check your connection and retry." })); }
  }, [sheetId, query, onLost]);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const timer = setTimeout(() => void load(), 0); const counter = sequence;
    return () => { clearTimeout(timer); counter.current++; };
  }, [load]);
  return { ...(state.query === query ? state : { query, result: null, loading: true, error: "" }), load };
}
export function OwedScreen({ sheet, initialResult, initialRange }: { sheet: Sheet; initialResult: Page; initialRange: { from: string; to: string } }) {
  const router = useRouter();
  const [status, setStatus] = useState<"all" | "outstanding" | "paid">("outstanding"), [debtor, setDebtor] = useState(""), [page, setPage] = useState(1);
  const [range, setRange] = useState(initialRange), [from, setFrom] = useState(initialRange.from), [to, setTo] = useState(initialRange.to), [rangeError, setRangeError] = useState("");
  const [modal, setModal] = useState<{ kind: "create" | "tracking" | "combine" | "group" | "tools" } | { kind: "detail"; debt: DebtRecord; mode: DebtMode } | null>(null);
  const [selected, setSelected] = useState<DebtSummary[]>([]), [selecting, setSelecting] = useState(false), [success, setSuccess] = useState(""), [unavailable, setUnavailable] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false), [detailError, setDetailError] = useState(""); const detailSequence = useRef(0);
  const lost = useCallback((code: number) => { detailSequence.current++; setUnavailable(true); setSelected([]); setModal(null); loseSheetAccess(sheet.id, code); }, [sheet.id]);
  const query = new URLSearchParams({ status, debtor, page: String(page), ...(status === "paid" && range.from ? { from: range.from } : {}), ...(status === "paid" && range.to ? { to: range.to } : {}) }).toString();
  const data = useDebtPage(sheet.id, query, lost, initialResult);
  async function openDebt(id: string, mode: DebtMode = "history") {
    const request = ++detailSequence.current; setDetailLoading(true); setDetailError("");
    try {
      const response = await fetch(`/api/sheets/${sheet.id}/debts?id=${id}`, { cache: "no-store" });
      if (request !== detailSequence.current) return;
      if (response.status === 401 || response.status === 404) { lost(response.status); return; }
      if (!response.ok) { const message = await errorMessage(response); if (request === detailSequence.current) setDetailError(message); return; }
      const debt = debtRecordSchema.parse(await response.json());
      if (request === detailSequence.current) setModal({ kind: "detail", debt, mode });
    } catch { if (request === detailSequence.current) setDetailError("Could not load repayment details. Choose Details to retry."); }
    finally { if (request === detailSequence.current) setDetailLoading(false); }
  }
  function saved(message = "Repayments updated.") { setModal(null); setSelected([]); setSuccess(message); void data.load(); router.refresh(); }
  function changeFilter(next: { status?: typeof status; debtor?: string }) { detailSequence.current++; setDetailLoading(false); setDetailError(""); setSelected([]); if (next.status) { setStatus(next.status); if (next.status !== "outstanding") setSelecting(false); } if (next.debtor !== undefined) setDebtor(next.debtor); setPage(1); }
  function clearHistoryBounds() { setFrom(""); setTo(""); setRange({ from: "", to: "" }); setRangeError(""); setPage(1); }
  if (unavailable) return null;
  const result = data.result, people = result?.people ?? initialResult.people;
  const totals = result?.directions.reduce((sum, direction) => ({ total: sum.total + BigInt(direction.total), paid: sum.paid + BigInt(direction.paid), remaining: sum.remaining + BigInt(direction.remaining) }), { total: 0n, paid: 0n, remaining: 0n });
  const needsRecipient = sheet.buckets.some(group => group.trackRepayment && !group.isProtected && !group.repaymentRecipient);
  return <div className="owed-screen repayments-screen">
    <div className="repayment-toolbar"><Selector label="Show" id="repayment-status" value={status} onChange={event => changeFilter({ status: debtFilters.shape.status.parse(event.target.value) })}><option value="outstanding">Unpaid</option><option value="all">All</option><option value="paid">Paid</option></Selector><Selector label="Who owes?" id="repayment-person" value={debtor} onChange={event => changeFilter({ debtor: event.target.value })}><option value="">All people</option>{people.map(person => <option key={person.debtor} value={person.debtor}>{person.debtor}</option>)}</Selector><div className="actions"><Button variant="primary" onClick={() => setModal({ kind: "create" })}>Add amount</Button><Button onClick={() => setModal({ kind: "tools" })}>Tools</Button></div></div>
    {status === "paid" && <div className="repayment-history-scope"><p className="hint">Completed {range.from ? `from ${formatDate(range.from)}` : "from earliest history"} {range.to ? `through ${formatDate(range.to)}` : "through latest history"}. Both dates included.</p><div className="actions"><Button onClick={clearHistoryBounds}>All history</Button><details><summary>Choose dates</summary><form className="debt-history-filters" onSubmit={event => { event.preventDefault(); if (from && to && from > to) { setRangeError("Start date must be on or before end date."); return; } setRangeError(""); setRange({ from, to }); setPage(1); }}><Field label="Completed on or after" id="history-from" type="date" value={from} onChange={event => setFrom(event.target.value)} /><Field label="Completed on or before" id="history-to" type="date" value={to} onChange={event => setTo(event.target.value)} /><Button type="submit">Load history</Button></form>{rangeError && <Notice tone="error">{rangeError}</Notice>}</details></div></div>}
    {totals && <section className="repayment-totals" aria-label="All matching repayments"><div><span>Still owed</span><strong>{displayAmount(totals.remaining, sheet.currency)}</strong></div><div><span>Paid back</span><strong>{displayAmount(totals.paid, sheet.currency)}</strong></div><p>{result?.total} matching {result?.total === 1 ? "amount" : "amounts"} · {status === "paid" ? "Applied completion dates" : "All dates"}</p></section>}
    {needsRecipient && <Notice tone="warning">Automatic tracking needs a recipient. <Button onClick={() => setModal({ kind: "tracking" })}>Review tracking</Button></Notice>}
    {success && <Notice>{success}</Notice>}{detailLoading && <p role="status">Loading repayment details…</p>}{detailError && <Notice tone="error">{detailError}</Notice>}
    {selecting && <Panel className="owed-selection"><p>Select amounts with the same debtor and recipient. Existing payments stay in history.</p><p role="status">{selected.length} selected</p>{combineSelectionError(selected) && <Notice tone="warning">{combineSelectionError(selected)}</Notice>}<div className="actions"><Button disabled={selected.length < 2 || Boolean(combineSelectionError(selected))} onClick={() => setModal({ kind: "combine" })}>Combine selected ({selected.length})</Button><Button onClick={() => { setSelected([]); setSelecting(false); }}>Done selecting</Button></div></Panel>}
    {data.loading && result && <p role="status">Updating repayments…</p>}
    {data.error ? <Panel><Notice tone="error">{data.error}</Notice><Button onClick={() => void data.load()}>Retry</Button></Panel> : !result ? <LoadingState /> : !result.debts.length ? <EmptyState title={status === "outstanding" ? "Nothing unpaid" : "No matching repayments"} action={page > 1 ? <Button onClick={() => setPage(1)}>Return to first page</Button> : status === "paid" ? <Button onClick={clearHistoryBounds}>All history</Button> : <Button onClick={() => setModal({ kind: "create" })}>Add amount</Button>}>{status === "outstanding" ? "Add a standalone amount or use Tools to track expenses for a person." : "Change the person, status or completion dates to find other records."}</EmptyState> : <Panel className="repayment-table-panel"><RepaymentRecords debts={result.debts} currency={sheet.currency} loading={detailLoading} selecting={selecting} selected={selected} onSelect={(debt, checked) => setSelected(old => checked ? [...old.filter(item => item.id !== debt.id), debt] : old.filter(item => item.id !== debt.id))} onDetails={debt => void openDebt(debt.id, debt.recipient ? "history" : "edit")} onReceived={debt => void openDebt(debt.id, "payment")} /><div className="ledger-pagination"><span>{(page - 1) * result.pageSize + 1}–{Math.min(page * result.pageSize, result.total)} of {result.total} amounts</span><div className="actions"><Button disabled={data.loading || page === 1} onClick={() => setPage(value => value - 1)}>Previous</Button><Button disabled={data.loading || page * result.pageSize >= result.total} onClick={() => setPage(value => value + 1)}>Next</Button></div></div></Panel>}
    {modal?.kind === "tools" && <Dialog open title="Repayment tools" onClose={() => setModal(null)}><div className="repayment-tool-actions"><Button onClick={() => setModal({ kind: "tracking" })}>Track people and groups</Button><Button onClick={() => setModal({ kind: "group" })}>Add from transactions</Button><Button onClick={() => { setModal(null); changeFilter({ status: "outstanding" }); setSelecting(true); }}>Combine amounts</Button></div><h3>Tracked people and groups</h3>{sheet.buckets.filter(group => group.trackRepayment && !group.isProtected).map(group => <p key={group.id}>{group.name} · {group.repaymentRecipient ? `to ${group.repaymentRecipient}` : "Needs recipient"}{group.isArchived ? " · Archived" : ""}</p>)}{!sheet.buckets.some(group => group.trackRepayment && !group.isProtected) && <p>No automatic tracking enabled.</p>}<p className="hint">Repayments are separate from spending. Opposite directions are never netted.</p></Dialog>}
    {modal?.kind === "tracking" && <TrackingForm sheet={sheet} onClose={() => setModal(null)} onSaved={() => saved("Repayment tracking saved.")} onLost={lost} />}
    {modal?.kind === "create" && <DebtForm sheet={sheet} onClose={() => setModal(null)} onSaved={saved} onLost={lost} />}
    {modal?.kind === "detail" && <DebtForm key={modal.debt.id} debt={modal.debt} initialMode={modal.mode} sheet={sheet} onClose={() => setModal(null)} onSaved={saved} onLost={lost} />}
    {modal?.kind === "combine" && <CombineForm sheet={sheet} selected={selected} onClose={() => setModal(null)} onSaved={() => saved("Selected amounts combined. Repayment history preserved.")} onReload={() => saved("Amounts refreshed. Select amounts again to combine.")} onLost={lost} />}
    {modal?.kind === "group" && <GroupForm sheet={sheet} selected={[]} onClose={() => setModal(null)} onSaved={saved} onLost={lost} />}
  </div>;
}
function DebtForm({ sheet, debt: initial, initialMode = "history", onClose, onSaved, onLost }: { sheet: Sheet; debt?: DebtRecord; initialMode?: DebtMode; onClose: () => void; onSaved: () => void; onLost: (code: number) => void }) {
  const [debt, setDebt] = useState(initial), [mode, setMode] = useState<DebtMode>(initialMode);
  const [description, setDescription] = useState(initial?.description ?? ""), [debtor, setDebtor] = useState(initial?.debtor ?? ""), [recipient, setRecipient] = useState(initial?.recipient ?? sheet.buckets.find(g => g.isProtected)?.name ?? ""), [total, setTotal] = useState(initial ? decimalAmount(initial.total, sheet.currency) : "");
  const paymentDraft = initial ? receivedDraft(initial, sheet.currency) : null;
  const [opening, setOpening] = useState(false), [amount, setAmount] = useState(initialMode === "payment" ? paymentDraft?.amount ?? "" : ""), [date, setDate] = useState(paymentDraft?.date ?? localDate()), [comment, setComment] = useState(""), [reason, setReason] = useState(""), [paymentId, setPaymentId] = useState(""), [resolution, setResolution] = useState("keep");
  const [reload, setReload] = useState(false), [reloading, setReloading] = useState(false), [dirty, setDirty] = useState(false);
  const action = useDebtAction(sheet, onSaved, onLost); const blocked = action.pending || action.uncertain || action.conflict || reloading;
  useEffect(() => { const unload = (e: BeforeUnloadEvent) => { if (dirty || action.uncertain) { e.preventDefault(); e.returnValue = ""; } }; window.addEventListener("beforeunload", unload); return () => window.removeEventListener("beforeunload", unload); }, [dirty, action.uncertain]);
  async function reloadLatest() {
    if (!debt) return; setReloading(true);
    try { const response = await fetch(`/api/sheets/${sheet.id}/debts?id=${debt.id}`, { cache: "no-store" }); if (!response.ok) { if (response.status === 401 || response.status === 404) onLost(response.status); else action.setError(await errorMessage(response)); return; } const latest = debtRecordSchema.parse(await response.json()); setDebt(latest); setDescription(latest.description); setDebtor(latest.debtor); setRecipient(latest.recipient ?? ""); setTotal(decimalAmount(latest.total, sheet.currency)); onClose(); onSaved(); }
    catch { action.setError("Could not reload the debt. Your entries are preserved."); } finally { setReloading(false); setReload(false); }
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault(); if (blocked || debt && mode === "history") return;
    const requestId = crypto.randomUUID(); const common = { requestId, version: debt?.version };
    if (!debt) { await action.send({ action: "create", input: { requestId, description, debtor, recipient, total, opening: opening ? { amount, date, comment } : null } }); return; }
    if (mode === "edit") await action.send({ action: "edit", id: debt.id, input: { ...common, description, debtor, recipient, total, reason } });
    if (mode === "payment") await action.send({ action: "payment", id: debt.id, input: { ...common, amount, date, comment } });
    if (mode === "correction") await action.send({ action: "correction", id: debt.id, input: { ...common, paymentId, amount, date, comment, reason } });
    if (mode === "resolve") await action.send({ action: "resolve", id: debt.id, input: { ...common, action: resolution, reason, sources: debt.sources.map(s => ({ id: s.id, version: s.currentVersion })) } });
  }
  return <Dialog open drawer title={debt ? mode === "payment" ? "Record repayment" : "Details and repayment history" : "Add standalone amount"} onClose={onClose} dirty={dirty} pending={action.pending || action.uncertain || reloading}>
    {debt && <><p>{debt.recipient ? `${debt.debtor} owes ${debt.recipient}` : `${debt.debtor} · Recipient needs clarification`}</p><p>Total {displayAmount(debt.total, sheet.currency)} · Paid {displayAmount(debt.paid, sheet.currency)} · Remaining {displayAmount(debt.remaining, sheet.currency)}</p><p>Updated {updated(debt.updatedAt)}</p>
      <details open={mode !== "payment"}><summary>Repayment history and linked expenses</summary><h3>Repayment history</h3>{!debt.payments.length && <p>No repayments recorded.</p>}{debt.payments.map(p => <div className="debt-history" key={p.id}><strong>{p.kind === "opening" ? "Opening amount already repaid" : p.kind === "correction" ? "Repayment correction" : "Repayment"}: {displayAmount(p.amount, sheet.currency)}</strong><p>{formatDate(p.date)}{p.replacementAmount !== null ? ` · Corrected amount ${displayAmount(p.replacementAmount, sheet.currency)}` : ""}</p>{p.comment && <p>{p.comment}</p>}{p.reason && <p>Reason: {p.reason}</p>}{p.replaces && <p>Corrects repayment {p.replaces}</p>}</div>)}
      {debt.sources.length > 0 && <><h3>Linked sources</h3>{debt.sources.map(s => <details className="debt-history" key={s.id}><summary>{s.payee} · {s.bucketName} · Portion {s.position + 1} · {displayAmount(s.amount, sheet.currency)}{s.changed ? " · Needs review" : ""}</summary><p>Original source {formatDate(s.date)}, {displayAmount(s.originalAmount, sheet.currency)}, revision {s.originalVersion}. Acknowledged revision {s.acceptedVersion}.</p><p>Current source: {s.currentPayee}, {formatDate(s.currentDate)}, {s.currentKind}{s.deleted ? ", deleted" : ""}. Current portion {displayAmount(s.currentAmount, sheet.currency)}, revision {s.currentVersion}. Edited portion positions may represent a different allocation; review the transaction before adopting.</p>{(s.legacyDate || s.legacyComment) && <p>Legacy whole-expense record: {s.legacyDate ? formatDate(s.legacyDate) : "Unpaid"} · {s.legacyComment}</p>}<a href={`/debt-source/${sheet.id}/${s.transactionId}`} target="_blank" rel="noreferrer">Inspect original transaction and allocations</a></details>)}</>}
      {debt.changes.length > 0 && <details><summary>Agreement and source review history</summary>{debt.changes.map(c => <p className="debt-history" key={c.id}>{updated(c.createdAt)} · {c.description}</p>)}</details>}
      </details>
      <div className="actions debt-actions">{(["history", "edit", "payment", "correction", "resolve"] as const).filter(v => v !== "resolve" || debt.sources.length > 0).map(v => <Button key={v} disabled={blocked || dirty} aria-pressed={mode === v} onClick={() => { setMode(v); setAmount(v === "payment" && debt ? receivedDraft(debt, sheet.currency).amount : ""); if (v === "payment") setDate(localDate()); setReason(""); setComment(""); setPaymentId(""); }}>{v === "history" ? "History" : v === "edit" ? "Edit agreement" : v === "payment" ? "Record repayment" : v === "correction" ? "Correct repayment" : "Review linked sources"}</Button>)}</div>
    </>}
    {dirty && debt && <p className="hint">Save this draft or close and discard it before switching actions.</p>}
    {action.error && <Notice tone="error">{action.error}</Notice>}{action.uncertain && <Button pending={action.pending} onClick={() => void action.retry()}>Retry same action</Button>}{action.conflict && <Button disabled={reloading} onClick={() => setReload(true)}>Reload latest</Button>}
    {reload ? <Panel><p>Discard your unsaved entries and reload the latest debt?</p><div className="actions"><Button onClick={() => setReload(false)}>Keep editing</Button><Button disabled={reloading} onClick={() => void reloadLatest()}>Discard and reload latest</Button></div></Panel> : debt && mode === "history" ? null : <form onSubmit={submit} onChange={() => setDirty(true)}><fieldset disabled={blocked}>
      {(!debt || mode === "edit") && <><Field id="debt-description" label="Description" required maxLength={2000} value={description} onChange={e => setDescription(e.target.value)} /><GroupNameField sheet={sheet} id="debt-debtor" label="Who owes?" value={debtor} onChange={setDebtor} otherNames={[recipient]} /><GroupNameField sheet={sheet} id="debt-recipient" label="Who receives the repayment?" value={recipient} onChange={setRecipient} otherNames={[debtor]} /><Field id="debt-total" label={`Total owed (${sheet.currency})`} required inputMode="decimal" readOnly={Boolean(debt?.sources.length)} value={total} onChange={e => setTotal(e.target.value)} hint={debt?.sources.length ? "Linked totals change through Review linked sources." : "An independently agreed amount. Do not copy portions already claimed by another debt."} />{!debt && <label className="checkbox-row"><input type="checkbox" checked={opening} onChange={e => setOpening(e.target.checked)} />Some of this amount was already repaid</label>}{debt && <Field id="debt-edit-reason" label="Reason for changing the agreement" required maxLength={2000} value={reason} onChange={e => setReason(e.target.value)} />}</>}
      {(opening && !debt || debt && (mode === "payment" || mode === "correction")) && <>
        {mode === "correction" && <Selector id="debt-payment" label="Original repayment to correct" required value={paymentId} onChange={e => setPaymentId(e.target.value)}><option value="">Choose a repayment</option>{debt?.payments.filter(p => p.kind !== "correction").map(p => <option key={p.id} value={p.id}>{p.kind === "opening" ? "Opening" : "Repayment"} · {formatDate(p.date)} · {displayAmount(p.amount, sheet.currency)}</option>)}</Selector>}
        <Field id="debt-payment-amount" label={`${!debt ? "Opening amount already repaid" : mode === "correction" ? "Corrected repayment amount" : "Repayment amount"} (${sheet.currency})`} required inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} hint={mode === "correction" ? "Enter the replacement amount; zero voids the original. History is retained." : "The remaining amount is filled in. Keep it for full repayment or enter a smaller amount for partial repayment. Spending totals stay unchanged."} /><Field id="debt-payment-date" label={!debt ? "Opening repayment date" : "Repayment date"} type="date" required value={date} onChange={e => setDate(e.target.value)} /><Field id="debt-payment-comment" label="Comment" maxLength={2000} value={comment} onChange={e => setComment(e.target.value)} />{mode === "correction" && <Field id="debt-correction-reason" label="Reason for correction" required maxLength={2000} value={reason} onChange={e => setReason(e.target.value)} />}
      </>}
      {debt && mode === "resolve" && <><Notice>Review every current source above. Keep agreed acknowledges edits, refunds or deletion without changing the debt. Adopt current revises the agreement to the current portion amounts. Edited transactions cannot be claimed again, because portions may have moved.</Notice><Selector id="debt-resolution" label="Resolve source difference" value={resolution} onChange={e => setResolution(e.target.value)}><option value="keep">Keep agreed amount</option><option value="adopt">Adopt current source amounts</option></Selector><p>Current agreed total {displayAmount(debt.total, sheet.currency)}. Proposed total {resolution === "keep" ? displayAmount(debt.total, sheet.currency) : proposedAmount(debt) === null ? "Outside the supported range" : displayAmount(proposedAmount(debt) ?? 0, sheet.currency)}. Paid so far {displayAmount(debt.paid, sheet.currency)}.</p><Field id="debt-review-reason" label="Reason for resolving this difference" required maxLength={2000} value={reason} onChange={e => setReason(e.target.value)} /></>}
      <Button variant="primary" type="submit" pending={action.pending}>{!debt ? "Create debt" : mode === "edit" ? "Save agreement" : mode === "payment" ? "Save repayment" : mode === "correction" ? "Save correction" : "Confirm source resolution"}</Button>
    </fieldset></form>}
  </Dialog>;
}
function CombineForm({ sheet, selected, onClose, onSaved, onReload, onLost }: { sheet: Sheet; selected: DebtSummary[]; onClose: () => void; onSaved: () => void; onReload: () => void; onLost: (code: number) => void }) {
  const [description, setDescription] = useState(`${selected[0]?.debtor ?? "Selected"} expenses`);
  const [dirty, setDirty] = useState(false), [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState(""), [conflict, setConflict] = useState(false), [reload, setReload] = useState(false);
  const sequence = useRef(0);
  const action = useDebtAction(sheet, onSaved, onLost);
  const load = useCallback(async () => {
    const request = ++sequence.current; setLoading(true); setError(""); setPreview(null); setConflict(false);
    try {
      const response = await fetch(`/api/sheets/${sheet.id}/debts`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "preview", input: { sources: [], debts: selected.map(d => ({ id: d.id, version: d.version })) } }) });
      if (request !== sequence.current) return;
      if (response.status === 401) { onLost(401); return; }
      if (response.status === 404) {
        const access = await fetch(`/api/sheets/${sheet.id}`, { cache: "no-store" });
        if (request !== sequence.current) return;
        if (access.status === 401 || access.status === 404) { onLost(access.status); return; }
      }
      if (!response.ok) { const message = await errorMessage(response); if (request === sequence.current) { setError(message); setConflict(response.status === 409 || response.status === 404); } return; }
      const next = debtPreviewSchema.parse(await response.json());
      if (request === sequence.current) setPreview(next);
    } catch { if (request === sequence.current) setError("Could not load the selected amounts. Your selection is preserved."); }
    finally { if (request === sequence.current) setLoading(false); }
  }, [sheet.id, selected, onLost]);
  useEffect(() => { const timer = setTimeout(() => void load(), 0); const counter = sequence; return () => { clearTimeout(timer); counter.current++; }; }, [load]);
  const first = preview?.debts[0];
  const selectionError = combineSelectionError(preview?.debts ?? selected);
  const blocked = loading || !preview || selected.length < 2 || Boolean(selectionError) || action.pending || action.uncertain || action.conflict;
  return <Dialog open title={`Combine ${selected.length} selected amounts`} onClose={onClose} dirty={dirty} pending={action.pending || action.uncertain}>
    {loading && <p role="status">Loading selected amounts…</p>}
    {error && <><Notice tone="error">{error}</Notice>{!conflict && <Button onClick={() => void load()}>Retry selected amounts</Button>}</>}
    {action.error && <Notice tone="error">{action.error}</Notice>}
    {selectionError && <Notice tone="error">{selectionError}</Notice>}
    {action.uncertain && <Button pending={action.pending} onClick={() => void action.retry()}>Retry same action</Button>}
    {(conflict || action.conflict) && <Button onClick={() => setReload(true)}>Reload latest amounts</Button>}
    {reload ? <Panel><p>Discard this draft and clear the selection to load the latest amounts?</p><Button onClick={() => setReload(false)}>Keep draft</Button><Button onClick={onReload}>Discard and reload</Button></Panel> : <>
      {preview && first && <><p><strong>{first.debtor} owes {first.recipient}</strong></p><ul>{preview.debts.map(d => <li key={d.id}>{d.description} · {displayAmount(d.remaining, sheet.currency)} remaining</li>)}</ul><div className="debt-amounts"><p>Total owed <strong>{displayAmount(preview.total, sheet.currency)}</strong></p><p>Already repaid <strong>{displayAmount(preview.paid, sheet.currency)}</strong></p><p>Remaining <strong>{displayAmount(preview.total - preview.paid, sheet.currency)}</strong></p></div></>}
      <p>These selected amounts will become one amount owed. All repayment history is kept, and the balance stays the same.</p>
      <form onSubmit={e => { e.preventDefault(); if (blocked || !first) return; void action.send({ action: "group", input: { requestId: crypto.randomUUID(), description, debtor: first.debtor, recipient: first.recipient, sources: [], debts: selected.map(d => ({ id: d.id, version: d.version })) } }); }}><fieldset disabled={action.pending || action.uncertain || action.conflict}>
        <Field id="combine-description" label="Name for the combined amount" required maxLength={2000} value={description} onChange={e => { setDescription(e.target.value); setDirty(true); }} />
        <div className="actions debt-actions"><Button variant="primary" type="submit" disabled={blocked} pending={action.pending}>Combine amounts</Button><Button disabled={action.pending || action.uncertain} onClick={onClose}>Cancel</Button></div>
      </fieldset></form>
    </>}
  </Dialog>;
}
function TrackingForm({ sheet, onClose, onSaved, onLost }: { sheet: Sheet; onClose: () => void; onSaved: () => void; onLost: (code: number) => void }) {
  const groups = sheet.buckets.filter(g => !g.isProtected);
  const [bucketId, setBucketId] = useState(groups[0]?.id ?? "");
  const group = groups.find(g => g.id === bucketId);
  const [enabled, setEnabled] = useState(Boolean(group?.trackRepayment || !group?.repaymentRecipient));
  const [recipient, setRecipient] = useState(group?.repaymentRecipient ?? sheet.buckets.find(g => g.isProtected)?.name ?? "");
  const [dirty, setDirty] = useState(false), [reload, setReload] = useState(false);
  const action = useDebtAction(sheet, onSaved, onLost);
  const blocked = action.pending || action.uncertain || action.conflict;
  function choose(id: string) {
    const next = groups.find(g => g.id === id);
    setBucketId(id); setEnabled(Boolean(next?.trackRepayment || !next?.repaymentRecipient)); setRecipient(next?.repaymentRecipient ?? sheet.buckets.find(g => g.isProtected)?.name ?? ""); setDirty(true);
  }
  return <Dialog open drawer title="Track people and groups" onClose={onClose} dirty={dirty} pending={action.pending || action.uncertain}>
    <p>Choose whose expenses should appear in Amount owed. Tracking includes their existing expenses and automatically adds future ones, including imports.</p>
    {!groups.length ? <p>Add a person or group in Settings first.</p> : <>
      {action.error && <Notice tone="error">{action.error}</Notice>}
      {action.uncertain && <Button pending={action.pending} onClick={() => void action.retry()}>Retry same action</Button>}
      {action.conflict && <Button onClick={() => setReload(true)}>Reload latest</Button>}
      {reload ? <Panel><p>Discard your tracking draft and reload the latest settings?</p><Button onClick={() => setReload(false)}>Keep editing</Button><Button onClick={onSaved}>Discard and reload latest</Button></Panel> : <form onSubmit={e => { e.preventDefault(); if (!group || blocked) return; void action.send({ action: "tracking", input: { requestId: crypto.randomUUID(), bucketId, version: group.trackingVersion, tracking: enabled ? { enabled: true, recipient } : { enabled: false } } }); }} onChange={() => setDirty(true)}><fieldset disabled={blocked}>
        <Selector id="tracking-group" label="Responsible for" value={bucketId} onChange={e => choose(e.target.value)}>{groups.map(g => <option key={g.id} value={g.id}>{g.name}{g.isArchived ? " (archived)" : ""}</option>)}</Selector>
        <label className="checkbox-row"><input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />Automatically track this group’s expenses</label>
        {enabled && <GroupNameField sheet={sheet} id="tracking-recipient" label="Who receives the repayments?" value={recipient} onChange={setRecipient} />}
        <p>Existing debts and repayments are preserved. Changing the recipient applies to newly added expenses. Turning tracking off stops new additions; it keeps amounts already owed.</p>
        <p className="hint">Expenses already linked to a debt count once. If a linked transaction was edited, review its existing debt before combining amounts.</p>
        <Button variant="primary" type="submit" pending={action.pending}>Save tracking</Button>
      </fieldset></form>}
    </>}
  </Dialog>;
}
function GroupForm({ sheet, selected, onClose, onSaved, onLost }: { sheet: Sheet; selected: DebtSummary[]; onClose: () => void; onSaved: () => void; onLost: (code: number) => void }) {
  const [description, setDescription] = useState(""), [debtor, setDebtor] = useState(selected[0]?.debtor ?? ""), [recipient, setRecipient] = useState(selected[0]?.recipient ?? sheet.buckets.find(g => g.isProtected)?.name ?? ""), [page, setPage] = useState(1);
  const [result, setResult] = useState<Sources | null>(null), [loading, setLoading] = useState(true), [sourceError, setSourceError] = useState(""), [preview, setPreview] = useState<Preview | null>(null), [previewing, setPreviewing] = useState(false);
  const [choices, setChoices] = useState<{ transactionId: string; version: number; position: number | null }[]>([]); const action = useDebtAction(sheet, onSaved, onLost);
  const sequence = useRef(0); const [reload, setReload] = useState(false); const blocked = action.pending || action.uncertain || action.conflict || previewing;
  const load = useCallback(async () => { const request = ++sequence.current; setLoading(true); setSourceError(""); try { const response = await fetch(`/api/sheets/${sheet.id}/debts?sources=true&page=${page}`, { cache: "no-store" }); if (request !== sequence.current) return; if (!response.ok) { if (response.status === 401 || response.status === 404) onLost(response.status); else setSourceError(await errorMessage(response)); return; } const next = sourcePageSchema.parse(await response.json()); if (request === sequence.current) setResult(next); } catch { if (request === sequence.current) setSourceError("Could not load source transactions. Retry."); } finally { if (request === sequence.current) setLoading(false); } }, [sheet.id, page, onLost]);
  useEffect(() => { const timer = setTimeout(() => void load(), 0); const counter = sequence; return () => { clearTimeout(timer); counter.current++; }; }, [load]);
  const selection = { sources: choices, debts: selected.map(d => ({ id: d.id, version: d.version })) };
  function choose(s: Sources["sources"][number], whole: boolean, checked: boolean) { setPreview(null); setChoices(old => checked ? [...old.filter(v => v.transactionId !== s.transactionId || (!whole && v.position !== null && v.position !== s.position)), { transactionId: s.transactionId, version: s.version, position: whole ? null : s.position }] : old.filter(v => !(v.transactionId === s.transactionId && v.position === (whole ? null : s.position)))); }
  async function showPreview(e: React.FormEvent) { e.preventDefault(); if (blocked) return; setPreviewing(true); action.setError(""); try { const response = await fetch(`/api/sheets/${sheet.id}/debts`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "preview", input: selection }) }); if (!response.ok) { if (response.status === 401) onLost(401); else action.setError(await errorMessage(response)); return; } setPreview(debtPreviewSchema.parse(await response.json())); } catch { action.setError("Could not preview the sources. Your selection is preserved. Retry."); } finally { setPreviewing(false); } }
  return <Dialog open drawer title="Add from transactions" onClose={onClose} dirty={Boolean(description || choices.length)} pending={action.pending || action.uncertain || previewing}>
    <p>Select existing debts or expense portions. A whole expense claims every portion. Sources can belong to only one debt. Grouping preserves repayment history and replaces the included debts in totals.</p>{selected.map(d => <p key={d.id}>Selected debt: {d.description} · {d.debtor} owes {d.recipient ?? "Needs clarification"} · Total {displayAmount(d.total, sheet.currency)} · Paid {displayAmount(d.paid, sheet.currency)}</p>)}
    <p>Existing debts must have the same explicit debtor and recipient. Resolve missing direction and source reviews before grouping. Ordinary People and groups only describe spending; they do not establish debt direction.</p>
    {action.error && <Notice tone="error">{action.error}</Notice>}{action.uncertain && <Button pending={action.pending} onClick={() => void action.retry()}>Retry same action</Button>}{action.conflict && <Button onClick={() => setReload(true)}>Reload latest</Button>}{reload && <Panel><p>Discard this grouping draft and reload the latest debts?</p><Button onClick={() => setReload(false)}>Keep editing</Button><Button onClick={onSaved}>Discard and reload latest</Button></Panel>}
    <form onSubmit={showPreview}><fieldset disabled={blocked}><Field id="group-description" label="Description" required maxLength={2000} value={description} onChange={e => { setDescription(e.target.value); setPreview(null); }} /><GroupNameField sheet={sheet} id="group-debtor" label="Who owes?" value={debtor} onChange={name => { setDebtor(name); setPreview(null); }} otherNames={[recipient]} /><GroupNameField sheet={sheet} id="group-recipient" label="Who receives the repayment?" value={recipient} onChange={name => { setRecipient(name); setPreview(null); }} otherNames={[debtor]} />
      {loading ? <LoadingState /> : sourceError ? <><Notice tone="error">{sourceError}</Notice><Button onClick={() => void load()}>Retry sources</Button></> : result && <><h3>Source transactions and split portions</h3>{result.sources.map(s => <div className="debt-history" key={`${s.transactionId}:${s.position}`}><p><strong>{s.payee}</strong> · {formatDate(s.date)} · {s.bucketName} · Portion {s.position + 1} · {displayAmount(s.amount, sheet.currency)}</p><div className="debt-actions"><label className="checkbox-row"><input type="checkbox" checked={choices.some(v => v.transactionId === s.transactionId && v.position === s.position)} disabled={choices.some(v => v.transactionId === s.transactionId && v.position === null)} onChange={e => choose(s, false, e.target.checked)} />Include this portion</label><label className="checkbox-row"><input type="checkbox" checked={choices.some(v => v.transactionId === s.transactionId && v.position === null)} onChange={e => choose(s, true, e.target.checked)} />Include whole expense</label></div><a href={`/debt-source/${sheet.id}/${s.transactionId}`} target="_blank" rel="noreferrer">Inspect source transaction</a></div>)}<div className="ledger-pagination"><span>Source portions {(page - 1) * 50 + 1}–{Math.min(page * 50, result.total)} of {result.total}</span><div className="actions"><Button disabled={page === 1} onClick={() => setPage(page - 1)}>Previous sources</Button><Button disabled={page * 50 >= result.total} onClick={() => setPage(page + 1)}>Next sources</Button></div></div></>}
      <p>{choices.length} source selections and {selected.length} existing debts selected across pages.</p><Button type="submit" disabled={loading || (!choices.length && !selected.length)}>Preview grouped agreement</Button>
      {preview && <Panel><h3>Confirm the sources and combined amount</h3>{preview.sources.map(s => <p key={`${s.transactionId}:${s.position}`}>{s.payee} · {s.bucketName} · Portion {s.position + 1}: {displayAmount(s.amount, sheet.currency)}</p>)}{preview.debts.map(d => <p key={d.id}>{d.description}: {displayAmount(d.total, sheet.currency)} · Paid {displayAmount(d.paid, sheet.currency)}</p>)}<p>{debtor} owes {recipient}</p><p>Total {displayAmount(preview.total, sheet.currency)} · Paid so far {displayAmount(preview.paid, sheet.currency)} · Remaining {displayAmount(preview.total - preview.paid, sheet.currency)}</p><Button variant="primary" onClick={() => void action.send({ action: "group", input: { requestId: crypto.randomUUID(), description, debtor, recipient, ...selection } })}>Confirm grouped debt</Button></Panel>}
    </fieldset></form>
  </Dialog>;
}
