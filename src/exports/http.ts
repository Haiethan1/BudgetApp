import { z } from "zod";
import { getAuth, type createAuth } from "../auth/server";
import { readAuthConfig } from "../auth/config";
import { getDatabase, type openDatabase } from "../db/client";
import { SheetError } from "../sheets/service";
import { exportSheet } from "./service";

type Dependencies = { auth: ReturnType<typeof createAuth>; connection: ReturnType<typeof openDatabase>; origin: string };
export async function handleExportRequest(request: Request, sheetId: string, dependencies?: Dependencies) {
  const { auth, connection, origin } = dependencies ?? { auth: getAuth(), connection: getDatabase(), origin: readAuthConfig().origin };
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return Response.json({ message: "Your session expired. Sign in again." }, { status: 401 });
  if (request.headers.get("origin") !== origin) return Response.json({ message: "Open this action from your Homebooks instance." }, { status: 403 });
  if (!request.headers.get("content-type")?.startsWith("application/json")) return Response.json({ message: "Invalid request." }, { status: 415 });
  try {
    const body = await request.text();
    if (body.length > 1024) return Response.json({ message: "This request is too large." }, { status: 413 });
    const workbook = exportSheet(session.user.id, sheetId, JSON.parse(body), connection);
    return new Response(new Uint8Array(workbook), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": "attachment; filename=homebooks-export.xlsx", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) {
    if (error instanceof SheetError) return Response.json({ message: error.message }, { status: error.status });
    if (error instanceof z.ZodError) return Response.json({ message: error.issues[0]?.message ?? "Choose a valid export range." }, { status: 400 });
    if (error instanceof SyntaxError) return Response.json({ message: "Invalid request." }, { status: 400 });
    return Response.json({ message: "Could not export this sheet. Try again.", }, { status: 500 });
  }
}
