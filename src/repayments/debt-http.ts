import { z } from "zod";
import { getAuth, type createAuth } from "../auth/server";
import { readAuthConfig } from "../auth/config";
import { getDatabase, type openDatabase } from "../db/client";
import { SheetError } from "../sheets/service";
import { createDebt, editDebt, recordPayment, correctPayment, previewDebt, groupDebt, resolveDebt, listDebts, listDebtSources, readDebt } from "./debts";
type Dependencies = { auth: ReturnType<typeof createAuth>; connection: ReturnType<typeof openDatabase>; origin: string };
const envelope = z.discriminatedUnion("action", [z.object({ action: z.literal("create"), input: z.unknown() }), z.object({ action: z.literal("preview"), input: z.unknown() }), z.object({ action: z.literal("group"), input: z.unknown() }), ...["edit", "payment", "correction", "resolve"].map(action => z.object({ action: z.literal(action), id: z.uuid(), input: z.unknown() }))]);
export async function handleDebtRequest(request: Request, sheetId: string, dependencies?: Dependencies) {
  const { auth, connection, origin } = dependencies ?? { auth: getAuth(), connection: getDatabase(), origin: readAuthConfig().origin };
  const session = await auth.api.getSession({ headers: request.headers }); if (!session) return Response.json({ message: "Your session expired. Sign in again." }, { status: 401 });
  try {
    if (request.method === "GET") {
      const query = new URL(request.url).searchParams;
      return Response.json(query.get("sources") === "true" ? listDebtSources(session.user.id, sheetId, Object.fromEntries(query), connection) : query.get("id") ? readDebt(session.user.id, sheetId, query.get("id") ?? "", connection) : listDebts(session.user.id, sheetId, Object.fromEntries(query), connection));
    }
    if (request.headers.get("origin") !== origin) return Response.json({ message: "Open this action from your Homebooks instance." }, { status: 403 });
    if (!request.headers.get("content-type")?.startsWith("application/json")) return Response.json({ message: "Invalid request." }, { status: 415 });
    const body = await request.text(); if (body.length > 131072) return Response.json({ message: "Too many sources. Choose a smaller group." }, { status: 413 });
    const p = envelope.parse(JSON.parse(body)); const u = session.user.id;
    if (p.action === "create") return Response.json(createDebt(u, sheetId, p.input, connection));
    if (p.action === "preview") return Response.json(previewDebt(u, sheetId, p.input, connection));
    if (p.action === "group") return Response.json(groupDebt(u, sheetId, p.input, connection));
    if (!("id" in p)) throw new SheetError("Choose a debt.", 400);
    if (p.action === "edit") return Response.json(editDebt(u, sheetId, p.id, p.input, connection));
    if (p.action === "payment") return Response.json(recordPayment(u, sheetId, p.id, p.input, connection));
    if (p.action === "correction") return Response.json(correctPayment(u, sheetId, p.id, p.input, connection));
    return Response.json(resolveDebt(u, sheetId, p.id, p.input, connection));
  } catch (e) {
    if (e instanceof SheetError) return Response.json({ message: e.message }, { status: e.status });
    if (e instanceof z.ZodError) return Response.json({ message: "Check the debt fields. Enter a description, explicit debtor and recipient, exact amounts, and valid dates.", issues: e.issues }, { status: 400 });
    if (e instanceof SyntaxError) return Response.json({ message: "Invalid request." }, { status: 400 });
    return Response.json({ message: "Could not save this debt. Your entries are preserved. Retry with the same action before making another change." }, { status: 500 });
  }
}
