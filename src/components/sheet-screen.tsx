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
import { ImportScreen } from "./import-screen";
import { BudgetsScreen } from "./budgets-screen";
import { OverviewScreen } from "./overview-screen";
import { selectedMonth, type Section } from "./shell-state";
export async function SheetScreen({ sheetId, section, month, add = false, batchId, categoryId }: { sheetId: string; section: Section; month?: string; add?: boolean; batchId?: string; categoryId?: string }) {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in?expired=1");
  let sheet: ReturnType<typeof readSheet>;
  try { sheet = readSheet(session.user.id, sheetId); }
  catch (error) {
    if (!(error instanceof SheetError) && !(error instanceof z.ZodError)) throw error;
    return <main className="sheet-page"><EmptyState title="This sheet is no longer available" action={<><Link href="/">Choose another sheet</Link><Link href="/sheets/new">Create sheet</Link></>}>Choose another sheet or create one to continue.</EmptyState></main>;
  }
  return <AppShell key={`${sheet.id}:${section}`} sheet={sheet} sheets={listSheets(session.user.id)} section={section} month={selectedMonth(month)} userName={session.user.name} currencies={supportedCurrencies}>
    {section === "settings" ? <SettingsScreen sheet={sheet} profile={session.user} /> : section === "transactions" ? <LedgerScreen sheet={sheet} month={selectedMonth(month)} openNew={add} batchId={batchId} categoryId={categoryId} /> : section === "import" ? <ImportScreen sheet={sheet} batchId={batchId} /> : section === "budgets" ? <BudgetsScreen key={selectedMonth(month)} sheet={sheet} month={selectedMonth(month)} /> : <OverviewScreen key={selectedMonth(month)} sheet={sheet} month={selectedMonth(month)} />}
  </AppShell>;
}
