import { currentPeriod } from "../sheets/cycle";
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
import { debtPageSchema } from "../repayments/debt-input";
import { recentHistoryRange } from "../repayments/history-range";
import { resolvePeriod } from "../sheets/cycle";
import { gridFilterInput, initialGridFilters, type LedgerQuery } from "../ledger/grid-filters";
export async function SheetScreen({ sheetId, section, month, add = false, batchId, categoryId, accountId, ledgerQuery, resolvedSheet }: { sheetId: string; section: Section; month?: string; add?: boolean; batchId?: string; categoryId?: string; accountId?: string; ledgerQuery?: LedgerQuery; resolvedSheet?: ReturnType<typeof readSheet> }) {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in?expired=1");
  let sheet: ReturnType<typeof readSheet>;
  try { sheet = resolvedSheet ?? readSheet(session.user.id, sheetId); }
  catch (error) {
    if (!(error instanceof SheetError) && !(error instanceof z.ZodError)) throw error;
    return <SheetUnavailable sheetId={sheetId} />;
  }
  const cycleMonth = resolvePeriod(selectedMonth(month, currentPeriod(sheet)), sheet).from;
  const historyRange = recentHistoryRange();
  const expenseQuery = { ...ledgerQuery, ...(batchId ? { batchId } : {}), ...(categoryId ? { categoryId } : {}), ...(accountId ? { accountId } : {}) };
  const expenseFilters = initialGridFilters({ ...resolvePeriod(cycleMonth, sheet), query: expenseQuery });
  if (section === "settings") {
    const sharing = sheet.role === "owner" ? readSharing(session.user.id, sheet.id) : undefined;
    return <><SettingsScreen sheet={sheet} profile={session.user}
      initialBudgets={readBudgets(session.user.id, sheet.id, currentPeriod(sheet))}
      initialPeople={sharing ? sharingPageSchema.parse({ ...sharing, invites: sharing.invites.map((invite) => ({ ...invite, createdAt: invite.createdAt.toISOString() })) }) : undefined} /></>;
  }
  return <>
    {section === "owed" ? <OwedScreen key={sheet.id} sheet={sheet} initialRange={historyRange} initialResult={debtPageSchema.parse(listOwed(session.user.id, sheet.id, { status: "outstanding" }))} />
      : section === "transactions" ? <LedgerScreen key={sheet.id} sheet={sheet} userId={session.user.id} month={cycleMonth} openNew={add} initialAccountId={accountId} initialQuery={expenseQuery}
        initialResult={ledgerPageSchema.parse(listTransactions(session.user.id, sheet.id, gridFilterInput(expenseFilters)))} />
      : section === "import" ? <ImportScreen initialReview={batchId ? reviewSchema.parse(readImportReview(session.user.id, sheet.id, batchId)) : undefined} sheet={sheet} userId={session.user.id} initialAccountId={accountId} batchId={batchId} />
      : section === "budgets" ? <BudgetsScreen initialResult={readBudgets(session.user.id, sheet.id, cycleMonth)} key={cycleMonth} sheet={sheet} month={cycleMonth} />
      : <OverviewScreen initialResult={readOverview(session.user.id, sheet.id, cycleMonth)} key={cycleMonth} sheet={sheet} month={cycleMonth} />}
  </>;
}
