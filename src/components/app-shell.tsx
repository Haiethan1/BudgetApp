"use client";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { Dialog } from "./dialog";
import { CreateSheetForm } from "./create-sheet-form";
import { SessionWatch, SignOut } from "./session-watch";
import { Badge, Button, EmptyState, Notice, Selector } from "./ui";
import { monthLabel, monthOptions, sections, sheetHref, type Section } from "./shell-state";

type Sheet = { id: string; name: string; currency: string; role: string };
type Modal = "navigation" | "create" | "invites" | "share";
const names: Record<Section, string> = { overview: "Overview", transactions: "Transactions", budgets: "Budgets", import: "Import", settings: "Settings" };
const paths: Record<Section, string> = { overview: "M3 11 12 3l9 8M5 10v11h14V10M9 21v-7h6v7", transactions: "M4 5h16M4 12h16M4 19h16", budgets: "M4 21V10h4v11M10 21V3h4v18M16 21v-8h4v8", import: "M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5", settings: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2" };
export function AppShell({ sheet, sheets, section = "overview", month, userName, currencies, children }: {
  sheet?: Sheet; sheets: Sheet[]; section?: Section; month: string; userName: string; currencies: string[]; children: ReactNode;
}) {
  const router = useRouter();
  const [modal, setModal] = useState<Modal | null>(null);
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState(false);
  const [switchPending, setSwitchPending] = useState(false);
  const [switchError, setSwitchError] = useState("");
  const [unavailable, setUnavailable] = useState(false);
  const switching = useRef(false);
  const modalTrigger = useRef<HTMLElement | null>(null);
  function openModal(next: Modal) {
    if (!modal) modalTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setModal(next);
  }
  useEffect(() => {
    if (!sheet) return;
    let alive = true;
    async function check() {
      try {
        const response = await fetch(`/api/sheets/${sheet?.id}`, { cache: "no-store" });
        if (!alive) return;
        if (response.status === 401) { setUnavailable(true); router.replace("/sign-in?expired=1"); router.refresh(); }
        else if (response.status === 404) { setUnavailable(true); setModal(null); }
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
    if (switching.current || id === sheet?.id) return;
    switching.current = true; setSwitchPending(true); setSwitchError("");
    try {
      const response = await fetch(`/api/sheets/${id}/select`, { method: "POST" });
      if (response.status === 401) { setUnavailable(true); router.replace("/sign-in?expired=1"); router.refresh(); return; }
      if (!response.ok) {
        const reply = z.object({ message: z.string() }).safeParse(await response.json());
        setSwitchError(reply.success ? reply.data.message : "Could not switch sheets. Try again."); return;
      }
      close(); router.push(sheetHref(id, "overview")); router.refresh();
    } catch { setSwitchError("Could not connect. Try switching sheets again."); }
    finally { switching.current = false; setSwitchPending(false); }
  }
  function navigation(phone = false) {
    return <><p className="brand">Homebooks</p><Selector id={phone ? "phone-sheet" : "current-sheet"} label="Current sheet" value={sheet?.id ?? ""} disabled={switchPending || !sheets.length} onChange={(event) => void switchSheet(event.target.value)}>
      {!sheets.length && <option value="">No sheets yet</option>}{sheets.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.role === "owner" ? "Owner" : "Shared"}</option>)}</Selector>
      {switchPending && <Notice>Switching sheet…</Notice>}{switchError && <Notice tone="error">{switchError}</Notice>}
      <Button onClick={() => { setDirty(false); openModal("create"); }}>Create sheet</Button>
      <nav aria-label="Sheet navigation">{sections.map((item) => sheet ? <Link className={`nav-link${item === section ? " active" : ""}`} key={item} href={sheetHref(sheet.id, item, month)} aria-current={item === section ? "page" : undefined} onClick={close}><svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d={paths[item]} /></svg>{names[item]}</Link> : <span className="nav-link unavailable" key={item}>{names[item]}</span>)}</nav>
      <footer className="sidebar-footer"><p>{userName}</p><SignOut /></footer></>;
  }
  if (unavailable) return <main className="sheet-page"><EmptyState title="This sheet is no longer available" action={<><Link href="/">Choose another sheet</Link><Link href="/sheets/new">Create sheet</Link></>}>Choose another sheet or create one to continue.</EmptyState><SessionWatch /></main>;
  return <div className="app-shell"><a className="skip-link" href="#page-content">Skip to content</a><aside className="sidebar">{navigation()}</aside><div className="workspace">
    <header className="topbar"><div className="topbar-left"><Button className="menu-button" onClick={() => openModal("navigation")}>Menu</Button><strong>{sheet?.name ?? "Homebooks"}</strong>{sheet && <Badge>{sheet.currency}</Badge>}</div><div className="actions">{sheet && section !== "transactions" && <Link className="button primary" href={`${sheetHref(sheet.id, "transactions", month)}&add=1`}>Add transaction</Link>}<Button onClick={() => openModal("invites")}>Invites</Button>{sheet?.role === "owner" && <Button className="desktop-share" onClick={() => openModal("share")}>Share</Button>}</div></header>
    <main className="page" id="page-content"><div className="page-heading"><div><h1>{sheet ? names[section] : "Welcome to Homebooks"}</h1>{sheet && <p>{section === "overview" ? "Track this sheet’s spending for the selected month." : section === "budgets" ? "Monthly category spending limits." : `Your sheet’s ${names[section].toLowerCase()}.`}</p>}</div>{sheet && (section === "overview" || section === "budgets") && <Selector id="selected-month" label="Selected month" value={month} onChange={(event) => router.push(sheetHref(sheet.id, section, event.target.value))}>{monthOptions(month).map((value) => <option key={value} value={value}>{monthLabel(value)}</option>)}</Selector>}</div>
      {sheet?.role === "owner" && <div className="phone-actions"><Button onClick={() => openModal("share")}>Share</Button></div>}{children}</main></div>
    {modal && <Dialog key={modal} title={modal === "navigation" ? "Menu" : modal === "create" ? "Create sheet" : modal === "invites" ? "Invites" : `Share ${sheet?.name ?? "sheet"}`} open onClose={close} drawer={modal === "navigation"} dirty={dirty} pending={pending || switchPending} returnFocus={modalTrigger}>
      {modal === "navigation" ? navigation(true) : modal === "create" ? <CreateSheetForm currencies={currencies} onDirty={setDirty} onPending={setPending} /> : <Notice>{modal === "invites" ? "Incoming invitations are not available yet. You can create a sheet now." : "Inviting members is not available yet. You currently own this sheet."}</Notice>}
    </Dialog>}<SessionWatch /></div>;
}
