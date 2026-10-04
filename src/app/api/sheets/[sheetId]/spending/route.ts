import { handleLedgerRequest } from "@/ledger/http";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ sheetId: string }> }) { return handleLedgerRequest(request, { kind: "spending", ...(await context.params), month: new URL(request.url).searchParams.get("month") ?? "" }); }
