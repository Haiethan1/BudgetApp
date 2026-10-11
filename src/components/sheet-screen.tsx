import { currentCycleMonth } from "../sheets/cycle";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getAuth } from "@/auth/server";
import { readSheet, SheetError } from "@/sheets/service";
import { SheetUnavailable } from "./sheet-unavailable";
import { SettingsScreen } from "./settings-screen";
import { LedgerScreen } from "./ledger-screen";
import { ImportScreen } from "./import-screen";
import { BudgetsScreen } from "./budgets-screen";
import { OwedScreen } from "./owed-screen";
import { OverviewScreen } from "./overview-screen";
import { selectedMonth, type Section } from "./shell-state";
export async function SheetScreen({ sheetId, section, month, add = false, batchId, categoryId, resolvedSheet }: { sheetId: string; section: Section; month?: string; add?: boolean; batchId?: string; categoryId?: string; resolvedSheet?: ReturnType<typeof readSheet> }) {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in?expired=1");
  let sheet: ReturnType<typeof readSheet>;
  try { sheet = resolvedSheet ?? readSheet(session.user.id, sheetId); }
  catch (error) {
    if (!(error instanceof SheetError) && !(error instanceof z.ZodError)) throw error;
    return <SheetUnavailable sheetId={sheetId} />;
  }
  const cycleMonth = selectedMonth(month, currentCycleMonth(sheet.cycleStartDay));
  return <>
    {section === "owed" ? <OwedScreen sheet={sheet} /> : section === "settings" ? <SettingsScreen sheet={sheet} profile={session.user} /> : section === "transactions" ? <LedgerScreen key={sheet.id} sheet={sheet} month={cycleMonth} openNew={add} batchId={batchId} categoryId={categoryId} /> : section === "import" ? <ImportScreen sheet={sheet} userId={session.user.id} batchId={batchId} /> : section === "budgets" ? <BudgetsScreen key={cycleMonth} sheet={sheet} month={cycleMonth} /> : <OverviewScreen key={cycleMonth} sheet={sheet} month={cycleMonth} />}
  </>;
}
