"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { z } from "zod";
import type { readSheet } from "@/sheets/service";
import { allocationBalance, draftInput, ledgerRecordSchema, newDraft, recordDraft, type Draft, type LedgerRecord } from "@/ledger/presentation";
import { Button, LoadingState, Notice, Help } from "./ui";
import { Dialog } from "./dialog";
import { ExpenseAllocationFields } from "./expense-allocation-fields";
import { TransactionFields } from "./transaction-fields";
import { TransactionAccountForm } from "./transaction-account-form";
import { notifyFirstEntry } from "../sheets/guide";

type Sheet = ReturnType<typeof readSheet>;
type EditorProps = { initialAccountId?: string; sheet: Sheet; record: LedgerRecord | null; onClose: () => void; onSaved: () => void; onUnavailable: (status: number) => void; onAccount: () => Promise<Sheet["accounts"] | undefined> };
const subscribe = () => () => {};
export function TransactionEditor(props: EditorProps) {
  const browserReady = useSyncExternalStore(subscribe, () => true, () => false);
  return browserReady ? <BrowserTransactionEditor {...props} /> : <LoadingState />;
}
function BrowserTransactionEditor({ sheet, initialAccountId, record, onClose, onSaved, onUnavailable, onAccount }: EditorProps) {
  const category = sheet.categories.find((item) => item.isProtected); const bucket = sheet.buckets.find((item) => item.isProtected);
  if (!category || !bucket) throw new Error("Missing sheet defaults");
  const defaults = { categoryId: category.id, bucketId: bucket.id };
  const [original, setOriginal] = useState(record);
  const [draft, setDraft] = useState<Draft>(() => record ? recordDraft(record, sheet.currency) : newDraft({ accountIds: initialAccountId && sheet.accounts.some(item => item.id === initialAccountId && !item.isArchived) ? [initialAccountId] : sheet.accounts.filter((item) => !item.isArchived).map((item) => item.id), ...defaults }));
  const [initial, setInitial] = useState(JSON.stringify(draft));
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [conflict, setConflict] = useState(false);
  const [recordMissing, setRecordMissing] = useState(false);
  const [confirming, setConfirming] = useState<"delete" | "reload" | null>(null);
  const [accountDirty, setAccountDirty] = useState(false);
  const inFlight = useRef(false);
  const dirty = initial !== JSON.stringify(draft) || accountDirty;
  const balance = allocationBalance(draft, sheet.currency);
  const activeAccounts = sheet.accounts.filter((item) => !item.isArchived);
  const noAccount = !activeAccounts.length && !original;
  useEffect(() => {
    function unload(event: BeforeUnloadEvent) { if (dirty || pending) { event.preventDefault(); event.returnValue = ""; } }
    window.addEventListener("beforeunload", unload); return () => window.removeEventListener("beforeunload", unload);
  }, [dirty, pending]);
  function change(values: Partial<Draft>) { setDraft((current) => ({ ...current, ...values })); }
  async function responseError(response: Response, operation: "transaction" | "account" = "transaction") {
    if (response.status === 401) { onUnavailable(response.status); return; }
    if (response.status === 404) {
      try {
        const access = await fetch(`/api/sheets/${sheet.id}`, { cache: "no-store" });
        if (access.status === 401 || access.status === 404) { onUnavailable(access.status); return; }
        if (!access.ok) { setMessage("Could not verify access to this sheet. Your entries are preserved. Try again."); return; }
        if (operation === "transaction") { setRecordMissing(true); setConflict(false); setMessage("This transaction was deleted or is no longer available. Your unsaved entries are preserved. Close this editor to return to transactions."); }
        else setMessage("Could not add the transaction account. Your entries are preserved. Try again.");
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
    if (!draft.accountId) { setFieldErrors({ accountId: "Choose a transaction account." }); setMessage("Check the highlighted fields."); return; }
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
      if (!original) notifyFirstEntry(sheet.id, { kind: "manual", description: draft.payee });
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
  async function accountAdded(name: string) {
    const accounts = await onAccount();
    const account = accounts?.find(item => !item.isArchived && item.name === name);
    if (!account) throw new Error("Could not load the new account.");
    const next = { ...draft, accountId: account.id }; setDraft(next); setInitial(JSON.stringify(next)); setAccountDirty(false);
  }
  return <Dialog title={original ? "Edit transaction" : initialAccountId && !sheet.setup.completed ? "Step 2 of 2 · Add your first transaction" : "Add transaction"} open onClose={onClose} drawer dirty={dirty} pending={pending}>
    {message && <Notice tone="error">{message}</Notice>}
    {conflict && <div className="conflict-actions"><Notice tone="warning">Someone updated this transaction. Your unsaved entries are preserved.</Notice><Button disabled={pending} onClick={() => setConfirming("reload")}>Reload latest</Button></div>}
    {confirming ? <><h3>{confirming === "delete" ? "Delete this transaction?" : "Discard local changes and reload?"}</h3><p>{confirming === "delete" ? "Spending totals will change. Future imports will still recognize this transaction's source." : "Reloading replaces your unsaved entries with the latest saved transaction."}</p><div className="actions"><Button disabled={pending} onClick={() => setConfirming(null)}>Keep editing</Button><Button variant={confirming === "delete" ? "danger" : "primary"} pending={pending} onClick={() => void confirmAction()}>{confirming === "delete" ? "Delete transaction" : "Discard and reload"}</Button></div></> : noAccount ? <><h3>Add a transaction account</h3><TransactionAccountForm id="entry-account" sheetId={sheet.id} onAdded={accountAdded} onUnavailable={onUnavailable} onDirty={setAccountDirty} onPending={setPending} /></> : <form onSubmit={save} noValidate aria-busy={pending}>
      <fieldset disabled={pending} className="editor-fields"><TransactionFields id="entry" draft={draft} currency={sheet.currency} account={{ kind: "editable", accounts: sheet.accounts }} errors={fieldErrors} autoFocus onChange={change} />
      <ExpenseAllocationFields id="entry-allocation" draft={draft} currency={sheet.currency} defaults={defaults} categories={sheet.categories} buckets={sheet.buckets} errors={fieldErrors} onChange={change} />
      </fieldset>{original && <details className="transaction-source"><summary>Source details</summary><span className="help-label"><a href={`/debt-source/${sheet.id}/${original.id}`} target="_blank" rel="noreferrer">Inspect source and repayment links</a><Help label="Linked amounts owed"><p>Manage debts and repayments in Amount owed. Editing a linked expense flags its debt for review and preserves the agreed amount until reviewed.</p></Help></span></details>}<footer className="editor-footer">{!draft.splitMode && <p className="hint" role="status">{balance.message}</p>}{!balance.valid && <p className="hint">Parts must match the transaction amount.</p>}<div className="actions"><Button type="submit" variant="primary" pending={pending} disabled={!balance.valid || conflict || recordMissing}>Save transaction</Button>{original && <Button variant="danger" disabled={pending || conflict || recordMissing} onClick={() => setConfirming("delete")}>Delete</Button>}</div></footer>
    </form>}
  </Dialog>;
}
