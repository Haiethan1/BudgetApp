import { Suspense, type ReactNode } from "react";
import { CurrentShell } from "@/components/current-shell";
import { PageSkeleton } from "@/components/page-skeleton";
import { currentSheet } from "@/sheets/current";
import { currentPeriod } from "@/sheets/cycle";
import { listSheets } from "@/sheets/service";
import { supportedCurrencies } from "@/sheets/input";

export default async function Layout({ children }: { children: ReactNode }) {
  const { session, sheet } = await currentSheet();
  return <CurrentShell initial={{ routed: true, sheet, sheets: listSheets(session.user.id), month: currentPeriod(sheet), userName: session.user.name, currencies: supportedCurrencies, isAdmin: session.user.isInstanceAdmin }}>
    <Suspense fallback={<PageSkeleton />}>{children}</Suspense>
  </CurrentShell>;
}
