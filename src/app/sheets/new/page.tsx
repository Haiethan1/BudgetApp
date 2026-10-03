import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "@/auth/server";
import { CreateSheetForm } from "@/components/create-sheet-form";
import { SessionWatch } from "@/components/session-watch";
import { supportedCurrencies } from "@/sheets/input";
export const dynamic = "force-dynamic";
export default async function NewSheetPage() {
  if (!await getAuth().api.getSession({ headers: await headers() })) redirect("/sign-in?expired=1");
  return <main className="sheet-page"><section className="sheet-panel narrow"><p className="brand">Homebooks</p><h1>Create sheet</h1>
    <CreateSheetForm currencies={supportedCurrencies} /><Link href="/">Cancel</Link><SessionWatch />
  </section></main>;
}
