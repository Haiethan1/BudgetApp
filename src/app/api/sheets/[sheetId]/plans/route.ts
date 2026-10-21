import { handlePlanRequest } from "@/plans/http";
export async function GET(request: Request, { params }: { params: Promise<{ sheetId: string }> }) { return handlePlanRequest(request, (await params).sheetId); }
export async function POST(request: Request, { params }: { params: Promise<{ sheetId: string }> }) { return handlePlanRequest(request, (await params).sheetId); }
