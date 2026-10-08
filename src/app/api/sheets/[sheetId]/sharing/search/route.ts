import { handleSharingRequest } from "@/sharing/http";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ sheetId: string }> }) { return handleSharingRequest(request, { kind: "search", sheetId: (await context.params).sheetId }); }
