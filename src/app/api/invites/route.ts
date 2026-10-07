import { handleSharingRequest } from "@/sharing/http";
export const runtime = "nodejs";
export async function GET(request: Request) { return handleSharingRequest(request, { kind: "incoming" }); }
