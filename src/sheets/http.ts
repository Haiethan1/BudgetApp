import { z } from "zod";
import { getAuth, type createAuth } from "../auth/server";
import { readAuthConfig } from "../auth/config";
import { getDatabase, type openDatabase } from "../db/client";
import { createSheet, listSheets, readSheet, requireSheetAccess, SheetError } from "./service";
import { mutateSettings, updateDisplayName } from "./settings";

export const selectionCookie = "homebooks-sheet";
type Operation = { kind: "list" } | { kind: "create" } | { kind: "read"; sheetId: string } | { kind: "select"; sheetId: string } | { kind: "settings"; sheetId: string } | { kind: "profile" };
type Dependencies = { auth: ReturnType<typeof createAuth>; connection: ReturnType<typeof openDatabase>; origin: string };
function selectedCookie(id: string, origin: string) {
  return `${selectionCookie}=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${origin.startsWith("https:") ? "; Secure" : ""}`;
}

export async function handleSheetRequest(request: Request, operation: Operation, dependencies?: Dependencies) {
  const { auth, connection, origin } = dependencies ?? { auth: getAuth(), connection: getDatabase(), origin: readAuthConfig().origin };
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return Response.json({ message: "Your session expired. Sign in again." }, { status: 401 });
  if (["create", "select", "settings", "profile"].includes(operation.kind) && request.headers.get("origin") !== origin) {
    return Response.json({ message: "Open this action from your Homebooks instance." }, { status: 403 });
  }
  try {
    switch (operation.kind) {
      case "settings":
      case "profile": {
        if (!request.headers.get("content-type")?.startsWith("application/json")) return Response.json({ message: "Invalid request." }, { status: 415 });
        const body = await request.text();
        if (body.length > 4096) return Response.json({ message: "Invalid request." }, { status: 413 });
        const input: unknown = JSON.parse(body);
        if (operation.kind === "settings") mutateSettings(session.user.id, operation.sheetId, input, connection);
        else updateDisplayName(session.user.id, input, connection);
        return Response.json({ message: "Changes saved." });
      }
      case "list": return Response.json({ sheets: listSheets(session.user.id, connection) });
      case "read": return Response.json(readSheet(session.user.id, operation.sheetId, connection));
      case "create": {
        if (!request.headers.get("content-type")?.startsWith("application/json")) return Response.json({ message: "Invalid request." }, { status: 415 });
        const text = await request.text();
        if (text.length > 4096) return Response.json({ message: "Invalid request." }, { status: 413 });
        const created = createSheet(session.user.id, JSON.parse(text), connection);
        return Response.json({ id: created.sheet.id }, { status: 201, headers: { "Set-Cookie": selectedCookie(created.sheet.id, origin) } });
      }
      case "select": {
        requireSheetAccess({ userId: session.user.id, sheetId: operation.sheetId }, connection);
        return Response.json({ id: operation.sheetId }, { headers: { "Set-Cookie":
          selectedCookie(operation.sheetId, origin) } });
      }
    }
  } catch (error) {
    if (error instanceof SheetError) return Response.json({ message: error.message }, { status: error.status });
    if (error instanceof z.ZodError) return Response.json({ message: "Check the highlighted fields.", fields: z.flattenError(error).fieldErrors }, { status: 400 });
    if (error instanceof SyntaxError) return Response.json({ message: "Invalid request." }, { status: 400 });
    return Response.json({ message: "Could not save the sheet. Try again." }, { status: 500 });
  }
}
