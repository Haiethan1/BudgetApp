import { LegacySheetLink } from "@/components/legacy-sheet-link";
export const dynamic = "force-dynamic";
export default async function Page({ params, searchParams }: { params: Promise<{ sheetId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    if (typeof value === "string") query.set(key, value);
  }
  return <LegacySheetLink sheetId={(await params).sheetId} destination={`/transactions${query.size ? `?${query}` : ""}`} />;
}
