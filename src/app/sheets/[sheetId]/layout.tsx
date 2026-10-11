import type { ReactNode } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getAuth } from "@/auth/server";
import { readSheet, SheetError } from "@/sheets/service";
import { SheetUnavailable } from "@/components/sheet-unavailable";
export default async function SheetLayout({ params, children }: { params: Promise<{ sheetId: string }>; children: ReactNode }) {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in?expired=1");
  try { readSheet(session.user.id, (await params).sheetId); }
  catch (error) {
    if (!(error instanceof SheetError) && !(error instanceof z.ZodError)) throw error;
    return <SheetUnavailable />;
  }
  return children;
}
