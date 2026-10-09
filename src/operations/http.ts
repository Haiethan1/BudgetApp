import { getAuth, type createAuth } from "../auth/server";
import { getDatabase, type openDatabase } from "../db/client";
import { isInstanceAdmin } from "./admin";
import { readBackupStatus } from "./status";

export async function handleBackupStatus(request: Request, dependencies?: {
  auth: ReturnType<typeof createAuth>; connection: ReturnType<typeof openDatabase>; filename: string;
}) {
  const auth = dependencies?.auth ?? getAuth();
  const connection = dependencies?.connection ?? getDatabase();
  const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return json({ message: "Your session expired. Sign in again." }, 401);
  if (!isInstanceAdmin(session.user.id, connection)) return json({ message: "Instance administrator access is required." }, 403);
  if (request.method !== "GET") return json({ message: "Invalid request." }, 405);
  return json(readBackupStatus(dependencies?.filename));
}
