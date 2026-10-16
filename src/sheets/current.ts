import { cache } from "react";
import { createHash } from "node:crypto";
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
  const setupSessionKey = createHash("sha256").update(JSON.stringify([session.user.id, session.session.id])).digest("hex");
  return { session, setupSessionKey, sheet: readSheet(session.user.id, selection.id) };
});
