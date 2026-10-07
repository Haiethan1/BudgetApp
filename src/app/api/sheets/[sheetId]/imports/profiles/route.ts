import { handleImportReview } from "../../../../../../imports/http";
export async function GET(request: Request, context: { params: Promise<{ sheetId: string }> }) {
  return handleImportReview(request, { kind: "profiles", ...(await context.params) });
}
export async function POST(request: Request, context: { params: Promise<{ sheetId: string }> }) {
  return handleImportReview(request, { kind: "save-profile", ...(await context.params) });
}
