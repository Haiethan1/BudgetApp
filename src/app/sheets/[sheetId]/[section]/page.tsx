import { notFound } from "next/navigation";
import { LegacySheetLink } from "@/components/legacy-sheet-link";
import { sections } from "@/components/shell-state";
export const dynamic = "force-dynamic";
export default async function Page({ params, searchParams }: { params: Promise<{ sheetId: string; section: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { sheetId, section } = await params;
  const selected = sections.find((value) => value === section);
  if (!selected) notFound();
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    if (typeof value === "string") query.set(key, value);
  }
  return <LegacySheetLink sheetId={sheetId} destination={`/${selected}${query.size ? `?${query}` : ""}`} />;
}
