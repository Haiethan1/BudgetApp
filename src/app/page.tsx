import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth, isInitialized } from "@/auth/server";
import { SessionWatch, SignOut } from "@/components/session-watch";
export const dynamic = "force-dynamic";
export default async function Home() {
  if (!isInitialized()) redirect("/setup");
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  return (
    <main>
      <section className="panel" aria-labelledby="welcome-heading">
        <p className="eyebrow">Homebooks</p>
        <h1 id="welcome-heading">Welcome, {session.user.name}</h1>
        <p className="description">
          You are signed in. Your sheets will appear here when sheet creation is available.
        </p>
        <SessionWatch /><SignOut />
      </section>
    </main>
  );
}
