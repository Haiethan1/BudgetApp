import { notFound } from "next/navigation";
import { SheetScreen } from "@/components/sheet-screen";
import { sections } from "@/components/shell-state";
export const dynamic = "force-dynamic";
export default async function Page({ params, searchParams }: { params: Promise<{ sheetId: string; section: string }>; searchParams: Promise<{ month?: string; add?: string }> }) {
  const { sheetId, section } = await params;
  const selected = sections.find((value) => value === section);
  if (!selected) notFound();
  return <SheetScreen sheetId={sheetId} section={selected} month={(await searchParams).month} add={(await searchParams).add === "1"} />;
}
