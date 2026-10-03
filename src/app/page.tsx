import Link from "next/link";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth, isInitialized } from "@/auth/server";
import { SessionWatch, SignOut } from "@/components/session-watch";
import { accessibleSelection } from "@/sheets/service";
import { selectionCookie } from "@/sheets/http";
export const dynamic = "force-dynamic";
export default async function Home() {
  if (!isInitialized()) redirect("/setup");
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  const selected = accessibleSelection(session.user.id, (await cookies()).get(selectionCookie)?.value);
  if (selected) redirect(`/sheets/${selected.id}`);
  return (
    <main>
      <section className="panel" aria-labelledby="welcome-heading">
        <p className="eyebrow">Homebooks</p>
        <h1 id="welcome-heading">Welcome to Homebooks</h1>
        <p className="description">
          Create your first sheet to organize your household spending.
        </p>
        <Link className="button primary" href="/sheets/new">Create sheet</Link><SessionWatch /><SignOut />
      </section>
    </main>
  );
}
