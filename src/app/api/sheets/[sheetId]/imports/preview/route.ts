import { handleImportPreview } from "@/imports/http";
export async function POST(request: Request, { params }: { params: Promise<{ sheetId: string }> }) {
  return handleImportPreview(request, (await params).sheetId);
}
