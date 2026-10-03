import { sql } from "drizzle-orm";

import { getDatabase } from "@/db/client";

export const dynamic = "force-dynamic";

export function GET() {
  getDatabase().db.run(sql`select 1`);
  return Response.json({ status: "ok" });
}
