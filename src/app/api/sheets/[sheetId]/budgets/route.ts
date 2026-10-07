import { handleBudgetRequest } from "@/budgets/http";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ sheetId: string }> }) { return handleBudgetRequest(request, (await context.params).sheetId); }
export async function POST(request: Request, context: { params: Promise<{ sheetId: string }> }) { return handleBudgetRequest(request, (await context.params).sheetId); }
