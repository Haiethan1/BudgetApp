import { handleLedgerRequest } from "@/ledger/http";
export const runtime = "nodejs";
type Context = { params: Promise<{ sheetId: string }> };
export async function GET(request: Request, context: Context) { return handleLedgerRequest(request, { kind: "owed", ...(await context.params) }); }
export async function PUT(request: Request, context: Context) { return handleLedgerRequest(request, { kind: "tracking", ...(await context.params) }); }
