import { SheetScreen } from "@/components/sheet-screen";
export const dynamic = "force-dynamic";
export default async function Page({ params, searchParams }: { params: Promise<{ sheetId: string }>; searchParams: Promise<{ month?: string }> }) {
  return <SheetScreen sheetId={(await params).sheetId} section="overview" month={(await searchParams).month} />;
}
