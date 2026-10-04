import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getAuth } from "@/auth/server";
import { readSheet, listSheets, SheetError } from "@/sheets/service";
import { supportedCurrencies } from "@/sheets/input";
import { AppShell } from "./app-shell";
import { EmptyState } from "./ui";
import { SettingsScreen } from "./settings-screen";
import { LedgerScreen } from "./ledger-screen";
import { selectedMonth, type Section } from "./shell-state";
export async function SheetScreen({ sheetId, section, month, add = false }: { sheetId: string; section: Section; month?: string; add?: boolean }) {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in?expired=1");
  let sheet: ReturnType<typeof readSheet>;
  try { sheet = readSheet(session.user.id, sheetId); }
  catch (error) {
    if (!(error instanceof SheetError) && !(error instanceof z.ZodError)) throw error;
    return <main className="sheet-page"><EmptyState title="This sheet is no longer available" action={<><Link href="/">Choose another sheet</Link><Link href="/sheets/new">Create sheet</Link></>}>Choose another sheet or create one to continue.</EmptyState></main>;
  }
  return <AppShell key={`${sheet.id}:${section}`} sheet={sheet} sheets={listSheets(session.user.id)} section={section} month={selectedMonth(month)} userName={session.user.name} currencies={supportedCurrencies}>
    {section === "settings" ? <SettingsScreen sheet={sheet} profile={session.user} /> : section === "transactions" ? <LedgerScreen sheet={sheet} month={selectedMonth(month)} openNew={add} /> : <EmptyState action={section === "overview" ? <Link className="button primary" href={`/sheets/${sheet.id}/transactions?month=${selectedMonth(month)}&add=1`}>Add transaction</Link> : undefined} title={section === "overview" ? "Spending summaries are not available yet" : section === "budgets" ? "No monthly limits set" : "CSV import is not available yet"}>{section === "overview" ? "Open Transactions to enter and review spending. CSV import and spending summaries are not available yet." : section === "budgets" ? "Monthly limits are not available yet. Spending and remaining totals will appear when budgeting is available." : "CSV mapping and review are not available yet. No file has been imported."}</EmptyState>}
  </AppShell>;
}
