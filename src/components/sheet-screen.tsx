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
import { readOverview } from "../overview/service";
import { readBudgets } from "../budgets/service";
import { listTransactions } from "../ledger/service";
import { listOwed } from "../repayments/service";
import { readImportReview } from "../imports/review";
import { reviewSchema } from "../imports/presentation";
import { readSharing } from "../sharing/service";
import { sharingPageSchema } from "../sharing/presentation";
import { ledgerPageSchema } from "../ledger/presentation";
import { owedPageSchema } from "../repayments/input";
import { budgetCycle } from "../sheets/cycle";
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
  if (section === "settings") {
    const sharing = sheet.role === "owner" ? readSharing(session.user.id, sheet.id) : undefined;
    return <><SettingsScreen sheet={sheet} profile={session.user}
      initialBudgets={readBudgets(session.user.id, sheet.id, currentCycleMonth(sheet.cycleStartDay))}
      initialPeople={sharing ? sharingPageSchema.parse({ ...sharing, invites: sharing.invites.map((invite) => ({ ...invite, createdAt: invite.createdAt.toISOString() })) }) : undefined} /></>;
  }
  return <>
    {section === "owed" ? <OwedScreen sheet={sheet} initialResult={owedPageSchema.parse(listOwed(session.user.id, sheet.id))} />
      : section === "transactions" ? <LedgerScreen key={sheet.id} sheet={sheet} month={cycleMonth} openNew={add} batchId={batchId} categoryId={categoryId}
        initialResult={ledgerPageSchema.parse(listTransactions(session.user.id, sheet.id, batchId ? { batchId } : { ...budgetCycle(cycleMonth, sheet.cycleStartDay), ...(categoryId ? { categoryId } : {}) }))} />
      : section === "import" ? <ImportScreen initialReview={batchId ? reviewSchema.parse(readImportReview(session.user.id, sheet.id, batchId)) : undefined} sheet={sheet} userId={session.user.id} batchId={batchId} />
      : section === "budgets" ? <BudgetsScreen initialResult={readBudgets(session.user.id, sheet.id, cycleMonth)} key={cycleMonth} sheet={sheet} month={cycleMonth} />
      : <OverviewScreen initialResult={readOverview(session.user.id, sheet.id, cycleMonth)} key={cycleMonth} sheet={sheet} month={cycleMonth} />}
  </>;
}
