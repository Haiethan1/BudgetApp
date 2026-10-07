import { handleSharingRequest } from "@/sharing/http";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ sheetId: string }> }) { return handleSharingRequest(request, { kind: "sharing", sheetId: (await context.params).sheetId }); }
export async function POST(request: Request, context: { params: Promise<{ sheetId: string }> }) { return handleSharingRequest(request, { kind: "sharing", sheetId: (await context.params).sheetId }); }
