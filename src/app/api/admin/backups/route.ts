import { handleBackupStatus } from "@/operations/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) { return handleBackupStatus(request); }
