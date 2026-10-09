import type { ReactNode } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getAuth } from "@/auth/server";
import { readSheet, listSheets, SheetError } from "@/sheets/service";
import { supportedCurrencies } from "@/sheets/input";
import { AppShell } from "@/components/app-shell";
import { SheetUnavailable } from "@/components/sheet-unavailable";
import { currentMonth } from "@/components/shell-state";
export default async function SheetLayout({ params, children }: { params: Promise<{ sheetId: string }>; children: ReactNode }) {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in?expired=1");
  let sheet: ReturnType<typeof readSheet>;
  try { sheet = readSheet(session.user.id, (await params).sheetId); }
  catch (error) {
    if (!(error instanceof SheetError) && !(error instanceof z.ZodError)) throw error;
    return <SheetUnavailable />;
  }
  return <AppShell key={sheet.id} routed sheet={sheet} sheets={listSheets(session.user.id)} month={currentMonth()} userName={session.user.name} currencies={supportedCurrencies} isAdmin={session.user.isInstanceAdmin}>{children}</AppShell>;
}
