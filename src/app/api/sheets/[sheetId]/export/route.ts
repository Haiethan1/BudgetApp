import { handleExportRequest } from "@/exports/http";
export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ sheetId: string }> }) { return handleExportRequest(request, (await context.params).sheetId); }
