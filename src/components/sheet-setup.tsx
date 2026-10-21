"use client";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { availableGuideStep, guideCompletionSchema, guideEvent, guideKey, parseGuideState, type GuideState, type GuideStep } from "../sheets/guide";
import type { SetupFacts } from "../sheets/setup";
import type { Section } from "./shell-state";
import { IntentLink } from "./intent-link";
import { Button, Panel, Selector } from "./ui";
import { Dialog } from "./dialog";
import { TransactionAccountForm } from "./transaction-account-form";
import { loseSheetAccess } from "./sheet-access";
import { requestAppNavigation } from "./navigation-guard";

const changeEvent = "homebooks-guide-changed";
const memory = new Map<string, string>();
function subscribe(listener: () => void) {
  window.addEventListener(changeEvent, listener); window.addEventListener("storage", listener);
  return () => { window.removeEventListener(changeEvent, listener); window.removeEventListener("storage", listener); };
}
function read(key: string) { try { return localStorage.getItem(key) ?? memory.get(key) ?? null; } catch { return memory.get(key) ?? null; } }
function write(key: string, state: GuideState) {
  const raw = JSON.stringify(state); memory.set(key, raw);
  try { localStorage.setItem(key, raw); } catch { /* The guide remains usable when browser storage is unavailable. */ }
  window.dispatchEvent(new Event(changeEvent));
}
type Account = { id: string; name: string; isArchived: boolean };
type GuideSheet = { id: string; role: string; setup: SetupFacts; accounts: Account[] };
const pageAdvice: Record<Section, { text: string; href: string; action: string }> = {
  overview: { text: "Review spending, then check transactions that need a category.", href: "/transactions", action: "View expenses" },
  transactions: { text: "Enter purchases or refunds and assign amounts to expense people. Details also supports income and transfers.", href: "/import", action: "Import CSV" },
  owed: { text: "Track repayment for selected people, or add an amount owed separately.", href: "/settings#spending-groups", action: "Manage expense people" },
  budgets: { text: "Set a monthly category limit. Defaults repeat; monthly changes apply once.", href: "/settings#default-budgets", action: "Set default budgets" },
  import: { text: "Choose a CSV, match its columns, and review before importing. Saving a format is optional.", href: "/transactions?add=1", action: "Add a transaction instead" },
  settings: { text: "Manage accounts, expense people and Sharing here. Budgets, payment plans and categories are optional tools.", href: "/transactions?add=1", action: "Add transaction" },
};

export function SheetGuidance({ sheet, userId, section }: { sheet: GuideSheet; userId: string; section: Section }) {
  const router = useRouter();
  const key = guideKey(userId, sheet.id);
  const raw = useSyncExternalStore(subscribe, () => read(key), () => null);
  const hydrated = useSyncExternalStore(subscribe, () => true, () => false);
  const state = useMemo(() => parseGuideState(raw), [raw]);
  const [modal, setModal] = useState<"help" | "guide" | null>(null);
  const [dirty, setDirty] = useState(false), [pending, setPending] = useState(false);
  const [accounts, setAccounts] = useState(sheet.accounts);
  const [serverAccounts, setServerAccounts] = useState(sheet.accounts);
  if (serverAccounts !== sheet.accounts) { setServerAccounts(sheet.accounts); setAccounts(sheet.accounts); }
  const activeAccounts = accounts.filter(account => !account.isArchived);
  const remembered = state.kind === "active" || state.kind === "skipped" ? state.step : { kind: "account" } satisfies GuideStep;
  const step = availableGuideStep(remembered, accounts);
  const [accountId, setAccountId] = useState("");
  const chosenId = activeAccounts.some(account => account.id === accountId) ? accountId : activeAccounts[0]?.id ?? "";
  const completed = Boolean(sheet.setup.completed);
  const result = state.kind === "result" ? state.result : null;
  const showResult = Boolean(result) || (completed && state.kind === "active");
  const advice = pageAdvice[section];
  const trigger = useRef<HTMLButtonElement>(null);
  const guideTrigger = useRef<HTMLElement | null>(null);
  useEffect(() => {
    function saved(event: Event) {
      if (!(event instanceof CustomEvent)) return;
      const parsed = guideCompletionSchema.safeParse(event.detail);
      if (parsed.success && parsed.data.sheetId === sheet.id && state.kind === "active") { write(key, { kind: "result", result: parsed.data.result }); router.refresh(); }
    }
    window.addEventListener(guideEvent, saved); return () => window.removeEventListener(guideEvent, saved);
  }, [key, sheet.id, state.kind, router]);
  useEffect(() => {
    function unload(event: BeforeUnloadEvent) { if (dirty || pending) { event.preventDefault(); event.returnValue = ""; } }
    window.addEventListener("beforeunload", unload); return () => window.removeEventListener("beforeunload", unload);
  }, [dirty, pending]);
  function start() { guideTrigger.current = modal === "help" ? trigger.current : document.activeElement instanceof HTMLElement ? document.activeElement : trigger.current; write(key, { kind: "active", step }); setModal("guide"); }
  function choosePath(path: "manual" | "csv", selected: string) {
    write(key, { kind: "active", step: { kind: "entry", accountId: selected, path } }); setModal(null);
    const href = path === "manual" ? `/transactions?add=1&accountId=${encodeURIComponent(selected)}` : `/import?accountId=${encodeURIComponent(selected)}`;
    requestAppNavigation({ href, navigate: target => {
      if (path === "manual" && section === "transactions") window.dispatchEvent(new CustomEvent("homebooks-add-transaction", { detail: { accountId: selected } }));
      else if (path === "csv" && section === "import") window.dispatchEvent(new CustomEvent("homebooks-setup-import", { detail: { accountId: selected, href: target } }));
      else router.push(target);
    } });
  }
  async function accountAdded(name: string) {
    const response = await fetch(`/api/sheets/${sheet.id}`, { cache: "no-store" });
    if (response.status === 401 || response.status === 404) { loseSheetAccess(sheet.id, response.status); return; }
    const parsed = z.object({ accounts: z.array(z.object({ id: z.string(), name: z.string(), isArchived: z.boolean() })) }).safeParse(await response.json());
    if (!response.ok || !parsed.success) throw new Error("Could not load accounts.");
    const account = parsed.data.accounts.find(account => !account.isArchived && account.name === name);
    if (!account) throw new Error("Account unavailable.");
    setAccounts(parsed.data.accounts); setAccountId(account.id); setDirty(false);
    write(key, { kind: "active", step: { kind: "choice", accountId: account.id } }); router.refresh();
  }
  function finish() { write(key, { kind: "finished" }); setModal(null); }
  return <>
    <div className="page-help"><Button ref={trigger} onClick={() => setModal("help")}>Help</Button></div>
    {hydrated && (showResult ? <Panel className="setup-reminder"><div><strong>{result?.kind === "manual" ? "Transaction saved" : result?.kind === "csv" ? `${result.added} ${result.added === 1 ? "transaction" : "transactions"} imported` : "This sheet has its first transaction"}</strong>{result?.kind === "manual" && <p>{result.description}</p>}</div><div className="actions"><IntentLink className="button primary" href={result?.kind === "csv" ? `/transactions?batchId=${encodeURIComponent(result.batchId)}&from=&to=&view=all` : "/transactions"} onNavigate={finish}>View expenses</IntentLink><Button onClick={finish}>Done</Button></div></Panel>
      : !completed && state.kind !== "skipped" && state.kind !== "finished" && <Panel className="setup-reminder"><div><strong>{state.kind === "active" ? step.kind === "account" ? "Step 1 of 2 · Choose an account" : "Step 2 of 2 · Add your first transaction" : "Start your sheet"}</strong></div><div className="actions"><Button variant="primary" onClick={start}>{state.kind === "new" ? "Start setup" : "Resume setup"}</Button><Button onClick={() => write(key, { kind: "skipped", step })}>Skip setup</Button></div></Panel>)}
    {modal === "help" && <Dialog open title="Page help" onClose={() => setModal(null)} returnFocus={trigger}><p>{advice.text}</p><IntentLink className="button primary" href={advice.href} onNavigate={() => setModal(null)}>{advice.action}</IntentLink>{!completed && <div className="actions"><Button onClick={start}>{state.kind === "new" ? "Start setup" : "Resume setup"}</Button></div>}<OptionalSetupSettings role={sheet.role} onNavigate={() => setModal(null)} /></Dialog>}
    {modal === "guide" && <Dialog open title={showResult ? "First entry complete" : step.kind === "account" ? "Step 1 of 2 · Choose an account" : "Step 2 of 2 · Add your first transaction"} onClose={() => { setModal(null); setDirty(false); }} dirty={dirty} pending={pending} returnFocus={guideTrigger}>
      {showResult ? <><p>This sheet is ready. Review the recorded transactions next.</p><IntentLink className="button primary" href="/transactions" onNavigate={finish}>View expenses</IntentLink><Button onClick={finish}>Done</Button></> : step.kind === "account" ? <><p>Use the account charged, such as Visa, checking, or cash.</p>{activeAccounts.length ? <><Selector id="setup-account" label="Transaction account" value={chosenId} onChange={event => setAccountId(event.target.value)}>{activeAccounts.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}</Selector><Button variant="primary" disabled={!chosenId} onClick={() => write(key, { kind: "active", step: { kind: "choice", accountId: chosenId } })}>Continue</Button></> : <TransactionAccountForm id="setup-account" sheetId={sheet.id} onAdded={accountAdded} onUnavailable={status => loseSheetAccess(sheet.id, status)} onDirty={setDirty} onPending={setPending} />}</>
        : step.kind === "choice" ? <><p>Choose how to add your first expense. Me and Uncategorized are ready; extra people, budgets and repayment tracking are optional.</p>{sheet.role === "owner" && <p className="hint">Billing cycle starts on day {sheet.setup.cycleDay}. <IntentLink href="/settings#budget-cycle" onNavigate={() => setModal(null)}>Change billing cycle (optional)</IntentLink></p>}<p className="hint"><IntentLink href="/settings#spending-groups" onNavigate={() => setModal(null)}>Add expense people (optional)</IntentLink></p><div className="setup-paths"><Button variant="primary" onClick={() => choosePath("manual", step.accountId)}>Enter one transaction</Button><Button onClick={() => choosePath("csv", step.accountId)}>Import a CSV</Button></div><Button onClick={() => write(key, { kind: "active", step: { kind: "account" } })}>Back</Button><OptionalSetupSettings role={sheet.role} onNavigate={() => setModal(null)} /></>
          : <><p>{step.path === "manual" ? "Enter the date, description, and amount, then save. Uncategorized and Me are ready to use." : "Choose a file, match its columns, then review and import. You do not need to save a reusable format."}</p><Button variant="primary" onClick={() => choosePath(step.path, step.accountId)}>{step.path === "manual" ? "Continue to transaction" : "Continue to import"}</Button><Button onClick={() => write(key, { kind: "active", step: { kind: "choice", accountId: step.accountId } })}>Back</Button></>}
    </Dialog>}
  </>;
}

export function OptionalSetupSettings({ role, onNavigate }: { role: string; onNavigate?: () => void }) {
  return <details className="setup-customize"><summary>Optional settings</summary><div className="actions"><IntentLink onNavigate={onNavigate} href="/settings#spending-categories">Categories (optional)</IntentLink><IntentLink onNavigate={onNavigate} href="/settings#spending-groups">Expense people</IntentLink><IntentLink onNavigate={onNavigate} href="/budgets">Budgets</IntentLink>{role === "owner" && <IntentLink onNavigate={onNavigate} href="/settings#budget-cycle">Billing cycle</IntentLink>}</div></details>;
}
