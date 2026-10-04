import { getAuth, type createAuth } from "../auth/server";
import { readAuthConfig } from "../auth/config";
import { getDatabase, type openDatabase } from "../db/client";
import { z } from "zod";
import { SheetError } from "../sheets/service";
import { calculateSpending, deleteTransaction, listTransactions, readTransaction, saveTransaction } from "./service";
type Operation = { kind: "list" | "create"; sheetId: string } | { kind: "read" | "edit" | "delete"; sheetId: string; id: string } | { kind: "spending"; sheetId: string; month: string };
type Dependencies = { auth: ReturnType<typeof createAuth>; connection: ReturnType<typeof openDatabase>; origin: string };
export async function handleLedgerRequest(request: Request, operation: Operation, dependencies?: Dependencies) {
  const { auth, connection, origin } = dependencies ?? { auth: getAuth(), connection: getDatabase(), origin: readAuthConfig().origin };
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return Response.json({ message: "Your session expired. Sign in again." }, { status: 401 });
  try {
    if (operation.kind === "create" || operation.kind === "edit" || operation.kind === "delete") {
      if (request.headers.get("origin") !== origin) return Response.json({ message: "Open this action from your Homebooks instance." }, { status: 403 });
      if (!request.headers.get("content-type")?.startsWith("application/json")) return Response.json({ message: "Invalid request." }, { status: 415 });
      const body = await request.text(); if (body.length > 65536) return Response.json({ message: "This transaction is too large." }, { status: 413 });
      const input: unknown = JSON.parse(body);
      if (operation.kind === "delete") { deleteTransaction(session.user.id, operation.sheetId, operation.id, input, connection); return Response.json({ message: "Transaction deleted." }); }
      return Response.json(saveTransaction(session.user.id, operation.sheetId, input, operation.kind === "edit" ? { id: operation.id } : undefined, connection), { status: operation.kind === "create" ? 201 : 200 });
    }
    if (operation.kind === "read") return Response.json(readTransaction(session.user.id, operation.sheetId, operation.id, connection));
    if (operation.kind === "spending") return Response.json(calculateSpending(session.user.id, operation.sheetId, operation.month, connection));
    return Response.json(listTransactions(session.user.id, operation.sheetId, Object.fromEntries(new URL(request.url).searchParams), connection));
  } catch (error) {
    if (error instanceof SheetError) return Response.json({ message: error.message }, { status: error.status });
    if (error instanceof z.ZodError) return Response.json({ message: "Check the transaction fields.", fields: z.flattenError(error).fieldErrors, issues: error.issues.map(({ path, message }) => ({ path, message })) }, { status: 400 });
    if (error instanceof SyntaxError) return Response.json({ message: "Invalid request." }, { status: 400 });
    return Response.json({ message: "Could not complete this transaction. Your entries are preserved. Try again." }, { status: 500 });
  }
}
