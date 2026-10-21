"use client";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import type { readSheet } from "../sheets/service";
import { displayAmount } from "../ledger/presentation";
import { debtRecordSchema } from "../repayments/debt-input";
import { periodPreviewSchema, type PeriodPreview } from "../repayments/period-input";
import { periodSelection } from "../repayments/period-selection";
import { Button, Field, Notice, Selector } from "./ui";
import { Dialog } from "./dialog";
import { appNavigationEvent } from "./navigation-guard";

export function PeriodGroupingDialog({ sheet, initial, onClose, onSaved, onLost }: { sheet: ReturnType<typeof readSheet>; initial: { from: string; to: string; accountId: string }; onClose: () => void; onSaved: () => void; onLost: (status: number) => void }) {
  const [scope, setScope] = useState({ ...initial, bucketId: "", recipient: "" });
  const [preview, setPreview] = useState<PeriodPreview | null>(null), [selected, setSelected] = useState<Set<string>>(new Set());
  const [description, setDescription] = useState(""), [ack, setAck] = useState(false);
  const [pending, setPending] = useState(false), [uncertain, setUncertain] = useState(false), [conflict, setConflict] = useState(false), [error, setError] = useState("");
  const locked = useRef(false), retry = useRef<string | null>(null);
  const selection = preview ? periodSelection(preview, selected) : null;
  async function send(body: string, saving: boolean) {
    if (locked.current) return;
    locked.current = true; setPending(true); setError("");
    try {
      const response = await fetch(`/api/sheets/${sheet.id}/debts`, { method: "POST", headers: { "Content-Type": "application/json" }, body });
      if (response.status === 401) { onLost(401); return; }
      if (response.status === 404) {
        const access = await fetch(`/api/sheets/${sheet.id}`, { cache: "no-store" });
        if (access.status === 401 || access.status === 404) { onLost(access.status); return; }
      }
      const data: unknown = await response.json();
      if (!response.ok) {
        const message = z.object({ message: z.string() }).safeParse(data);
        setError(message.success ? message.data.message : "Could not complete this action."); setConflict(response.status === 409);
        retry.current = saving && response.status >= 500 ? body : null; setUncertain(Boolean(retry.current)); return;
      }
      if (saving) { debtRecordSchema.parse(data); retry.current = null; setUncertain(false); onSaved(); }
      else {
        const next = periodPreviewSchema.parse(data); setPreview(next); setConflict(false); setAck(false);
        setSelected(new Set([...next.sources.map(source => `${source.transactionId}:${source.position}`), ...next.debts.map(debt => debt.id)]));
        setDescription(`${next.debtor} · ${next.scope.from} through ${next.scope.to}`);
      }
    } catch {
      if (saving) { retry.current = body; setUncertain(true); setError("The save outcome is unknown. Retry the same action before changing or closing this preview."); }
      else setError("Could not load the period. Check your connection and retry.");
    } finally { locked.current = false; setPending(false); }
  }
  function load() { void send(JSON.stringify({ action: "period-preview", input: { ...scope, accountId: scope.accountId || undefined } }), false); }
  function toggle(key: string, checked: boolean) { setSelected(old => { const next = new Set(old); if (checked) next.add(key); else next.delete(key); return next; }); }
  const blocked = pending || uncertain;
  useEffect(() => {
    function unload(event: BeforeUnloadEvent) { if (blocked || preview || scope.bucketId || scope.recipient) { event.preventDefault(); event.returnValue = ""; } }
    function navigation(event: Event) { event.preventDefault(); setError(blocked ? "Resolve the current save before leaving this preview." : "Close the period preview before navigating. Your selection is still here."); }
    window.addEventListener("beforeunload", unload); window.addEventListener(appNavigationEvent, navigation);
    return () => { window.removeEventListener("beforeunload", unload); window.removeEventListener(appNavigationEvent, navigation); };
  }, [blocked, preview, scope.bucketId, scope.recipient]);
  return <Dialog open drawer title="Track period amount" onClose={onClose} pending={blocked} dirty={Boolean(preview || scope.bucketId || scope.recipient)}>
    <p>Choose whose purchases to track and who receives repayment. Both dates are included. Search, category and import filters do not limit this period.</p>
    <fieldset disabled={blocked || Boolean(preview)}><Selector label="Who owes?" id="period-person" required value={scope.bucketId} onChange={event => setScope(old => ({ ...old, bucketId: event.target.value }))}><option value="">Choose person</option>{sheet.buckets.map(person => <option key={person.id} value={person.id}>{person.name}{person.isArchived ? " (archived)" : ""}</option>)}</Selector>
      <Selector label="Recipient" id="period-recipient" required value={scope.recipient} onChange={event => setScope(old => ({ ...old, recipient: event.target.value }))}><option value="">Choose recipient</option>{sheet.buckets.map(person => <option key={person.id} value={person.name}>{person.name}{person.isArchived ? " (archived)" : ""}</option>)}</Selector>
      <Selector label="Account" id="period-account" value={scope.accountId} onChange={event => setScope(old => ({ ...old, accountId: event.target.value }))}><option value="">All accounts</option>{sheet.accounts.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}</Selector>
      <Field label="From" id="period-from" type="date" required value={scope.from} onChange={event => setScope(old => ({ ...old, from: event.target.value }))} /><Field label="Through (included)" id="period-through" type="date" required value={scope.to} onChange={event => setScope(old => ({ ...old, to: event.target.value }))} />
    </fieldset>
    {!preview && <Button disabled={blocked || !scope.bucketId || !scope.recipient || !scope.from || !scope.to} onClick={load}>Preview period</Button>}
    {preview && selection && <>
      <p><strong>{preview.debtor} → {preview.recipient}</strong> · {preview.accountName} · {preview.scope.from} through {preview.scope.to}</p>
      <p>Person&apos;s spending: gross purchases {displayAmount(preview.expenseTotal, sheet.currency)} − refunds {displayAmount(preview.refundTotal, sheet.currency)} = net spending {displayAmount(preview.netSpending, sheet.currency)}. These spending totals include excluded purchases.</p>
      <p role="status">Selected original gross: <strong>{displayAmount(selection.gross, sheet.currency)}</strong> · Paid back: {displayAmount(selection.paid, sheet.currency)} · Still owed: <strong>{displayAmount(selection.remaining, sheet.currency)}</strong></p>
      <fieldset disabled={blocked || conflict}><legend>Include purchases and existing agreements ({selection.count} linked portions selected)</legend>
        <div className="actions"><Button onClick={() => setSelected(new Set())}>Deselect all</Button><Button onClick={() => setSelected(new Set([...preview.sources.map(source => `${source.transactionId}:${source.position}`), ...preview.debts.map(debt => debt.id)]))}>Select all</Button></div>
        {preview.sources.map(source => { const key = `${source.transactionId}:${source.position}`; return <div key={key}><label className="period-source"><input type="checkbox" checked={selected.has(key)} onChange={event => toggle(key, event.target.checked)} /><span>{source.payee} · {source.date} · {source.accountName} · portion {source.position + 1} · {displayAmount(source.amount, sheet.currency)}</span></label><details><summary>Inspect portion {source.position + 1}</summary><p>{preview.debtor} · revision {source.version} · agreed amount {displayAmount(source.amount, sheet.currency)}</p><a href={`/debt-source/${sheet.id}/${source.transactionId}`} target="_blank" rel="noreferrer">Inspect original transaction and allocations</a></details></div>; })}
        {preview.debts.map(debt => <div key={debt.id}><label className="period-source"><input type="checkbox" checked={selected.has(debt.id)} onChange={event => toggle(debt.id, event.target.checked)} /><span>{debt.description} · gross {displayAmount(debt.total, sheet.currency)} · paid {displayAmount(debt.paid, sheet.currency)} · still owed {displayAmount(debt.remaining, sheet.currency)}</span></label><details><summary>Inspect {debt.sources.length} linked portions</summary>{debt.sources.map(source => <p key={`${source.transactionId}:${source.position}`}>{source.payee} · {source.date} · {source.accountName} · {displayAmount(source.amount, sheet.currency)} · <a href={`/debt-source/${sheet.id}/${source.transactionId}`} target="_blank" rel="noreferrer">Inspect original transaction and allocations</a></p>)}<p className="hint">Full payment and correction history is available in Repayments after closing this preview.</p></details></div>)}
        {!preview.sources.length && !preview.debts.length && <p>No eligible purchases or agreements in this scope.</p>}
        <Field id="period-description" label="For what" maxLength={2000} required value={description} onChange={event => setDescription(event.target.value)} />
        {preview.refundTotal > 0 && <label className="period-source"><input type="checkbox" checked={ack} onChange={event => setAck(event.target.checked)} /><span>Track gross expenses; refunds remain separate.</span></label>}
      </fieldset>
      {preview.exclusions.length > 0 && <details><summary>Excluded entries ({preview.exclusions.length})</summary>{preview.exclusions.map((entry, index) => <p key={index}><strong>{entry.label}</strong>: {entry.reason}</p>)}</details>}
      {selection.count > 500 && <Notice tone="warning">This group exceeds 500 linked portions. Deselect entries to create a smaller group; all period candidates are shown.</Notice>}
      <p className="hint">Existing payments and history move to this agreement. Replaced agreements remain in history. Purchases and refunds stay unchanged.</p>
      <div className="actions"><Button disabled={blocked || conflict || selection.count === 0 || selection.count > 500 || selection.gross <= 0n || !description.trim() || (preview.refundTotal > 0 && !ack)} variant="primary" onClick={() => void send(JSON.stringify({ action: "group", input: { requestId: crypto.randomUUID(), description, debtor: preview.debtor, recipient: preview.recipient, sources: selection.sources.map(({ transactionId, version, position }) => ({ transactionId, version, position })), debts: selection.debts.map(({ id, version }) => ({ id, version })), period: { scope: preview.scope, digest: preview.digest, refundAcknowledged: ack } } }), true)}>Track selected amount</Button><Button disabled={blocked} onClick={() => { setPreview(null); setConflict(false); setError(""); }}>Change scope</Button></div>
    </>}
    {error && <Notice tone="error">{error}</Notice>}{conflict && <Button disabled={blocked} onClick={load}>Discard selection and reload preview</Button>}{uncertain && <Button disabled={pending} onClick={() => { if (retry.current) void send(retry.current, true); }}>Retry same action</Button>}
    {pending && <p role="status">{preview ? "Saving period amount…" : "Loading all period candidates…"}</p>}
  </Dialog>;
}

