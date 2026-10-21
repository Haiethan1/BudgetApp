import { handleDebtRequest } from "@/repayments/debt-http";
export const runtime = "nodejs";
type Context = { params: Promise<{ sheetId: string }> };
export async function GET(request: Request, context: Context) { return handleDebtRequest(request, (await context.params).sheetId); }
export async function POST(request: Request, context: Context) { return handleDebtRequest(request, (await context.params).sheetId); }
