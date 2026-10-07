import { notFound } from "next/navigation";
import { SheetScreen } from "@/components/sheet-screen";
import { sections } from "@/components/shell-state";
export const dynamic = "force-dynamic";
export default async function Page({ params, searchParams }: { params: Promise<{ sheetId: string; section: string }>; searchParams: Promise<{ month?: string; add?: string; batchId?: string }> }) {
  const { sheetId, section } = await params;
  const selected = sections.find((value) => value === section);
  if (!selected) notFound();
  const query = await searchParams;
  return <SheetScreen sheetId={sheetId} section={selected} month={query.month} add={query.add === "1"} batchId={query.batchId} />;
}
