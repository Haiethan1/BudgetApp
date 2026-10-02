import { readAuthConfig } from "@/auth/config";
import { handleSetup } from "@/auth/setup";
export const runtime = "nodejs";
export async function POST(request: Request) { return handleSetup(request, readAuthConfig()); }
