import { z } from "zod";
import { getAuth, type createAuth } from "../auth/server";
import { readAuthConfig } from "../auth/config";
import { getDatabase, type openDatabase } from "../db/client";
import { requireSheetAccess, SheetError } from "../sheets/service";
import { importLimits } from "./csv";
import { inspectImport, previewImport } from "./service";

type Dependencies = { auth: ReturnType<typeof createAuth>; connection: ReturnType<typeof openDatabase>; origin: string };
export async function handleImportPreview(request: Request, sheetId: string, dependencies?: Dependencies) {
  const { auth, connection, origin } = dependencies ?? { auth: getAuth(), connection: getDatabase(), origin: readAuthConfig().origin };
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return Response.json({ message: "Your session expired. Sign in again." }, { status: 401 });
  try {
    requireSheetAccess({ userId: session.user.id, sheetId }, connection);
    if (request.headers.get("origin") !== origin) return Response.json({ message: "Open this action from your Homebooks instance." }, { status: 403 });
    if (!request.headers.get("content-type")?.startsWith("multipart/form-data;")) return Response.json({ message: "Choose a CSV file using the upload form." }, { status: 415 });
    const reader = request.body?.getReader();
    if (!reader) throw new SheetError("Choose a CSV file.", 400);
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > importLimits.fileBytes + 65536) { await reader.cancel(); throw new SheetError("Choose a CSV no larger than 2 MiB.", 413); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const body = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    let form: FormData;
    try { form = await new Request(request.url, { method: "POST", headers: { "content-type": request.headers.get("content-type") ?? "" }, body }).formData(); }
    catch { throw new SheetError("The upload form is invalid. Choose the file again.", 400); }
    const file = form.get("file");
    if (!(file instanceof File)) throw new SheetError("Choose a CSV file.", 400);
    const accountId = z.uuid().parse(form.get("accountId"));
    const bytes = new Uint8Array(await file.arrayBuffer());
    const mapping = form.get("mapping");
    const result = mapping === null ? inspectImport(session.user.id, sheetId, accountId, bytes, connection) :
      previewImport(session.user.id, sheetId, accountId, bytes, JSON.parse(z.string().max(16384).parse(mapping)), connection);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof SheetError) return Response.json({ message: error.message }, { status: error.status });
    if (error instanceof z.ZodError || error instanceof SyntaxError) return Response.json({ message: "Check the account and mapping choices." }, { status: 400 });
    return Response.json({ message: "Could not preview this CSV. Try again." }, { status: 500 });
  }
}
