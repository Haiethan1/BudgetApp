import { createHash } from "node:crypto";
import { z } from "zod";
import { getDatabase, type openDatabase } from "../db/client";
import { readSheet, SheetError } from "../sheets/service";
import { mappingSchema, normalizeCsv, parseCsv, importLimits } from "./csv";

type Connection = ReturnType<typeof openDatabase>;
function context(userId: string, sheetId: string, accountId: string, connection: Connection) {
  const sheet = readSheet(userId, sheetId, connection);
  const account = sheet.accounts.find((item) => item.id === z.uuid().parse(accountId));
  if (!account || account.isArchived) throw new SheetError("Choose an active financial account from this sheet.", 400);
  return { sheet, account };
}
export function inspectImport(userId: string, sheetId: string, accountId: string, bytes: Uint8Array, connection: Connection = getDatabase()) {
  context(userId, sheetId, accountId, connection);
  const csv = parseCsv(bytes);
  return { headers: csv.headers, samples: csv.records.slice(0, 5), rowCount: csv.records.length, limits: importLimits };
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
    headers: csv.headers, rows, validCount: rows.filter((row) => row.status === "valid").length, invalidCount: rows.filter((row) => row.status === "invalid").length,
    limits: importLimits, notice: "Review transaction kinds before importing. Card payments and transfers do not count as spending. Invalid rows must be corrected or explicitly excluded. This preview has not imported any transactions." };
}
