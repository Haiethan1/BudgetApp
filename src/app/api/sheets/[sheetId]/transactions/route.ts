import { handleLedgerRequest } from "@/ledger/http";
export const runtime = "nodejs";
type Context = { params: Promise<{ sheetId: string }> };
export async function GET(request: Request, context: Context) { return handleLedgerRequest(request, { kind: "list", ...(await context.params) }); }
export async function POST(request: Request, context: Context) { return handleLedgerRequest(request, { kind: "create", ...(await context.params) }); }
