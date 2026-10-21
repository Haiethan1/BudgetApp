import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "@/auth/server";
import { accessibleSelection, readSheet } from "./service";
import { selectionCookie } from "./http";

export const currentSheet = cache(async () => {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in?expired=1");
  const selection = accessibleSelection(session.user.id, (await cookies()).get(selectionCookie)?.value);
  if (!selection) redirect("/");
  return { session, setupUserId: session.user.id, sheet: readSheet(session.user.id, selection.id) };
});
