import { currentCycleMonth } from "../../../sheets/cycle";
import { notFound } from "next/navigation";
import { SheetScreen } from "@/components/sheet-screen";
import { CurrentPage } from "@/components/current-shell";
import { sections } from "@/components/shell-state";
import { currentSheet } from "@/sheets/current";
import { supportedCurrencies } from "@/sheets/input";
import { listSheets } from "@/sheets/service";

export const dynamic = "force-dynamic";
export default async function Page({ params, searchParams }: { params: Promise<{ section: string }>; searchParams: Promise<{ month?: string; add?: string; batchId?: string; categoryId?: string }> }) {
  const { section } = await params;
  const selected = sections.find((value) => value === section);
  if (!selected) notFound();
  const { session, sheet } = await currentSheet();
  const query = await searchParams;
  const content = await SheetScreen({ sheetId: sheet.id, resolvedSheet: sheet, section: selected, month: query.month, add: query.add === "1", batchId: query.batchId, categoryId: query.categoryId });
  return <CurrentPage key={sheet.id} snapshot={{ routed: true, sheet, sheets: listSheets(session.user.id), month: currentCycleMonth(sheet.cycleStartDay), userName: session.user.name, currencies: supportedCurrencies, isAdmin: session.user.isInstanceAdmin }}>{content}</CurrentPage>;
}
