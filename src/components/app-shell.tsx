"use client";
import { resolvePeriod, cycleRangeLabel, type CycleHistory } from "../sheets/cycle";
import Link from "next/link";
import { IntentLink } from "./intent-link";
import { useCallback, useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { usePathname, useSearchParams, useRouter } from "next/navigation";
import { z } from "zod";
import { Dialog } from "./dialog";
import { CreateSheetForm } from "./create-sheet-form";
import { SessionWatch, SignOut } from "./session-watch";
import { Badge, Button, EmptyState, Notice, Selector } from "./ui";
import { sections, selectedMonth, pageHref, type Section } from "./shell-state";
import { MonthPicker } from "./month-picker";
import { availableSheetsSchema, incomingSchema, responseMessage, type IncomingInvite } from "../sharing/presentation";
import { IncomingInvites } from "./incoming-invites";
import { SharingDialog } from "./sharing-dialog";
import { hasLostSheetAccess, loseSheetAccess, sheetAccessEvent } from "./sheet-access";
import { SheetUnavailable } from "./sheet-unavailable";
import { requestAppNavigation } from "./navigation-guard";

type Sheet = { id: string; name: string; currency: string; role: string; cycleStartDay?: number; cycleVersion?: number; cycleHistory?: CycleHistory };
type Modal = "navigation" | "switch" | "create" | "invites" | "share";
const names: Record<Section, string> = { overview: "Overview", transactions: "Transactions", owed: "Amount owed", budgets: "Budgets", import: "Import CSV", settings: "Settings" };
const paths: Record<Section, string> = { overview: "M3 11 12 3l9 8M5 10v11h14V10M9 21v-7h6v7", transactions: "M4 5h16M4 12h16M4 19h16", owed: "M4 5h16v14H4zM8 9h8M8 13h5", budgets: "M4 21V10h4v11M10 21V3h4v18M16 21v-8h4v8", import: "M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5", settings: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2" };
export function AppShell({ sheet, sheets, section: initialSection = "overview", month: initialMonth, routed = false, userName, currencies, children, isAdmin = false }: {
  sheet?: Sheet; sheets: Sheet[]; section?: Section; month: string; routed?: boolean; userName: string; currencies: string[]; children: ReactNode; isAdmin?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [navigating, startNavigation] = useTransition();
  const [destination, setDestination] = useState<string | null>(null);
  const [showProgress, setShowProgress] = useState(false);
  useEffect(() => {
    if (!navigating) return;
    const timer = setTimeout(() => setShowProgress(true), 180);
    return () => { clearTimeout(timer); setShowProgress(false); };
  }, [navigating]);
  function navigate(href: string) { setDestination(href); startNavigation(() => router.push(href)); }
  useEffect(() => {
    const channel = new BroadcastChannel("homebooks-selection");
    const refresh = () => router.refresh();
    channel.addEventListener("message", refresh); window.addEventListener("focus", refresh);
    return () => { channel.close(); window.removeEventListener("focus", refresh); };
  }, [router]);
  const routeSection = pathname.split("/")[1];
  const section = routed ? sections.find((item) => item === routeSection) ?? "overview" : initialSection;
  const month = sheet ? resolvePeriod(routed ? selectedMonth(searchParams.get("month") ?? undefined, initialMonth) : initialMonth, sheet).from : initialMonth;
  const [modal, setModal] = useState<Modal | null>(null);
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState(false);
  const [switchPending, setSwitchPending] = useState(false);
  const [switchError, setSwitchError] = useState("");
  const [unavailable, setUnavailable] = useState(() => Boolean(sheet && hasLostSheetAccess(sheet.id)));
  const [available, setAvailable] = useState(sheets);
  const [serverSheets, setServerSheets] = useState(sheets);
  if (serverSheets !== sheets) {
    setServerSheets(sheets);
    setAvailable(sheets);
  }
  const [invites, setInvites] = useState<IncomingInvite[] | null>(null);
  const [inviteLoading, setInviteLoading] = useState(true);
  const [inviteError, setInviteError] = useState("");
  const inviteSequence = useRef(0);
  const switching = useRef(false);
  const modalTrigger = useRef<HTMLElement | null>(null);
  function openModal(next: Modal) {
    if (pending) return;
    if (!modal) modalTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setModal(next);
  }
  const loadInvites = useCallback(async () => {
    const sequence = ++inviteSequence.current; setInviteLoading(true); setInviteError("");
    try {
      const response = await fetch("/api/invites", { cache: "no-store" });
      if (sequence !== inviteSequence.current) return;
      if (response.status === 401) { setUnavailable(true); router.replace("/sign-in?expired=1"); router.refresh(); return; }
      if (!response.ok) { setInviteError(await responseMessage(response, "Could not load invitations. Try again.")); return; }
      setInvites(incomingSchema.parse(await response.json()).invites);
    } catch { if (sequence === inviteSequence.current) setInviteError("Could not load invitations. Check your connection and retry."); }
    finally { if (sequence === inviteSequence.current) setInviteLoading(false); }
  }, [router]);
  useEffect(() => {
    const counter = inviteSequence; const kickoff = setTimeout(() => void loadInvites(), 0); const refresh = () => { void loadInvites(); };
    const timer = setInterval(refresh, 60_000); window.addEventListener("focus", refresh);
    return () => { counter.current++; clearTimeout(kickoff); clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [loadInvites]);
  useEffect(() => {
    function lost(event: Event) {
      if (!(event instanceof CustomEvent)) return;
      const parsed = z.object({ sheetId: z.string(), status: z.number() }).safeParse(event.detail);
      if (!parsed.success || parsed.data.sheetId !== sheet?.id) return;
      setUnavailable(true); setModal(null); setDirty(false); setPending(false); setAvailable((previous) => previous.filter((item) => item.id !== parsed.data.sheetId));
      void fetch(`/api/sheets/${parsed.data.sheetId}/select`, { method: "DELETE" }).catch(() => undefined).finally(() => router.refresh());
      if (parsed.data.status === 401) { router.replace("/sign-in?expired=1"); router.refresh(); }
    }
    const share = () => { if (sheet?.role === "owner") { modalTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; setModal("share"); } };
    window.addEventListener(sheetAccessEvent, lost); window.addEventListener("homebooks-open-share", share);
    return () => { window.removeEventListener(sheetAccessEvent, lost); window.removeEventListener("homebooks-open-share", share); };
  }, [router, sheet?.id, sheet?.role]);
  useEffect(() => {
    if (!sheet) return;
    let alive = true;
    async function check() {
      try {
        const response = await fetch(`/api/sheets/${sheet?.id}`, { cache: "no-store" });
        if (!alive) return;
        if (response.status === 401 || response.status === 404) loseSheetAccess(sheet?.id ?? "", response.status);
      } catch { /* A temporary connection failure is not evidence of revoked access. */ }
    }
    const timer = setInterval(check, 60_000);
    void check();
    window.addEventListener("focus", check);
    function visible() { if (document.visibilityState === "visible") void check(); }
    document.addEventListener("visibilitychange", visible);
    return () => { alive = false; clearInterval(timer); window.removeEventListener("focus", check); document.removeEventListener("visibilitychange", visible); };
  }, [sheet, router]);
  function close() { setModal(null); setDirty(false); }
  async function switchSheet(id: string) {
    if (switching.current || pending || id === sheet?.id) return;
    switching.current = true; setSwitchPending(true); setSwitchError("");
    try {
      const response = await fetch(`/api/sheets/${id}/select`, { method: "POST" });
      if (response.status === 401) { setUnavailable(true); router.replace("/sign-in?expired=1"); router.refresh(); return; }
      if (!response.ok) {
        if (response.status === 404) { loseSheetAccess(id, 404); setAvailable((previous) => previous.filter((item) => item.id !== id)); }
        const reply = z.object({ message: z.string() }).safeParse(await response.json());
        setSwitchError(reply.success ? reply.data.message : "Could not switch sheets. Try again."); return;
      }
      const channel = new BroadcastChannel("homebooks-selection"); channel.postMessage("changed"); channel.close();
      window.location.assign(pageHref("overview"));
    } catch { setSwitchError("Could not connect. Try switching sheets again."); }
    finally { switching.current = false; setSwitchPending(false); }
  }
  function navigation() {
    return <><p className="brand">Homebooks</p>
      <nav aria-label="Sheet navigation">{sections.map((item) => sheet ? <IntentLink className={`nav-link${item === section ? " active" : ""}${navigating && destination === pageHref(item, month) ? " nav-pending" : ""}`} key={item} href={pageHref(item, month)} aria-current={item === section ? "page" : undefined} onNavigate={(event) => { event.preventDefault(); close(); navigate(pageHref(item, month)); }}><svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d={paths[item]} /></svg>{item === "import" ? "Import" : names[item]}</IntentLink> : <span className="nav-link unavailable" key={item}>{names[item]}</span>)}</nav>
      <footer className="sidebar-footer"><Button disabled={pending || switchPending} onClick={() => openModal("switch")}>Switch sheet</Button>{isAdmin && <Link className="text-link" href="/admin/backups">Backup status</Link>}<p>{userName}</p><SignOut /></footer></>;
  }
  async function invitationsChanged(resolvedId?: string) {
    if (resolvedId) setInvites((previous) => previous?.filter((invite) => invite.id !== resolvedId) ?? null);
    await loadInvites();
    try {
      const response = await fetch("/api/sheets", { cache: "no-store" });
      if (!response.ok) { setInviteError("Invitation answered. Could not refresh your sheets. Open the shared sheet or retry."); return; }
      setAvailable(availableSheetsSchema.parse(await response.json()).sheets);
    } catch { setInviteError("Invitation answered. Could not refresh your sheets. Retry invitations."); }
  }
  function inbox() { return <IncomingInvites invites={invites} loading={inviteLoading} opening={switchPending} error={[inviteError, switchError].filter(Boolean).join(" ")} retry={() => void invitationsChanged()} onResolved={invitationsChanged} onOpenSheet={(id) => void switchSheet(id)} onPending={setPending} />; }
  if (unavailable) return <SheetUnavailable />;
  return <div className="app-shell"><a className="skip-link" href="#page-content">Skip to content</a><aside className="sidebar">{navigation()}</aside><div className="workspace">
    <header className="topbar"><div className="topbar-left"><Button className="menu-button" onClick={() => openModal("navigation")}>Menu</Button><strong>{sheet?.name ?? "Homebooks"}</strong>{sheet && <Badge>{sheet.currency}</Badge>}</div><div className="actions">{sheet && section !== "transactions" && <Link className="button primary desktop-add" href={`${pageHref("transactions", month)}&add=1`}>Add transaction</Link>}<Button disabled={pending} onClick={() => { openModal("invites"); void loadInvites(); }}>Invites{invites && ` (${invites.length})`}</Button>{sheet?.role === "owner" && <Button className="desktop-share" onClick={() => openModal("share")}>Share</Button>}</div></header>
    <span className="sr-only" role="status">{navigating ? "Preparing destination" : ""}</span>{showProgress && <div className="navigation-progress" role="status">Updating view…</div>}<main className="page" id="page-content" aria-busy={navigating || undefined}><div className="page-heading"><div><h1>{sheet ? names[section] : "Welcome to Homebooks"}</h1>{sheet && <p>{section === "overview" ? "Track this sheet’s spending for the selected month." : section === "owed" ? "All-time expense repayment tracking." : section === "budgets" ? "Monthly limits for spending categories." : `Your sheet’s ${names[section].toLowerCase()}.`}</p>}</div>{sheet && (section === "overview" || section === "budgets") && <MonthPicker key={sheet.id} sheet={sheet} month={month} onChange={(value) => navigate(pageHref(section, value))} />}</div>
      {sheet && (section === "overview" || section === "budgets") && <p className="hint">{cycleRangeLabel(resolvePeriod(month, sheet))}</p>}
      {sheet && (section !== "transactions" || sheet.role === "owner") && <div className="phone-actions">{section !== "transactions" && <Link className="button primary" href={`${pageHref("transactions", month)}&add=1`}>Add transaction</Link>}{sheet.role === "owner" && <Button onClick={() => openModal("share")}>Share</Button>}</div>}{!sheet && available.length > 0 ? <EmptyState title="Your sheets are ready" action={<div className="actions">{available.map((item) => <Button key={item.id} disabled={pending || switchPending} onClick={() => void switchSheet(item.id)}>Open {item.name}</Button>)}</div>}>Open a shared sheet or choose one in the sheet switcher.</EmptyState> : children}{!sheet && <section className="shared-panel"><h2>Incoming invitations</h2>{inbox()}</section>}</main></div>
    {modal && <Dialog key={modal} title={modal === "navigation" ? "Menu" : modal === "switch" ? "Switch sheet" : modal === "create" ? "Create sheet" : modal === "invites" ? "Invites" : `Invite someone to ${sheet?.name ?? "sheet"}`} open onClose={close} drawer={modal === "navigation"} dirty={dirty} pending={pending || switchPending} returnFocus={modalTrigger}>
      {modal === "navigation" ? navigation() : modal === "switch" ? <><Selector id="current-sheet" label="Current sheet" value={sheet?.id ?? ""} disabled={pending || switchPending || !available.length} onChange={(event) => void switchSheet(event.target.value)}>{!sheet && <option value="">{available.length ? "Choose a sheet" : "No sheets yet"}</option>}{available.map((item) => <option key={item.id} value={item.id}>{item.name} - {item.role === "owner" ? "Owner" : "Shared"}</option>)}</Selector>{switchPending && <Notice>Switching sheet...</Notice>}{switchError && <Notice tone="error">{switchError}</Notice>}<Button onClick={() => { setDirty(false); openModal("create"); }}>Create sheet</Button></> : modal === "create" ? <CreateSheetForm currencies={currencies} onDirty={setDirty} onPending={setPending} /> : modal === "invites" ? inbox() : sheet && <SharingDialog sheet={sheet} onPending={setPending} onManage={() => requestAppNavigation({ href: `${pageHref("settings")}#people-heading`, navigate: (href) => { close(); router.push(href); } })} />}
    </Dialog>}<SessionWatch /></div>;
}
