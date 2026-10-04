"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { z } from "zod";
import type { readSheet } from "@/sheets/service";
import { sourceTypes } from "@/sheets/settings-input";
import { allocationBalance, draftInput, ledgerRecordSchema, newDraft, recordDraft, type Draft, type LedgerRecord } from "@/ledger/presentation";
import { transactionKindSchema } from "@/ledger/input";
import { Button, Field, LoadingState, Notice, Selector } from "./ui";
import { Dialog } from "./dialog";

type Sheet = ReturnType<typeof readSheet>;
type EditorProps = { sheet: Sheet; record: LedgerRecord | null; onClose: () => void; onSaved: () => void; onUnavailable: (status: number) => void; onAccount: () => Promise<Sheet["accounts"] | undefined> };
const subscribe = () => () => {};
export function TransactionEditor(props: EditorProps) {
  const browserReady = useSyncExternalStore(subscribe, () => true, () => false);
  return browserReady ? <BrowserTransactionEditor {...props} /> : <LoadingState />;
}
function BrowserTransactionEditor({ sheet, record, onClose, onSaved, onUnavailable, onAccount }: EditorProps) {
  const category = sheet.categories.find((item) => item.isProtected); const bucket = sheet.buckets.find((item) => item.isProtected);
  if (!category || !bucket) throw new Error("Missing sheet defaults");
  const defaults = { categoryId: category.id, bucketId: bucket.id };
  const [original, setOriginal] = useState(record);
  const [draft, setDraft] = useState<Draft>(() => record ? recordDraft(record, sheet.currency) : newDraft({ accountIds: sheet.accounts.filter((item) => !item.isArchived).map((item) => item.id), ...defaults }));
  const [initial, setInitial] = useState(JSON.stringify(draft));
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [conflict, setConflict] = useState(false);
  const [recordMissing, setRecordMissing] = useState(false);
  const [confirming, setConfirming] = useState<"delete" | "reload" | null>(null);
  const [accountName, setAccountName] = useState(""); const [sourceType, setSourceType] = useState("bank");
  const inFlight = useRef(false);
  const dirty = initial !== JSON.stringify(draft) || Boolean(accountName);
  const balance = allocationBalance(draft, sheet.currency);
  const activeAccounts = sheet.accounts.filter((item) => !item.isArchived);
  const noAccount = !activeAccounts.length && !original;
  useEffect(() => {
    function unload(event: BeforeUnloadEvent) { if (dirty || pending) { event.preventDefault(); event.returnValue = ""; } }
    window.addEventListener("beforeunload", unload); return () => window.removeEventListener("beforeunload", unload);
  }, [dirty, pending]);
  function change(values: Partial<Draft>) { setDraft((current) => ({ ...current, ...values })); }
  function allocation(index: number, values: Partial<Draft["splits"][number]>) { setDraft((current) => ({ ...current, splits: current.splits.map((split, position) => position === index ? { ...split, ...values } : split) })); }
  async function responseError(response: Response, operation: "transaction" | "account" = "transaction") {
    if (response.status === 401) { onUnavailable(response.status); return; }
    if (response.status === 404) {
      try {
        const access = await fetch(`/api/sheets/${sheet.id}`, { cache: "no-store" });
        if (access.status === 401 || access.status === 404) { onUnavailable(access.status); return; }
        if (!access.ok) { setMessage("Could not verify access to this sheet. Your entries are preserved. Try again."); return; }
        if (operation === "transaction") { setRecordMissing(true); setConflict(false); setMessage("This transaction was deleted or is no longer available. Your unsaved entries are preserved. Close this editor to return to transactions."); }
        else setMessage("Could not add the account. Your entries are preserved. Try again.");
      } catch { setMessage("Could not connect to verify access. Your entries are preserved. Try again."); }
      return;
    }
    const parsed = z.object({ message: z.string(), issues: z.array(z.object({ path: z.array(z.union([z.string(), z.number()])), message: z.string() })).optional() }).safeParse(await response.json());
    setMessage(parsed.success ? parsed.data.message : "Could not save. Your entries are preserved. Try again.");
    if (parsed.success && parsed.data.issues) setFieldErrors(Object.fromEntries(parsed.data.issues.map((issue) => [issue.path.join("."), issue.message])));
    if (response.status === 409) setConflict(true);
  }
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (inFlight.current || conflict || recordMissing) return;
    setMessage(""); setFieldErrors({});
    if (!draft.accountId) { setFieldErrors({ accountId: "Choose an account." }); setMessage("Check the highlighted fields."); return; }
    let input: ReturnType<typeof draftInput>;
    try { input = draftInput(draft, sheet.currency, defaults); }
    catch (error) {
      if (error instanceof z.ZodError) { setFieldErrors(Object.fromEntries(error.issues.map((issue) => [issue.path.join("."), issue.message]))); setMessage("Check the highlighted fields."); }
      else setMessage(error instanceof Error ? error.message : "Check the transaction fields."); return;
    }
    inFlight.current = true; setPending(true);
    try {
      const response = await fetch(`/api/sheets/${sheet.id}/transactions${original ? `/${original.id}` : ""}`, { method: original ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...input, ...(original ? { version: original.version } : {}) }) });
      if (!response.ok) { await responseError(response); return; }
      if (!ledgerRecordSchema.safeParse(await response.json()).success) { setMessage("Could not verify the saved transaction. Reload transactions before retrying."); return; }
      onSaved();
    } catch { setMessage("Could not connect. Your entries are preserved. Try again."); }
    finally { inFlight.current = false; setPending(false); }
  }
  async function confirmAction() {
    if (!original || inFlight.current) return;
    inFlight.current = true; setPending(true); setMessage("");
    try {
      const response = await fetch(`/api/sheets/${sheet.id}/transactions/${original.id}`, confirming === "delete" ? { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version: original.version }) } : { cache: "no-store" });
      if (!response.ok) { setConfirming(null); await responseError(response); return; }
      if (confirming === "delete") { onSaved(); return; }
      const latest = ledgerRecordSchema.parse(await response.json()); const next = recordDraft(latest, sheet.currency);
      setOriginal(latest); setDraft(next); setInitial(JSON.stringify(next)); setConflict(false); setFieldErrors({}); setConfirming(null);
    } catch { setMessage("Could not connect. Your entries are preserved. Try again."); setConfirming(null); }
    finally { inFlight.current = false; setPending(false); }
  }
  async function addAccount(event: React.FormEvent) {
    event.preventDefault(); if (inFlight.current) return;
    inFlight.current = true; setPending(true); setMessage("");
    try {
      const response = await fetch(`/api/sheets/${sheet.id}/settings`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "create", entity: "account", name: accountName, sourceType }) });
      if (!response.ok) { await responseError(response, "account"); return; }
      const accounts = await onAccount();
      const active = accounts?.filter((item) => !item.isArchived) ?? [];
      const account = active.length === 1 ? active[0] : undefined;
      if (account) { const next = { ...draft, accountId: account.id }; setDraft(next); setInitial(JSON.stringify(next)); }
      setAccountName("");
    } catch { setMessage("Could not connect. Your account name is preserved. Try again."); }
    finally { inFlight.current = false; setPending(false); }
  }
  const excluded = draft.kind === "income" || draft.kind === "transfer";
  function options(items: { id: string; name: string; isArchived: boolean }[], selected: string) { return items.filter((item) => !item.isArchived || item.id === selected).map((item) => <option key={item.id} value={item.id}>{item.name}{item.isArchived ? " (archived)" : ""}</option>); }
  return <Dialog title={original ? "Edit transaction" : "Add transaction"} open onClose={onClose} drawer dirty={dirty} pending={pending}>
    {message && <Notice tone="error">{message}</Notice>}
    {conflict && <div className="conflict-actions"><Notice tone="warning">Someone updated this transaction. Your unsaved entries are preserved.</Notice><Button disabled={pending} onClick={() => setConfirming("reload")}>Reload latest</Button></div>}
    {confirming ? <><h3>{confirming === "delete" ? "Delete this transaction?" : "Discard local changes and reload?"}</h3><p>{confirming === "delete" ? "Spending totals will change. Future imports will still recognize this transaction's source." : "Reloading replaces your unsaved entries with the latest saved transaction."}</p><div className="actions"><Button disabled={pending} onClick={() => setConfirming(null)}>Keep editing</Button><Button variant={confirming === "delete" ? "danger" : "primary"} pending={pending} onClick={() => void confirmAction()}>{confirming === "delete" ? "Delete transaction" : "Discard and reload"}</Button></div></> : noAccount ? <form onSubmit={addAccount} aria-busy={pending}><h3>Add a financial account</h3><p>Create an account to continue entering this transaction.</p><Field id="entry-account-name" label="Account name" value={accountName} onChange={(event) => setAccountName(event.target.value)} maxLength={80} required disabled={pending} autoFocus /><Selector id="entry-account-source" label="Source type" value={sourceType} disabled={pending} onChange={(event) => setSourceType(event.target.value)}>{Object.entries(sourceTypes).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</Selector><Button variant="primary" type="submit" pending={pending}>Add account and continue</Button></form> : <form onSubmit={save} noValidate aria-busy={pending}>
      <fieldset disabled={pending} className="editor-fields"><Selector label="Kind" id="entry-kind" value={draft.kind} onChange={(event) => change({ kind: transactionKindSchema.parse(event.target.value) })}>{["expense", "refund", "income", "transfer"].map((kind) => <option key={kind} value={kind}>{kind[0]?.toUpperCase()}{kind.slice(1)}</option>)}</Selector>
      <Field label="Date" id="entry-date" type="date" value={draft.date} onChange={(event) => change({ date: event.target.value })} error={fieldErrors.date} required />
      <Selector label="Account" id="entry-account" error={fieldErrors.accountId} value={draft.accountId} onChange={(event) => change({ accountId: event.target.value })}><option value="">Choose account</option>{options(sheet.accounts, draft.accountId)}</Selector>
      <Field autoFocus label="Payee" id="entry-payee" value={draft.payee} onChange={(event) => change({ payee: event.target.value })} error={fieldErrors.payee} maxLength={200} required />
      <Field label={`Amount (${sheet.currency})`} id="entry-amount" value={draft.amount} onChange={(event) => change({ amount: event.target.value })} error={fieldErrors.amount} inputMode="decimal" hint="Enter a positive amount. The kind determines its sign." required />
      {draft.kind === "transfer" && <Selector label="Transfer direction" id="entry-direction" value={draft.direction} onChange={(event) => change({ direction: event.target.value === "in" ? "in" : "out" })}><option value="out">Money out</option><option value="in">Money in</option></Selector>}
      {excluded ? <Notice>Income and transfers do not affect spending budgets. This transaction uses Uncategorized and Unassigned.</Notice> : <><h3>{draft.splitMode ? "Split transaction" : "Allocation"}</h3>{(draft.splitMode ? draft.splits : draft.splits.slice(0, 1)).map((split, index) => <section className="allocation-row" key={split.key} aria-label={`Allocation ${index + 1}`}>
        {draft.splitMode && <Field label={`Split ${index + 1} amount (${sheet.currency})`} id={`split-${split.key}-amount`} inputMode="decimal" value={split.amount} onChange={(event) => allocation(index, { amount: event.target.value })} error={fieldErrors[`splits.${index}.amount`]} />}
        <Selector label="Category" id={`split-${split.key}-category`} error={fieldErrors[`splits.${index}.categoryId`]} value={split.categoryId} onChange={(event) => allocation(index, { categoryId: event.target.value })}>{options(sheet.categories, split.categoryId)}</Selector>
        <Selector label="Attribution" id={`split-${split.key}-bucket`} error={fieldErrors[`splits.${index}.bucketId`]} value={split.bucketId} onChange={(event) => allocation(index, { bucketId: event.target.value })}>{options(sheet.buckets, split.bucketId)}</Selector>
        {draft.splitMode && <Button disabled={draft.splits.length === 1} onClick={() => change({ splits: draft.splits.filter((item) => item.key !== split.key) })}>Remove split {index + 1}</Button>}
      </section>)}{draft.splitMode ? <Button disabled={draft.splits.length >= 100} onClick={() => change({ splits: [...draft.splits, { key: crypto.randomUUID(), ...defaults, amount: "" }] })}>Add split</Button> : <Button onClick={() => change({ splitMode: true, splits: draft.splits.slice(0, 1).map((split) => ({ ...split, amount: draft.amount })) })}>Split transaction</Button>}</>}
      </fieldset><footer className="editor-footer"><p className="hint" role="status">{balance.message}</p>{!balance.valid && <p className="hint">Save becomes available when the entered allocations match the transaction amount.</p>}<div className="actions"><Button type="submit" variant="primary" pending={pending} disabled={!balance.valid || conflict || recordMissing}>Save transaction</Button>{original && <Button variant="danger" disabled={pending || conflict || recordMissing} onClick={() => setConfirming("delete")}>Delete</Button>}</div></footer>
    </form>}
  </Dialog>;
}
