import { z } from "zod";
import { getAuth, type createAuth } from "../auth/server";
import { readAuthConfig } from "../auth/config";
import { getDatabase, type openDatabase } from "../db/client";
import { SheetError } from "../sheets/service";
import { mutateBudget, readBudgets } from "./service";

type Dependencies = { auth: ReturnType<typeof createAuth>; connection: ReturnType<typeof openDatabase>; origin: string };
export async function handleBudgetRequest(request: Request, sheetId: string, dependencies?: Dependencies) {
  const { auth, connection, origin } = dependencies ?? { auth: getAuth(), connection: getDatabase(), origin: readAuthConfig().origin };
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return Response.json({ message: "Your session expired. Sign in again." }, { status: 401 });
  try {
    if (request.method === "GET") return Response.json(readBudgets(session.user.id, sheetId, new URL(request.url).searchParams.get("month") ?? "", connection));
    if (request.headers.get("origin") !== origin) return Response.json({ message: "Open this action from your Homebooks instance." }, { status: 403 });
    if (!request.headers.get("content-type")?.startsWith("application/json")) return Response.json({ message: "Invalid request." }, { status: 415 });
    const body = await request.text();
    if (body.length > 4096) return Response.json({ message: "This request is too large." }, { status: 413 });
    return Response.json(mutateBudget(session.user.id, sheetId, JSON.parse(body), connection));
  } catch (error) {
    if (error instanceof SheetError) return Response.json({ message: error.message }, { status: error.status });
    if (error instanceof z.ZodError) return Response.json({ message: error.issues[0]?.message ?? "Check the monthly limit." }, { status: 400 });
    if (error instanceof SyntaxError) return Response.json({ message: "Invalid request." }, { status: 400 });
    return Response.json({ message: "Could not load or save monthly limits. Try again." }, { status: 500 });
  }
}
