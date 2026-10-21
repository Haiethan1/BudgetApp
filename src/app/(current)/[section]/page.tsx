import { currentPeriod } from "../../../sheets/cycle";
import { notFound } from "next/navigation";
import { SheetScreen } from "@/components/sheet-screen";
import { CurrentPage } from "@/components/current-shell";
import { sections } from "@/components/shell-state";
import { currentSheet } from "@/sheets/current";
import { supportedCurrencies } from "@/sheets/input";
import { listSheets } from "@/sheets/service";
import type { LedgerQuery } from "@/ledger/grid-filters";

export const dynamic = "force-dynamic";
export default async function Page({ params, searchParams }: { params: Promise<{ section: string }>; searchParams: Promise<LedgerQuery & { month?: string; add?: string }> }) {
  const { section } = await params;
  const selected = sections.find((value) => value === section);
  if (!selected) notFound();
  const { session, sheet, setupUserId } = await currentSheet();
  const query = await searchParams;
  const ledgerQuery = Object.fromEntries(Object.entries(query).filter(([key, value]) => value !== undefined && ["view", "batchId", "payee", "from", "to", "accountId", "kind", "categoryId", "bucketId"].includes(key)));
  const content = await SheetScreen({ sheetId: sheet.id, resolvedSheet: sheet, section: selected, month: query.month, add: query.add === "1", batchId: query.batchId, categoryId: query.categoryId, accountId: query.accountId, ledgerQuery });
  return <CurrentPage key={sheet.id} snapshot={{ routed: true, sheet, setupUserId, sheets: listSheets(session.user.id), month: currentPeriod(sheet), userName: session.user.name, currencies: supportedCurrencies, isAdmin: session.user.isInstanceAdmin }}>{content}</CurrentPage>;
}
