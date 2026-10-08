import { z } from "zod";
import { getAuth, type createAuth } from "../auth/server";
import { readAuthConfig } from "../auth/config";
import { getDatabase, type openDatabase } from "../db/client";
import { SheetError } from "../sheets/service";
import { incomingInvites, mutateSharing, readSharing, respondToInvite, searchInvitees } from "./service";

function json(body: unknown, init?: ResponseInit) { return Response.json(body, { ...init, headers: { "Cache-Control": "no-store" } }); }

type Dependencies = { auth: ReturnType<typeof createAuth>; connection: ReturnType<typeof openDatabase>; origin: string };
type Operation = { kind: "incoming" } | { kind: "respond"; inviteId: string } | { kind: "sharing"; sheetId: string } | { kind: "search"; sheetId: string };
export async function handleSharingRequest(request: Request, operation: Operation, dependencies?: Dependencies) {
  const { auth, connection, origin } = dependencies ?? { auth: getAuth(), connection: getDatabase(), origin: readAuthConfig().origin };
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return json({ message: "Your session expired. Sign in again." }, { status: 401 });
  try {
    if (request.method === "GET") {
      if (operation.kind === "incoming") return json({ invites: incomingInvites(session.user.id, connection) });
      if (operation.kind === "sharing") return json(readSharing(session.user.id, operation.sheetId, connection));
      if (operation.kind === "search") return json({ people: searchInvitees(session.user.id, operation.sheetId, new URL(request.url).searchParams.get("q"), connection) });
      return json({ message: "Invalid request." }, { status: 405 });
    }
    if (request.method !== "POST" || (operation.kind !== "sharing" && operation.kind !== "respond")) return json({ message: "Invalid request." }, { status: 405 });
    if (request.headers.get("origin") !== origin) return json({ message: "Open this action from your Homebooks instance." }, { status: 403 });
    if (!request.headers.get("content-type")?.startsWith("application/json")) return json({ message: "Invalid request." }, { status: 415 });
    const body = await request.text();
    if (body.length > 4096) return json({ message: "This request is too large." }, { status: 413 });
    const input: unknown = JSON.parse(body);
    return json(operation.kind === "sharing" ? mutateSharing(session.user.id, operation.sheetId, input, connection) : respondToInvite(session.user.id, operation.inviteId, input, connection));
  } catch (error) {
    if (error instanceof SheetError) return json({ message: error.message }, { status: error.status });
    if (error instanceof z.ZodError) return json({ message: error.issues[0]?.message ?? "Check the invitation." }, { status: 400 });
    if (error instanceof SyntaxError) return json({ message: "Invalid request." }, { status: 400 });
    return json({ message: "Could not load or save sharing. Try again." }, { status: 500 });
  }
}
