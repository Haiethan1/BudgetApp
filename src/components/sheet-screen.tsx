import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getAuth } from "@/auth/server";
import { readSheet, listSheets, SheetError } from "@/sheets/service";
import { supportedCurrencies } from "@/sheets/input";
import { AppShell } from "./app-shell";
import { Badge, EmptyState, Panel, ResponsiveRecords } from "./ui";
import { selectedMonth, type Section } from "./shell-state";
export async function SheetScreen({ sheetId, section, month }: { sheetId: string; section: Section; month?: string }) {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in?expired=1");
  let sheet: ReturnType<typeof readSheet>;
  try { sheet = readSheet(session.user.id, sheetId); }
  catch (error) {
    if (!(error instanceof SheetError) && !(error instanceof z.ZodError)) throw error;
    return <main className="sheet-page"><EmptyState title="This sheet is no longer available" action={<><Link href="/">Choose another sheet</Link><Link href="/sheets/new">Create sheet</Link></>}>Choose another sheet or create one to continue.</EmptyState></main>;
  }
  const labels = [...sheet.categories.map((item) => ({ id: item.id, name: item.name, kind: "Category", protected: item.isProtected })), ...sheet.buckets.map((item) => ({ id: item.id, name: item.name, kind: "Attribution bucket", protected: item.isProtected }))];
  return <AppShell key={`${sheet.id}:${section}`} sheet={sheet} sheets={listSheets(session.user.id)} section={section} month={selectedMonth(month)} userName={session.user.name} currencies={supportedCurrencies}>
    {section === "settings" ? <><Panel><h2>Sheet</h2><dl><dt>Name</dt><dd>{sheet.name}</dd><dt>Currency</dt><dd>{sheet.currency} · Set at creation</dd><dt>Your role</dt><dd><Badge>{sheet.role === "owner" ? "Owner" : "Member"}</Badge></dd></dl><p className="hint">Sheet editing and member management are not available yet.</p></Panel><Panel><h2>Categories and attribution</h2><ResponsiveRecords headers={["Name", "Type", "Status"]} rows={labels.map((item) => [item.name, item.kind, <Badge key={item.id}>{item.protected ? "Protected default" : "Active"}</Badge>])} cards={labels.map((item) => <div key={item.id}><strong>{item.name}</strong><p>{item.kind}</p><Badge>{item.protected ? "Protected default" : "Active"}</Badge></div>)} /></Panel><Panel><h2>Your profile</h2><p>{session.user.name}</p><p>{session.user.email}</p><p className="hint">Profile editing is not available yet. Sign out is in the navigation.</p></Panel></> : <EmptyState title={section === "overview" || section === "transactions" ? "No transactions yet" : section === "budgets" ? "No monthly limits set" : "CSV import is not available yet"}>{section === "overview" || section === "transactions" ? "Transaction entry and CSV import are not available yet. Your sheet is ready with Uncategorized and Unassigned." : section === "budgets" ? "Monthly limits are not available yet. Spending and remaining totals will appear when budgeting is available." : "CSV mapping and review are not available yet. No file has been imported."}</EmptyState>}
  </AppShell>;
}
