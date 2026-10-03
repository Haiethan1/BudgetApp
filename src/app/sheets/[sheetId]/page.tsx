import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getAuth } from "@/auth/server";
import { SheetSwitcher } from "@/components/sheet-switcher";
import { SessionWatch, SignOut } from "@/components/session-watch";
import { listSheets, readSheet, SheetError } from "@/sheets/service";
export const dynamic = "force-dynamic";
export default async function SheetPage({ params }: { params: Promise<{ sheetId: string }> }) {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in?expired=1");
  let sheet: ReturnType<typeof readSheet>;
  try { sheet = readSheet(session.user.id, (await params).sheetId); }
  catch (error) {
    if (!(error instanceof SheetError) && !(error instanceof z.ZodError)) throw error;
    return <main className="sheet-page"><section className="sheet-panel"><p className="brand">Homebooks</p><h1>Sheet unavailable</h1>
      <p>You no longer have access, or this sheet does not exist.</p><Link href="/">Choose another sheet</Link><SessionWatch /></section></main>;
  }
  return <main className="sheet-page"><div className="sheet-content"><header className="sheet-heading"><p className="brand">Homebooks</p><SignOut /></header>
    <section className="sheet-panel"><SheetSwitcher sheets={listSheets(session.user.id)} selected={sheet.id} />
      <h1>{sheet.name}</h1><p>{sheet.currency} · {sheet.role === "owner" ? "You own this sheet" : "Shared with you"}</p></section>
    <section className="sheet-panel"><h2>Your sheet is ready</h2><p>Uncategorized and Unassigned are ready for your first transactions.</p>
      <p className="hint">Transaction entry and budgeting become available in the spending phase.</p></section><SessionWatch />
  </div></main>;
}
