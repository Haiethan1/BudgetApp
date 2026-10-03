import Link from "next/link";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth, isInitialized } from "@/auth/server";
import { AppShell } from "@/components/app-shell";
import { EmptyState } from "@/components/ui";
import { currentMonth } from "@/components/shell-state";
import { supportedCurrencies } from "@/sheets/input";
import { accessibleSelection, listSheets } from "@/sheets/service";
import { selectionCookie } from "@/sheets/http";
export const dynamic = "force-dynamic";
export default async function Home() {
  if (!isInitialized()) redirect("/setup");
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  const selected = accessibleSelection(session.user.id, (await cookies()).get(selectionCookie)?.value);
  if (selected) redirect(`/sheets/${selected.id}`);
  return (
    <AppShell sheets={listSheets(session.user.id)} month={currentMonth()} userName={session.user.name} currencies={supportedCurrencies}>
      <EmptyState title="No sheets yet" action={<Link className="button primary" href="/sheets/new">Create sheet</Link>}>Create your first sheet to organize your household spending.</EmptyState>
    </AppShell>
  );
}
