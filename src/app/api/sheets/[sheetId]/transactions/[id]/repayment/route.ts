import { handleLedgerRequest } from "@/ledger/http";
export const runtime = "nodejs";
export async function PUT(request: Request, context: { params: Promise<{ sheetId: string; id: string }> }) { return handleLedgerRequest(request, { kind: "repayment", ...(await context.params) }); }
