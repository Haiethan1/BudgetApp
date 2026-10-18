"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { planPageSchema, type PlanRecord } from "../plans/input";
import { decimalAmount, displayAmount } from "../ledger/presentation";
import { today } from "../sheets/cycle";
import { Dialog } from "./dialog";
import { Help, Button, Field, LoadingState, Notice, Panel, Selector } from "./ui";
import { loseSheetAccess } from "./sheet-access";
type Editor = { kind: "create" } | { kind: "edit" | "next" | "match" | "cancel" | "skip" | "release"; plan: PlanRecord };
const recurrence = z.union([z.literal(0), z.literal(1), z.literal(6), z.literal(12)]);
export function PaymentPlans({ sheet, categories, onSaved }: { sheet: { id: string; currency: string; cycleVersion: number }; categories: { categoryId: string; name: string; archived: boolean }[]; onSaved: () => void }) {
  const router = useRouter();
  const [result, setResult] = useState<z.infer<typeof planPageSchema> | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [loading, setLoading] = useState(true); const [error, setError] = useState(""); const [unavailable, setUnavailable] = useState(false);
  const [editor, setEditor] = useState<Editor | null>(null); const [pending, setPending] = useState(false); const [message, setMessage] = useState(""); const [conflict, setConflict] = useState(false);
  const [name, setName] = useState(""); const [amount, setAmount] = useState(""); const [dueDate, setDueDate] = useState(""); const [categoryId, setCategoryId] = useState(""); const [repeat, setRepeat] = useState<0 | 1 | 6 | 12>(0); const [candidate, setCandidate] = useState("");
  const inFlight = useRef(false); const request = useRef<{ payload: string; id: string } | null>(null); const sequence = useRef(0);
  const endpoint = `/api/sheets/${sheet.id}/plans`;
  const money = (value: number) => displayAmount(value, sheet.currency);
  const load = useCallback(async () => {
    const id = ++sequence.current; setLoading(true); setError("");
    try {
      const response = await fetch(endpoint, { cache: "no-store" });
      if (id !== sequence.current) return;
      if (response.status === 401 || response.status === 404) { setUnavailable(true); setResult(null); setEditor(null); loseSheetAccess(sheet.id, response.status); return; }
      const parsed = planPageSchema.safeParse(await response.json());
      if (id !== sequence.current) return;
      if (!response.ok || !parsed.success) throw new Error();
      setResult(parsed.data);
    } catch { if (id === sequence.current) setError("Could not load payment plans. Try again."); }
    finally { if (id === sequence.current) setLoading(false); }
  }, [endpoint, sheet.id]);
  useEffect(() => { const timer = setTimeout(() => void load(), 0); const requests = sequence; return () => { clearTimeout(timer); requests.current++; }; }, [load, sheet.cycleVersion]);
  function open(value: Editor) {
    const plan = "plan" in value ? value.plan : null;
    setUncertain(false); setEditor(value); setName(plan?.name ?? ""); setAmount(plan ? decimalAmount(plan.expected, sheet.currency) : ""); setDueDate(value.kind === "next" ? value.plan.nextDueDate ?? today() : plan?.dueDate ?? today()); setCategoryId(plan?.categoryId ?? categories.find(row => !row.archived)?.categoryId ?? ""); setRepeat(recurrence.parse(plan?.recurrence ?? 0)); setCandidate(""); setMessage(""); setConflict(false); request.current = null;
  }
  async function save() {
    if (!editor || !result || inFlight.current || conflict) return;
    const base = { kind: editor.kind, cycleVersion: result.cycleVersion, currentPeriod: result.currentPeriod, ...("plan" in editor ? { id: editor.plan.id, version: editor.plan.version } : {}) };
    let payload: object;
    if (uncertain && request.current) payload = z.record(z.string(), z.unknown()).parse(JSON.parse(request.current.payload));
    else if (editor.kind === "create" || editor.kind === "edit" || editor.kind === "next") payload = { ...base, name, amount, dueDate, categoryId, recurrence: repeat };
    else if (editor.kind === "match") {
      const selected = result.candidates.find(row => row.id === candidate);
      if (!selected) { setMessage("Choose a recorded expense to match."); return; }
      payload = { ...base, transactionId: selected.id, sourceVersion: selected.version };
    } else if (editor.kind === "release") payload = { ...base, sourceVersion: editor.plan.currentSourceVersion };
    else payload = base;
    const serialized = JSON.stringify(payload);
    if (request.current?.payload !== serialized) request.current = { payload: serialized, id: crypto.randomUUID() };
    inFlight.current = true; setPending(true); setMessage("");
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, requestId: request.current.id }) });
      if (response.status === 401 || response.status === 404) { setUnavailable(true); setEditor(null); setResult(null); loseSheetAccess(sheet.id, response.status); return; }
      const reply = z.object({ message: z.string() }).safeParse(await response.json());
      if (!response.ok) { setUncertain(response.status >= 500); setMessage(response.status >= 500 ? "The save outcome is unknown. Retry the same action before changing this draft." : reply.success ? reply.data.message : "Could not save. Your entries are preserved."); setConflict(response.status === 409); return; }
      setUncertain(false); setEditor(null); await load(); onSaved(); router.refresh();
    } catch { setUncertain(true); setMessage("The save outcome is unknown. Your draft is locked. Retry the same action to check its result before changing it."); }
    finally { inFlight.current = false; setPending(false); }
  }
  const candidates = editor && "plan" in editor ? result?.candidates.filter(row => row.categoryId === editor.plan.categoryId && row.date >= editor.plan.createdDate && row.createdAt >= editor.plan.createdAt) ?? [] : [];
  const active = result?.plans.filter(plan => plan.status === "active" || plan.status === "fulfilled") ?? [];
  const history = result?.plans.filter(plan => plan.status === "cancelled" || plan.status === "skipped") ?? [];
  function planCard(plan: PlanRecord) {
    return <article className="payment-plan" key={plan.id}><div className="panel-heading"><div><h3>{plan.name}</h3><p className="hint">{categories.find(row => row.categoryId === plan.categoryId)?.name ?? "Archived category"} · Due {plan.dueDate} · {plan.recurrence === 0 ? "One payment" : plan.recurrence === 1 ? "Monthly" : plan.recurrence === 6 ? "Every six months" : "Annually"}</p></div><strong>{money(plan.expected)}</strong></div><p>{plan.overdue ? "Overdue. No extra contributions or transactions are created." : plan.status === "active" ? "Upcoming" : plan.status === "fulfilled" ? "Payment matched" : plan.status === "skipped" ? "Skipped" : "Cancelled"}</p>
      <details><summary>Planned contribution schedule and reconciliation</summary><p className="hint">Planning starts {plan.createdDate}. Only periods remaining at creation or edit share the amount. A late start means a higher contribution. The due-date period is included, including a date on its first day.</p>{plan.contributions.map(row => <p key={row.from}>{row.from} through {row.to}: <strong>{money(row.amount)}</strong> Planned contribution</p>)}{plan.adjustments.map((row, index) => <p key={index}>{row.date}: {money(row.amount)} reconciliation · {row.reason}</p>)}</details>
      {plan.matchedTransactionId && <p>Matched snapshot: {plan.matchedPayee} · {plan.matchedDate} · {money(plan.matchedAmount ?? 0)}. The full transaction stays in recorded spending.</p>}
      {plan.needsReview && <Notice tone="warning">Payment source needs review: {plan.currentSourceDescription}. The agreed plan charge stays until you release the match. Live expense portions are excluded at their current dates and categories. A separate refund reduces recorded spending normally.</Notice>}
      <div className="actions">{plan.status === "active" && <><Button onClick={() => open({ kind: "edit", plan })}>Edit {plan.name}</Button><Button onClick={() => open({ kind: "match", plan })}>Match payment</Button><Button onClick={() => open({ kind: "skip", plan })}>Skip payment</Button><Button variant="danger" onClick={() => open({ kind: "cancel", plan })}>Cancel plan</Button></>}{plan.status === "fulfilled" && <Button onClick={() => open({ kind: "release", plan })}>Release match</Button>}{plan.nextDueDate && <Button onClick={() => open({ kind: "next", plan })}>Plan next payment</Button>}</div>{plan.nextDueDate && <p className="hint">Next proposed date {plan.nextDueDate}.{plan.skippedOccurrences > 0 ? ` Skipped ${plan.skippedOccurrences} past proposed occurrences.` : ""} Confirming creates a new upcoming plan.</p>}
    </article>;
  }
  if (unavailable) return null;
  return <Panel className="payment-plans-panel"><div className="panel-heading"><h2>Upcoming payments</h2><Button variant="primary" disabled={!result || loading} onClick={() => open({ kind: "create" })}>Plan upcoming payment</Button></div><Help label="Upcoming payments"><p>Plan a future cost across remaining budget periods. Contributions use category budget; they do not move money. Record the payment separately, then match it to the plan.</p></Help>{loading && <LoadingState />}{error && <><Notice tone="error">{error}</Notice><Button onClick={() => void load()}>Retry</Button></>}{!loading && !error && active.length === 0 && <p>No upcoming payments planned.</p>}{!error && active.map(planCard)}{history.length > 0 && <details><summary>Cancelled and skipped plans</summary>{history.map(planCard)}</details>}
    {editor && <Dialog open title={editor.kind === "create" ? "Plan upcoming payment" : editor.kind === "edit" ? "Edit upcoming payment" : editor.kind === "next" ? "Confirm next upcoming payment" : editor.kind === "match" ? "Match recorded payment" : editor.kind === "release" ? "Release payment match?" : editor.kind === "skip" ? "Skip this payment?" : "Cancel payment plan?"} dirty pending={pending || uncertain} onClose={() => setEditor(null)}>{message && <Notice tone="error">{message}</Notice>}{conflict && <><p>Your entries are preserved. Reload the latest plan and source before trying again.</p><Button disabled={pending} onClick={() => { setEditor(null); void load(); }}>Discard draft and reload latest</Button></>}<form className="payment-plan-form" onSubmit={event => { event.preventDefault(); void save(); }}>
      {(editor.kind === "create" || editor.kind === "edit" || editor.kind === "next") ? <><Field id="payment-plan-name" label="Payment name (required)" required maxLength={120} value={name} disabled={pending || uncertain} onChange={event => setName(event.target.value)} /><Field id="payment-plan-amount" label={`Expected amount (${sheet.currency}, required)`} required inputMode="decimal" value={amount} disabled={pending || uncertain} onChange={event => setAmount(event.target.value)} /><Field id="payment-plan-date" label="Next payment date (required)" type="date" required min={today()} max="9999-12-31" value={dueDate} disabled={pending || uncertain} onChange={event => setDueDate(event.target.value)} /><Selector id="payment-plan-category" label="Spending category (required)" required value={categoryId} disabled={pending || uncertain} onChange={event => setCategoryId(event.target.value)}>{categories.filter(row => !row.archived).map(row => <option value={row.categoryId} key={row.categoryId}>{row.name}</option>)}</Selector><Selector id="payment-plan-recurrence" label="Recurrence" value={repeat} disabled={pending || uncertain} onChange={event => setRepeat(recurrence.parse(Number(event.target.value)))}><option value={0}>One payment</option><option value={1}>Monthly</option><option value={6}>Every six months</option><option value={12}>Annually</option></Selector><Help label="Contribution schedule"><p>Contributions start in {result?.currentPeriod} and include the due-date period. Completed contributions stay fixed. Recurrence proposes another plan after fulfillment.</p></Help></> : editor.kind === "match" ? <><p>Match one whole expense recorded after this plan was created, dated in the current period through today. Every split must use this plan&apos;s spending category. Mixed-category expenses and payments before plan creation are ineligible.</p><Selector id="payment-plan-source" label="Recorded expense" required value={candidate} disabled={pending || uncertain} onChange={event => setCandidate(event.target.value)}><option value="">Choose a payment</option>{candidates.map(row => <option key={row.id} value={row.id}>{row.date} · {row.payee} · {money(row.amount)}</option>)}</Selector>{candidates.length === 0 && <p>No eligible payments. Record the payment in Transactions after creating the plan.</p>}<p>Future contributions stop. This period reconciles the actual cost against retained contributions, including any underpayment or overpayment. Recorded amount and date stay unchanged.</p></> : editor.kind === "release" ? <><p>The full recorded expense will count normally again. Today&apos;s period reverses the retained plan charge; completed contribution history stays. You can explicitly match this expense to another eligible plan after release.</p><p>Original payment: {editor.plan.matchedPayee} · {editor.plan.matchedDate} · {money(editor.plan.matchedAmount ?? 0)}. Current source: {editor.plan.currentSourceDescription}.</p></> : <p>Current and future contributions stop. This period releases completed contributions with a negative reconciliation. Earlier contribution rows remain. No transaction is created.</p>}
      <div className="actions"><Button type="submit" variant={editor.kind === "cancel" || editor.kind === "release" ? "danger" : "primary"} pending={pending} disabled={conflict}>{uncertain ? "Retry same action" : editor.kind === "match" ? "Confirm match" : editor.kind === "release" ? "Release match" : editor.kind === "skip" ? "Skip payment" : editor.kind === "cancel" ? "Cancel plan" : "Save payment plan"}</Button><Button disabled={pending || uncertain} onClick={() => setEditor(null)}>Discard draft</Button></div>
    </form></Dialog>}
  </Panel>;
}





