import { handleSheetRequest } from "@/sheets/http";
export const runtime = "nodejs";
export async function GET(request: Request) { return handleSheetRequest(request, { kind: "list" }); }
export async function POST(request: Request) { return handleSheetRequest(request, { kind: "create" }); }
