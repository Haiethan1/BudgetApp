import { handleSharingRequest } from "@/sharing/http";
export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ inviteId: string }> }) { return handleSharingRequest(request, { kind: "respond", inviteId: (await context.params).inviteId }); }
