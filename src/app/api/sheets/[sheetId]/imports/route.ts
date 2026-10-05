import { handleImportPreview } from "../../../../../imports/http";
export async function POST(request: Request, context: { params: Promise<{ sheetId: string }> }) {
  return handleImportPreview(request, (await context.params).sheetId, undefined, true);
}
