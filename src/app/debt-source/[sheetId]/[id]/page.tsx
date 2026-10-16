import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "@/auth/server";
import { inspectDebtSource } from "@/repayments/debts";
import { SheetError } from "@/sheets/service";
import { displayAmount } from "@/ledger/presentation";
import { Panel, Notice } from "@/components/ui";
export default async function DebtSourcePage({ params }: { params: Promise<{ sheetId: string; id: string }> }) {
  const session = await getAuth().api.getSession({ headers: await headers() }); if (!session) redirect("/sign-in?expired=1");
  const { sheetId, id } = await params;
  let source: ReturnType<typeof inspectDebtSource>;
  try { source = inspectDebtSource(session.user.id, sheetId, id); } catch (e) { if (!(e instanceof SheetError)) throw e; return <main className="debt-source-page"><Notice tone="error">This source is no longer available to you.</Notice><Link href="/owed">Back to Amount owed</Link></main>; }
  const { sheet, transaction: t, portions, legacy } = source;
  return <main className="debt-source-page"><h1>Source transaction</h1><p>{sheet.name}</p><Panel><h2>{t.payee}</h2><p>{t.date} · {t.kind} · {displayAmount(t.amount, sheet.currency, true)}</p>{t.deletedAt && <Notice tone="warning">This transaction was deleted. Its retained source record remains available for debt review.</Notice>}<p>Revision {t.version}</p><h3>Current allocations</h3>{portions.map(p => <p key={p.position}>Portion {p.position + 1} · {p.bucket} · {displayAmount(p.amount, sheet.currency, true)}</p>)}{legacy && <><h3>Preserved legacy whole-expense repayment</h3><p>{legacy.date ?? "No paid date"} · {legacy.comment}</p><p>This historical metadata does not create a new debt or repayment. Tracked allocations migrated to their own debt history.</p></>}</Panel><p><Link href={`/sheets/${sheetId}/owed`}>Back to Amount owed</Link></p></main>;
}

