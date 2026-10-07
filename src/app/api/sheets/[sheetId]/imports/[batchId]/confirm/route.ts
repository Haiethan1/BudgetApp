import { handleImportReview } from "../../../../../../../imports/http";
export async function POST(request: Request, context: { params: Promise<{ sheetId: string; batchId: string }> }) {
  return handleImportReview(request, { kind: "confirm", ...(await context.params) });
}
