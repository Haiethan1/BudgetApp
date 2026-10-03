import { handleSheetRequest } from "@/sheets/http";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ sheetId: string }> }) {
  return handleSheetRequest(request, { kind: "read", sheetId: (await context.params).sheetId });
}
