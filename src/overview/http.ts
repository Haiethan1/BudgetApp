import { z } from "zod";
import { getAuth, type createAuth } from "../auth/server";
import { getDatabase, type openDatabase } from "../db/client";
import { SheetError } from "../sheets/service";
import { readOverview } from "./service";
type Dependencies = { auth: ReturnType<typeof createAuth>; connection: ReturnType<typeof openDatabase> };
export async function handleOverviewRequest(request: Request, sheetId: string, dependencies?: Dependencies) {
  const { auth, connection } = dependencies ?? { auth: getAuth(), connection: getDatabase() };
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return Response.json({ message: "Your session expired. Sign in again." }, { status: 401 });
  try { return Response.json(readOverview(session.user.id, sheetId, new URL(request.url).searchParams.get("month") ?? "", connection)); }
  catch (error) {
    if (error instanceof SheetError) return Response.json({ message: error.message }, { status: error.status });
    if (error instanceof z.ZodError) return Response.json({ message: "Choose a valid month." }, { status: 400 });
    return Response.json({ message: "Could not load spending. Try again." }, { status: 500 });
  }
}
