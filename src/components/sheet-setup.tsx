"use client";
import { useSyncExternalStore } from "react";
import { setupProgress, type SetupFacts } from "../sheets/setup";
import { IntentLink } from "./intent-link";
import { Badge, Button, Panel } from "./ui";

function subscribe(listener: () => void) {
  window.addEventListener("homebooks-setup-dismissed", listener);
  return () => window.removeEventListener("homebooks-setup-dismissed", listener);
}
const dismissedInMemory = new Set<string>();
function isDismissed(key: string) {
  try { return dismissedInMemory.has(key) || sessionStorage.getItem(key) === "dismissed"; } catch { return dismissedInMemory.has(key); }
}
export function SetupReminder({ facts, sheetId, sessionKey }: { facts: SetupFacts; sheetId: string; sessionKey: string }) {
  const key = `homebooks-setup:${sessionKey}:${sheetId}`;
  const dismissed = useSyncExternalStore(subscribe, () => isDismissed(key), () => true);
  const progress = setupProgress(facts);
  if (dismissed || !progress.hasOpportunities) return null;
  return <Panel className="setup-reminder"><div><strong>{progress.ready ? "Ready for transactions" : "Add a transaction account to get started"}</strong><p className="hint">{progress.ready ? "Optional sheet choices are available when you need them." : "One active account is required. Other setup choices are optional."}</p></div><div className="actions"><IntentLink className="button" href="/settings#sheet-setup">View sheet setup</IntentLink><IntentLink className="button" href="/import">Import CSV</IntentLink><IntentLink className="button primary" href="/transactions?add=1">Add transaction</IntentLink><Button onClick={() => { dismissedInMemory.add(key); try { sessionStorage.setItem(key, "dismissed"); } catch { /* Memory retains dismissal when browser storage is unavailable. */ } window.dispatchEvent(new Event("homebooks-setup-dismissed")); }}>Dismiss for this session</Button></div></Panel>;
}

export function SheetSetup({ facts, role }: { facts: SetupFacts; role: "owner" | "member" }) {
  const progress = setupProgress(facts);
  const tasks = [
    { title: "Transaction accounts", required: true, configured: progress.ready, status: progress.ready ? `${facts.accounts} active` : "Needs attention", href: "/settings#transaction-accounts", why: "Group transactions by source. Add or restore an account before saving transactions." },
    { title: "Spending categories", required: false, configured: facts.categories > 0, status: facts.categories > 0 ? `${facts.categories} custom active` : "Optional opportunity", href: "/settings#spending-categories", why: "Describe what you spent on and compare category spending. Uncategorized is a valid protected fallback." },
    { title: "Spending groups", required: false, configured: facts.groups > 0, status: facts.groups > 0 ? `${facts.groups} custom active` : "Optional opportunity", href: "/settings#spending-groups", why: "Track whose expense it is. Unassigned is a valid protected fallback; groups do not grant sheet access." },
    { title: "Default budgets", required: false, configured: facts.budgets > 0, status: facts.budgets > 0 ? `${facts.budgets} recurring limits` : "Optional opportunity", href: "/settings#default-budgets", why: "Compare spending with recurring category limits. Zero is a limit. No limit is also a valid choice; changes begin in the current period." },
    { title: "Budget cycle", required: false, configured: true, status: `Configured: day ${facts.cycleDay}`, href: "/settings#budget-cycle", why: `A monthly cycle already applies to the sheet. Keep it or change future dates. ${role === "owner" ? "You can edit the schedule." : "Only the owner can edit the schedule."}` },
    { title: "CSV import formats", required: false, configured: facts.formats > 0, status: facts.formats > 0 ? `${facts.formats} reusable formats` : "Optional for CSV imports", href: "/import", why: "Upload a file and map its columns in Import CSV. Remember a reusable format for later files if useful. Manual entry needs no CSV format." },
  ];
  return <div id="sheet-setup"><Panel><h2>Sheet setup</h2><p>{progress.ready ? "Ready for transactions. Required setup is complete." : "Required setup: add or restore an active transaction account."}</p><p className="hint">{progress.optionalConfigured} of 4 optional custom choices configured. The budget cycle is already configured. Custom categories, groups, limits, cycles, and CSV formats are optional; protected defaults remain valid.</p><div className="actions"><IntentLink className="button primary" href="/transactions?add=1">Add transaction</IntentLink><IntentLink className="button" href="/import">Import CSV</IntentLink></div><ul className="setup-tasks">{tasks.map((task) => <li key={task.title} className={!task.configured ? "setup-opportunity" : undefined}><div className="setting-identity"><IntentLink href={task.href}>{task.title}</IntentLink><Badge tone={task.required && !task.configured ? "warning" : "neutral"}>{task.required ? "Required" : "Optional"}</Badge><span>{task.status}</span></div><p className="hint">{task.why}</p></li>)}</ul></Panel></div>;
}
