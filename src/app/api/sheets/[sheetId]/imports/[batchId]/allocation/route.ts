import { handleImportReview } from "../../../../../../../imports/http";
export async function PATCH(request: Request, context: { params: Promise<{ sheetId: string; batchId: string }> }) {
  return handleImportReview(request, { kind: "allocation", ...(await context.params) });
}
