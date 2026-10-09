import { notFound } from "next/navigation";
import { SheetScreen } from "@/components/sheet-screen";
import { AppShell } from "@/components/app-shell";
import { currentMonth, sections } from "@/components/shell-state";
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
  return <AppShell key={sheet.id} routed sheet={sheet} sheets={listSheets(session.user.id)} month={currentMonth()} userName={session.user.name} currencies={supportedCurrencies} isAdmin={session.user.isInstanceAdmin}>
    <SheetScreen key={sheet.id} sheetId={sheet.id} section={selected} month={query.month} add={query.add === "1"} batchId={query.batchId} categoryId={query.categoryId} />
  </AppShell>;
}
