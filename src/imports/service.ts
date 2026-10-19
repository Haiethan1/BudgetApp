import { createHash } from "node:crypto";
import { z } from "zod";
import { getDatabase, type openDatabase } from "../db/client";
import { readSheet, SheetError } from "../sheets/service";
import { mappingSchema, normalizeCsv, parseCsv, csvDataRows, importLimits } from "./csv";

type Connection = ReturnType<typeof openDatabase>;
function context(userId: string, sheetId: string, accountId: string, connection: Connection) {
  const sheet = readSheet(userId, sheetId, connection);
  const account = sheet.accounts.find((item) => item.id === z.uuid().parse(accountId));
  if (!account || account.isArchived) throw new SheetError("Choose an active transaction account from this sheet.", 400);
  return { sheet, account };
}
export function inspectImport(userId: string, sheetId: string, accountId: string, bytes: Uint8Array, connection: Connection = getDatabase()) {
  context(userId, sheetId, accountId, connection);
  const csv = parseCsv(bytes);
  const rows = csvDataRows(csv);
  return { headers: csv.headers, samples: rows.slice(0, 5), rowCount: rows.length, skippedBlankCount: csv.records.length - rows.length, limits: importLimits };
}
export function previewImport(userId: string, sheetId: string, accountId: string, bytes: Uint8Array, input: unknown, connection: Connection = getDatabase()) {
  const { sheet, account } = context(userId, sheetId, accountId, connection);
  const mapping = mappingSchema.parse(input); const csv = parseCsv(bytes);
  const category = sheet.categories.find((item) => item.isProtected);
  const bucket = sheet.buckets.find((item) => item.isProtected);
  if (!category || !bucket) throw new Error("Missing protected sheet defaults.");
  const rows = normalizeCsv(csv, mapping, sheet.currency, { accountId, categoryId: category.id, bucketId: bucket.id });
  const normalizedFileHash = createHash("sha256").update(JSON.stringify(csv)).digest("hex");
  // This digest binds preview inputs for later persisted review. It is not commit authorization.
  const previewKey = createHash("sha256").update(JSON.stringify({ userId, sheetId, accountId, currency: sheet.currency, mapping, normalizedFileHash })).digest("hex");
  return { version: 1, previewKey, normalizedFileHash, mapping, sheetId, accountId, accountName: account.name, currency: sheet.currency,
    headers: csv.headers, rows, skippedBlankCount: csv.records.length - rows.length, validCount: rows.filter((row) => row.status === "valid").length, invalidCount: rows.filter((row) => row.status === "invalid").length,
    limits: importLimits, notice: "Individual row review is optional for valid rows. Card payments are transfers and do not count as spending. Correct or skip invalid rows and resolve possible duplicates before importing. This preview has not imported any transactions." };
}
