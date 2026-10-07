import { handleOverviewRequest } from "@/overview/http";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ sheetId: string }> }) { return handleOverviewRequest(request, (await context.params).sheetId); }
