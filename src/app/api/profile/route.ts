import { handleSheetRequest } from "@/sheets/http";
export const runtime = "nodejs";
export async function POST(request: Request) { return handleSheetRequest(request, { kind: "profile" }); }
