import { handleImportReview } from "../../../../../../imports/http";
export async function GET(request: Request, context: { params: Promise<{ sheetId: string; batchId: string }> }) {
  return handleImportReview(request, { kind: "read", ...(await context.params) });
}
export async function PATCH(request: Request, context: { params: Promise<{ sheetId: string; batchId: string }> }) {
  return handleImportReview(request, { kind: "update", ...(await context.params) });
}
