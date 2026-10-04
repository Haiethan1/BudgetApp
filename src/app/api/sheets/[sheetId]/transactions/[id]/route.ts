import { handleLedgerRequest } from "@/ledger/http";
export const runtime = "nodejs";
type Context = { params: Promise<{ sheetId: string; id: string }> };
export async function GET(request: Request, context: Context) { return handleLedgerRequest(request, { kind: "read", ...(await context.params) }); }
export async function PUT(request: Request, context: Context) { return handleLedgerRequest(request, { kind: "edit", ...(await context.params) }); }
export async function DELETE(request: Request, context: Context) { return handleLedgerRequest(request, { kind: "delete", ...(await context.params) }); }
