"use client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { readSheet } from "@/sheets/service";
import { displayAmount, localDate } from "@/ledger/presentation";
import { owedPageSchema, repaymentInput, type RepaymentRecord } from "@/repayments/input";
import { z } from "zod";
import { Button, EmptyState, Field, LoadingState, Notice, Panel, ResponsiveRecords, Selector } from "./ui";
import { Dialog } from "./dialog";
import { loseSheetAccess } from "./sheet-access";

type Result = z.infer<typeof owedPageSchema>;
type Modal = { kind: "tracking" } | { kind: "expense"; record: RepaymentRecord };
function dateLabel(value: string) { return new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`)); }
export function OwedScreen({ sheet, initialResult }: { initialResult?: Result; sheet: ReturnType<typeof readSheet> }) {
  const router = useRouter();
  const [result, setResult] = useState<Result | null>(initialResult ?? null);
  const [bucket, setBucket] = useState("tracked"); const [status, setStatus] = useState("all"); const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(!initialResult); const [error, setError] = useState(""); const [success, setSuccess] = useState("");
  const [modal, setModal] = useState<Modal | null>(null); const [unavailable, setUnavailable] = useState(false);
  const sequence = useRef(0);
  const lost = useCallback((code: number) => { setUnavailable(true); setResult(null); setModal(null); loseSheetAccess(sheet.id, code); }, [sheet.id]);
  const load = useCallback(async () => {
    const request = ++sequence.current; setLoading(true); setError("");
    try {
      const response = await fetch(`/api/sheets/${sheet.id}/owed?${new URLSearchParams({ bucket, status, page: String(page) })}`, { cache: "no-store" });
      if (request !== sequence.current) return;
      if (response.status === 401 || response.status === 404) { lost(response.status); return; }
      if (!response.ok) { setError(await message(response)); return; }
      const next = owedPageSchema.parse(await response.json());
      if (request !== sequence.current) return;
      if (page > 1 && !next.transactions.length) { setPage(Math.max(1, Math.ceil(next.total / 50))); return; }
      setResult(next);
    } catch { if (request === sequence.current) setError("Could not load repayments. Check your connection and retry."); }
    finally { if (request === sequence.current) setLoading(false); }
  }, [sheet.id, bucket, status, page, lost]);
  const seededLoad = useRef(initialResult ? load : null);
  const serverSeed = useRef(initialResult);
  useEffect(() => {
    const refreshed = serverSeed.current !== initialResult;
    serverSeed.current = initialResult;
    const defaultQuery = bucket === "tracked" && status === "all" && page === 1;
    const kickoff = setTimeout(() => {
      if (initialResult && defaultQuery && (refreshed || seededLoad.current === load)) {
        setResult(initialResult); setLoading(false); setError("");
      } else {
        if (!refreshed) setResult(null);
        void load();
      }
    }, 0);
    const counter = sequence;
    return () => { clearTimeout(kickoff); counter.current++; };
  }, [load, initialResult, bucket, status, page]);
  if (unavailable) return null;
  const tracked = result?.buckets.filter(({ trackRepayment }) => trackRepayment) ?? [];
  const groups = result?.buckets.filter((label) => result.transactions.some((record) => record.allocations.some(({ bucketId }) => bucketId === label.id))) ?? [];
  function saved() { setModal(null); setSuccess("Repayment tracking saved."); void load(); router.refresh(); }
  return <div className="owed-screen">{loading && result && <p className="refresh-indicator" role="status">Updating repayments…</p>}
    <p>Only selected spending groups count toward tracked amounts. History covers all months. Marking paid back settles the entire expense, including every split.</p>
    {success && <Notice>{success}</Notice>}
    <div className="ledger-toolbar owed-filters"><Selector id="owed-bucket" label="Spending group" value={bucket} disabled={loading} onChange={(event) => { setResult(null); setLoading(true); setBucket(event.target.value); setPage(1); }}><option value="tracked">Tracked spending groups</option><option value="all">All expenses</option>{tracked.map((label) => <option key={label.id} value={label.id}>{label.name}{label.isArchived ? " (archived)" : ""}</option>)}</Selector><Selector id="owed-status" label="Status" value={status} disabled={loading} onChange={(event) => { setResult(null); setLoading(true); setStatus(event.target.value); setPage(1); }}><option value="all">All</option><option value="outstanding">Outstanding</option><option value="paid">Paid back</option></Selector><Button disabled={loading || !result} onClick={() => setModal({ kind: "tracking" })}>Manage tracked spending groups</Button></div>
    {loading && !result ? <LoadingState /> : error ? <Panel><Notice tone="error">{error}</Notice><Button onClick={() => void load()}>Retry</Button></Panel> : result && <>
      <div className="summary-grid"><Panel><p className="summary-label">Tracked outstanding</p><p className="summary-value">{displayAmount(result.outstanding, sheet.currency)}</p><p>All tracked spending groups, all months</p></Panel><Panel><p className="summary-label">Tracked paid back</p><p className="summary-value">{displayAmount(result.paid, sheet.currency)}</p><p>All tracked spending groups, all months</p></Panel></div>
      {!tracked.length && <EmptyState title="No tracked spending groups" action={<Button onClick={() => setModal({ kind: "tracking" })}>Choose tracked spending groups</Button>}>Choose whose expenses to track. No spending group counts as owed automatically. Use All expenses to add comments to any expense.</EmptyState>}
      {groups.map((label) => {
        const records = result.transactions.flatMap((record) => { const allocation = record.allocations.find(({ bucketId }) => bucketId === label.id); return allocation ? [{ record, allocation }] : []; });
        const action = (record: RepaymentRecord) => <Button onClick={() => setModal({ kind: "expense", record })} aria-label={`Edit repayment for ${record.payee}`}>Edit repayment</Button>;
        const state = (record: RepaymentRecord) => record.repaymentDate ? `Paid back ${dateLabel(record.repaymentDate)}` : "Outstanding";
        return <Panel key={label.id}><h2>{label.name}{label.isArchived ? " (archived)" : ""}{!label.trackRepayment ? " · Not tracked" : ""}</h2><p>All-time outstanding {displayAmount(label.outstanding, sheet.currency)} · Paid back {displayAmount(label.paid, sheet.currency)}</p><ResponsiveRecords headers={["Expense date", "Payee", "Allocation", "Status", "Actions"]} rows={records.map(({ record, allocation }) => [dateLabel(record.date), <div key="payee"><strong>{record.payee}</strong>{record.repaymentComment && <p className="owed-comment">{record.repaymentComment}</p>}</div>, <span className="amount" key="amount">{displayAmount(allocation.amount, sheet.currency)}</span>, state(record), action(record)])} cards={records.map(({ record, allocation }) => <div key={record.id}><div className="transaction-card-heading"><strong>{record.payee}</strong><span className="amount">{displayAmount(allocation.amount, sheet.currency)}</span></div><p>{dateLabel(record.date)} · {state(record)}</p>{record.repaymentComment && <p className="owed-comment">{record.repaymentComment}</p>}{action(record)}</div>)} /></Panel>;
      })}
      {!result.transactions.length && (tracked.length > 0 || bucket === "all") && <EmptyState title="No matching expenses" action={<Button onClick={() => { setBucket("tracked"); setStatus("all"); setPage(1); }}>Clear filters</Button>}>No expenses match this spending group and status. History includes every month.</EmptyState>}
      {result.total > 0 && <div className="ledger-pagination"><span>{(page - 1) * 50 + 1}–{Math.min(page * 50, result.total)} of {result.total} expenses</span><div className="actions"><Button disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</Button><Button disabled={page * 50 >= result.total} onClick={() => setPage(page + 1)}>Next</Button></div></div>}
    </>}
    {modal && result && <RepaymentDialog key={modal.kind === "expense" ? modal.record.id : "tracking"} modal={modal} buckets={result.buckets} sheet={sheet} onClose={() => setModal(null)} onSaved={saved} onLost={lost} />}
  </div>;
}
async function message(response: Response) { const parsed = z.object({ message: z.string() }).safeParse(await response.json()); return parsed.success ? parsed.data.message : "Could not save. Your entries are preserved. Try again."; }
function RepaymentDialog({ modal, buckets, sheet, onClose, onSaved, onLost }: { modal: Modal; buckets: Result["buckets"]; sheet: ReturnType<typeof readSheet>; onClose: () => void; onSaved: () => void; onLost: (status: number) => void }) {
  const [record, setRecord] = useState(modal.kind === "expense" ? modal.record : null);
  const [paid, setPaid] = useState(Boolean(record?.repaymentDate)); const [date, setDate] = useState(record?.repaymentDate ?? localDate()); const [comment, setComment] = useState(record?.repaymentComment ?? "");
  const [labels, setLabels] = useState(buckets);
  const [choices, setChoices] = useState(buckets.map((label) => ({ id: label.id, version: label.trackingVersion, tracked: label.trackRepayment })));
  const [initial, setInitial] = useState(JSON.stringify({ paid, date, comment, choices }));
  const [pending, setPending] = useState(false); const inFlight = useRef(false); const [error, setError] = useState(""); const [dateError, setDateError] = useState(""); const [conflict, setConflict] = useState(false); const [missing, setMissing] = useState(false); const [reload, setReload] = useState(false);
  const dirty = initial !== JSON.stringify({ paid, date, comment, choices });
  useEffect(() => { function unload(event: BeforeUnloadEvent) { if (dirty || pending) { event.preventDefault(); event.returnValue = ""; } } window.addEventListener("beforeunload", unload); return () => window.removeEventListener("beforeunload", unload); }, [dirty, pending]);
  async function failed(response: Response) {
    if (response.status === 401) { onLost(401); return; }
    if (response.status === 404) {
      const access = await fetch(`/api/sheets/${sheet.id}`, { cache: "no-store" });
      if (access.status === 401 || access.status === 404) { onLost(access.status); return; }
      setMissing(true); setError("This expense or spending group is no longer available. Your unsaved entries are preserved. Close and reload the page."); return;
    }
    setError(await message(response)); if (response.status === 409) setConflict(true);
  }
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (inFlight.current || conflict || missing) return;
    setError(""); setDateError("");
    const input = record ? repaymentInput.safeParse({ version: record.version, repaymentDate: paid ? date : null, comment }) : null;
    if (input && !input.success) { setError("Check the repayment date and comment. Comments allow up to 2,000 characters."); const issue = input.error.issues.find(({ path }) => path[0] === "repaymentDate"); if (issue) setDateError(issue.message); return; }
    if (record && paid && date < record.date) { setDateError("Repayment date must be on or after the expense date."); setError("Check the repayment date."); return; }
    inFlight.current = true; setPending(true);
    try {
      const response = await fetch(record ? `/api/sheets/${sheet.id}/transactions/${record.id}/repayment` : `/api/sheets/${sheet.id}/owed`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input?.success ? input.data : { buckets: choices }) });
      if (!response.ok) { await failed(response); return; }
      onSaved();
    } catch { setError("Could not connect. Your entries are preserved. Try again."); }
    finally { inFlight.current = false; setPending(false); }
  }
  async function reloadLatest() {
    if (inFlight.current) return; inFlight.current = true; setPending(true);
    try {
      const response = await fetch(`/api/sheets/${sheet.id}/owed?bucket=all`, { cache: "no-store" });
      if (!response.ok) { await failed(response); return; }
      const latest = owedPageSchema.parse(await response.json());
      const nextChoices = latest.buckets.map((label) => ({ id: label.id, version: label.trackingVersion, tracked: label.trackRepayment }));
      let nextRecord = record;
      if (record) {
        const recordResponse = await fetch(`/api/sheets/${sheet.id}/transactions/${record.id}`, { cache: "no-store" });
        if (!recordResponse.ok) { await failed(recordResponse); return; }
        const value = z.object({ id: z.uuid(), version: z.number(), kind: z.string(), date: z.string(), payee: z.string(), amount: z.number(), repaymentDate: z.string().nullable(), repaymentComment: z.string() }).parse(await recordResponse.json());
        if (value.kind !== "expense") { setMissing(true); setError("This transaction is no longer an expense. Close to return to repayment tracking."); return; }
        nextRecord = { ...record, ...value };
      }
      const nextPaid = Boolean(nextRecord?.repaymentDate); const nextDate = nextRecord?.repaymentDate ?? localDate(); const nextComment = nextRecord?.repaymentComment ?? "";
      setRecord(nextRecord); setPaid(nextPaid); setDate(nextDate); setComment(nextComment); setChoices(nextChoices); setLabels(latest.buckets); setInitial(JSON.stringify({ paid: nextPaid, date: nextDate, comment: nextComment, choices: nextChoices })); setConflict(false); setError(""); setDateError(""); setReload(false);
    } catch { setError("Could not reload latest. Your entries are preserved. Try again."); }
    finally { inFlight.current = false; setPending(false); }
  }
  return <Dialog title={record ? "Edit repayment" : "Manage tracked spending groups"} open drawer={Boolean(record)} onClose={onClose} dirty={dirty} pending={pending}>
    {error && <Notice tone="error">{error}</Notice>}
    {reload ? <><h3>Discard local changes and reload?</h3><p>Reloading replaces your unsaved entries with the latest saved values.</p><div className="actions"><Button disabled={pending} onClick={() => setReload(false)}>Keep editing</Button><Button pending={pending} onClick={() => void reloadLatest()}>Discard and reload</Button></div></> : <>
      {conflict && <><Notice tone="warning">Someone updated these values. Your unsaved entries are preserved.</Notice><Button onClick={() => setReload(true)}>Reload latest</Button></>}
      <form onSubmit={save} noValidate><fieldset className="editor-fields" disabled={pending || missing}>
        {record ? <><h3>{record.payee}</h3><p>{dateLabel(record.date)} · Full expense {displayAmount(-record.amount, sheet.currency)}</p><Selector id="repayment-status" label="Repayment status" value={paid ? "paid" : "outstanding"} onChange={(event) => setPaid(event.target.value === "paid")} hint="Paid back settles the full expense across every split. Outstanding clears its repayment date."><option value="outstanding">Outstanding</option><option value="paid">Paid back</option></Selector>{paid && <Field id="repayment-date" label="Repayment date" type="date" min={record.date} value={date} onChange={(event) => setDate(event.target.value)} error={dateError} required />}<div className="field"><label htmlFor="repayment-comment">Comment</label><textarea id="repayment-comment" rows={5} maxLength={2000} value={comment} onChange={(event) => setComment(event.target.value)} /><p className="hint">Up to 2,000 characters. Saved for this expense whether outstanding or paid.</p></div></> : <><p>Select whose expense allocations should count toward Amount owed. Removing a selection keeps saved repayment dates and comments.</p>{choices.map((choice) => { const label = labels.find(({ id }) => id === choice.id); return <label className="tracking-choice" key={choice.id}><input type="checkbox" checked={choice.tracked} onChange={(event) => setChoices((previous) => previous.map((item) => item.id === choice.id ? { ...item, tracked: event.target.checked } : item))} />{label?.name ?? "Spending group"}{label?.isArchived ? " (archived)" : ""}</label>; })}</>}
      </fieldset><div className="actions"><Button type="submit" variant="primary" pending={pending} disabled={conflict || missing}>{record ? "Save repayment" : "Save tracked spending groups"}</Button></div></form>
    </>}
  </Dialog>;
}
