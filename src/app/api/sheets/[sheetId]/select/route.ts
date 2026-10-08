import { handleSheetRequest } from "@/sheets/http";
export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ sheetId: string }> }) {
  return handleSheetRequest(request, { kind: "select", sheetId: (await context.params).sheetId });
}
export async function DELETE(request: Request) { return handleSheetRequest(request, { kind: "clearSelection" }); }
