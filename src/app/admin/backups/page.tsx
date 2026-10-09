import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "@/auth/server";
import { isInstanceAdmin } from "@/operations/admin";
import { BackupStatusScreen } from "@/components/backup-status-screen";
import { Notice } from "@/components/ui";
import { SessionWatch, SignOut } from "@/components/session-watch";
export const dynamic = "force-dynamic";
export default async function BackupsPage() {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in?expired=1");
  return <div className="admin-workspace"><a className="skip-link" href="#page-content">Skip to content</a>
    <header className="topbar"><Link className="brand" href="/">Homebooks</Link><SignOut /></header>
    <main className="page" id="page-content"><Link className="text-link" href="/">Back to your sheets</Link>
      <div className="page-heading"><div><h1>Backup status</h1><p>Instance administration · Full-instance daily snapshots</p></div></div>
      {isInstanceAdmin(session.user.id) ? <BackupStatusScreen /> : <Notice tone="error">Instance administrator access is required. Ask your household administrator about backups.</Notice>}
    </main><SessionWatch /></div>;
}
