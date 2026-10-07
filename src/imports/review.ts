import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { getDatabase, type openDatabase } from "../db/client";
import { importBatches, importProfiles, importRows, transactionSources, transactions } from "../db/schema";
import { transactionInput } from "../ledger/input";
import { saveTransaction, validateNewTransaction } from "../ledger/service";
import { readSheet, requireSheetAccess, SheetError } from "../sheets/service";
import { mappingSchema, normalizeCsv } from "./csv";
import { previewImport } from "./service";

type Connection = ReturnType<typeof openDatabase>;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
import { sourceSchema, originalSchema, matchingSchema, resultSchema } from "./presentation";
const versionSchema = z.number().int().positive();
const rowUpdateSchema = z.object({ version: versionSchema, rowId: z.uuid(), decision: z.enum(["pending", "keep", "skip", "exclude"]).optional(),
  proposed: transactionInput.optional(), kindReviewed: z.boolean().optional(), correction: z.record(z.string(), z.string().max(10000)).optional() }).strict();
const profileInput = z.object({ id: z.uuid().optional(), version: versionSchema.optional(), accountId: z.uuid(), mapping: mappingSchema }).strict();

function activeContext(userId: string, sheetId: string, accountId: string, connection: Connection) {
  const sheet = readSheet(userId, sheetId, connection);
  if (!sheet.accounts.some((a) => a.id === accountId && !a.isArchived)) throw new SheetError("Choose an active financial account from this sheet.", 400);
  return sheet;
}
function profileRecord(record: typeof importProfiles.$inferSelect) { return { ...record, mapping: mappingSchema.parse(JSON.parse(record.mapping)) }; }
export function listImportProfiles(userId: string, sheetId: string, accountId: string, connection: Connection = getDatabase()) {
  requireSheetAccess({ userId, sheetId }, connection); z.uuid().parse(accountId);
  return connection.db.select().from(importProfiles).where(and(eq(importProfiles.sheetId, sheetId), eq(importProfiles.accountId, accountId))).all().map(profileRecord);
}
export function saveImportProfile(userId: string, sheetId: string, input: unknown, connection: Connection = getDatabase()) {
  const parsed = profileInput.parse(input);
  return connection.sqlite.transaction(() => {
    activeContext(userId, sheetId, parsed.accountId, connection);
    const nameKey = parsed.mapping.profile.normalize("NFKC").toLocaleLowerCase("en-US");
    const existing = connection.db.select().from(importProfiles).where(and(eq(importProfiles.sheetId, sheetId), eq(importProfiles.accountId, parsed.accountId), parsed.id ? eq(importProfiles.id, parsed.id) : eq(importProfiles.nameKey, nameKey))).get();
    if (parsed.id && !existing) throw new SheetError("This source profile is unavailable.", 404);
    if (existing && parsed.version !== existing.version) throw new SheetError("Someone changed this source profile. Reload its mapping.", 409);
    const collision = connection.db.select().from(importProfiles).where(and(eq(importProfiles.accountId, parsed.accountId), eq(importProfiles.nameKey, nameKey))).get();
    if (collision && collision.id !== existing?.id) throw new SheetError("Use a different source profile name.", 400);
    const id = existing?.id ?? randomUUID();
    const values = { name: parsed.mapping.profile, nameKey, mapping: JSON.stringify(parsed.mapping) };
    if (existing) connection.db.update(importProfiles).set({ ...values, version: existing.version + 1 }).where(eq(importProfiles.id, id)).run();
    else connection.db.insert(importProfiles).values({ id, sheetId, accountId: parsed.accountId, ...values }).run();
    return profileRecord({ id, sheetId, accountId: parsed.accountId, ...values, version: (existing?.version ?? 0) + 1 });
  }).immediate();
}
function batchFor(userId: string, sheetId: string, id: string, connection: Connection) {
  requireSheetAccess({ userId, sheetId }, connection);
  const batch = connection.db.select().from(importBatches).where(and(eq(importBatches.sheetId, sheetId), eq(importBatches.id, z.uuid().parse(id)))).get();
  if (!batch) throw new SheetError("This import is unavailable. Choose another file.", 404);
  return batch;
}
function storedRows(batchId: string, connection: Connection) {
  return connection.db.select().from(importRows).where(eq(importRows.batchId, batchId)).orderBy(asc(importRows.sourceRow)).all();
}
function sourceOf(row: typeof importRows.$inferSelect) { return row.source ? sourceSchema.parse(JSON.parse(row.source)) : null; }
function tuple(source: Pick<typeof transactions.$inferSelect, "date" | "payee" | "amount">) { return hash([source.date, source.payee, source.amount]); }
function matchingContext(userId: string, batch: typeof importBatches.$inferSelect, connection: Connection) {
  const sheet = readSheet(userId, batch.sheetId, connection);
  const allRecords = connection.db.select().from(transactions).where(eq(transactions.sheetId, batch.sheetId)).orderBy(asc(transactions.id)).all();
  const allSources = connection.db.select().from(transactionSources).where(eq(transactionSources.sheetId, batch.sheetId)).orderBy(asc(transactionSources.id)).all();
  const sources = allSources.filter((s) => s.accountId === batch.accountId && s.sourceProfile === batch.profileId);
  const sourceTransactions = new Set(sources.map((s) => s.transactionId));
  const records = allRecords.filter((t) => t.accountId === batch.accountId || sourceTransactions.has(t.id));
  const importedIds = new Set(allSources.map((s) => s.transactionId));
  const manual = records.filter((t) => t.accountId === batch.accountId && !importedIds.has(t.id));
  return { records, sources, manual, snapshot: hash({ records, sources, manual, accounts: sheet.accounts, categories: sheet.categories, buckets: sheet.buckets }) };
}
function matchRows(rows: ReturnType<typeof storedRows>, current: ReturnType<typeof matchingContext>) {
  const occurrences = new Map<string, number>(); const earlier = new Map<string, typeof importRows.$inferSelect>();
  return rows.map((row) => {
    const source = sourceOf(row);
    if (!source) return matchingSchema.parse({ status: "new", reason: "Correct or exclude this invalid row.", candidates: [], earlierRow: null, occurrence: 0, existingOccurrences: 0 });
    const fingerprint = tuple(source); const occurrence = (occurrences.get(fingerprint) ?? 0) + 1; occurrences.set(fingerprint, occurrence);
    const stable = source.sourceId === null ? [] : current.sources.filter((s) => s.sourceId === source.sourceId);
    const exact = stable.filter((s) => tuple(s) === fingerprint);
    const overlap = current.sources.filter((s) => tuple(s) === fingerprint);
    const manuals = current.manual.filter((t) => tuple(t) === fingerprint);
    const candidates = [...(source.sourceId !== null && stable.length ? stable : overlap).flatMap((s) => {
      const record = current.records.find((t) => t.id === s.transactionId);
      return record ? [{ ...record, deleted: record.deletedAt !== null, source: sourceSchema.parse(s) }] : [];
    }), ...manuals.map((t) => ({ ...t, deleted: t.deletedAt !== null, source: null }))];
    const prior = source.sourceId === null ? undefined : earlier.get(source.sourceId);
    const priorSource = prior ? sourceOf(prior) : null;
    const definite = exact.length > 0 || (priorSource !== null && tuple(priorSource) === fingerprint);
    const possible = stable.length > 0 || candidates.length > 0 || prior !== undefined;
    if (source.sourceId !== null && row.decision !== "exclude" && row.decision !== "skip") earlier.set(source.sourceId, row);
    return matchingSchema.parse({ status: definite ? "definite" : possible ? "possible" : "new",
      reason: definite ? "This source ID has already been imported with the same original fields." : stable.length || prior ? "This source ID has different original fields. Choose keep or skip." : possible ? "Matching date, payee, and amount may be another purchase. Choose keep or skip." : "No matching transaction found.",
      candidates: candidates.slice(0, 20), candidateCount: candidates.length, earlierRow: prior?.sourceRow ?? null, occurrence, existingOccurrences: overlap.length + manuals.length });
  });
}
function repeatOf(batch: typeof importBatches.$inferSelect, connection: Connection) {
  return connection.db.select().from(importBatches).where(and(ne(importBatches.id, batch.id), eq(importBatches.sheetId, batch.sheetId), eq(importBatches.accountId, batch.accountId), eq(importBatches.profileId, batch.profileId), eq(importBatches.fileHash, batch.fileHash), eq(importBatches.mappingHash, batch.mappingHash), eq(importBatches.state, "committed"))).orderBy(asc(importBatches.committedAt)).get();
}
export function readImportReview(userId: string, sheetId: string, id: string, connection: Connection = getDatabase()) {
  const batch = batchFor(userId, sheetId, id, connection);
  const rows = storedRows(id, connection).map((row) => ({ ...row, original: originalSchema.parse(JSON.parse(row.original)), source: sourceOf(row), proposed: row.proposed ? transactionInput.parse(JSON.parse(row.proposed)) : null, errors: z.array(z.string()).parse(JSON.parse(row.errors)), matching: matchingSchema.parse(JSON.parse(row.matching)) }));
  const result = batch.result ? resultSchema.parse(JSON.parse(batch.result)) : null;
  const repeated = batch.state === "review" ? repeatOf(batch, connection) : null;
  const repeatedFile = result?.repeatedFile ?? Boolean(repeated);
  const counts = { new: 0, definite: 0, possible: 0, invalid: 0, excluded: 0, added: 0, skipped: 0 };
  for (const row of rows) {
    if (row.decision === "exclude") counts.excluded++;
    else if (repeatedFile) { counts.definite++; counts.skipped++; }
    else if (!row.source) counts.invalid++;
    else { counts[row.matching.status]++; if (row.matching.status === "definite" || row.decision === "skip") counts.skipped++; else if (row.decision === "keep") counts.added++; }
  }
  if (result) { counts.added = result.added; counts.skipped = result.skipped; counts.excluded = result.excluded; }
  const ready = batch.state === "committed" || repeatedFile || rows.every((row) => row.decision === "exclude" || (row.source && (row.matching.status === "definite" || row.decision === "skip" || (row.decision === "keep" && row.kindReviewed))));
  return { id: batch.id, sheetId, accountId: batch.accountId, profileId: batch.profileId, mapping: mappingSchema.parse(JSON.parse(batch.mapping)), state: batch.state, version: batch.version, rows, counts, ready,
    repeatedFile, result };
}
export function createImportReview(userId: string, sheetId: string, accountId: string, bytes: Uint8Array, input: unknown, connection: Connection = getDatabase(), profileId?: string) {
  const preview = previewImport(userId, sheetId, accountId, bytes, input, connection);
  return connection.sqlite.transaction(() => {
    activeContext(userId, sheetId, accountId, connection);
    const nameKey = preview.mapping.profile.normalize("NFKC").toLocaleLowerCase("en-US");
    let profile = connection.db.select().from(importProfiles).where(and(eq(importProfiles.sheetId, sheetId), eq(importProfiles.accountId, accountId), profileId ? eq(importProfiles.id, z.uuid().parse(profileId)) : eq(importProfiles.nameKey, nameKey))).get();
    if (profileId && !profile) throw new SheetError("Choose a source profile from this account.", 400);
    if (!profile) {
      const saved = saveImportProfile(userId, sheetId, { accountId, mapping: preview.mapping }, connection);
      profile = { ...saved, mapping: JSON.stringify(saved.mapping) };
    }
    const id = randomUUID();
    const batch = { id, sheetId, accountId, profileId: profile.id, mapping: JSON.stringify(preview.mapping), fileHash: preview.normalizedFileHash,
      mappingHash: hash({ ...preview.mapping, profile: profile.id }), snapshot: "", creatorId: userId, createdAt: new Date(), state: "review" as const, version: 1, committedAt: null, result: null };
    batch.snapshot = matchingContext(userId, batch, connection).snapshot;
    connection.db.insert(importBatches).values(batch).run();
    const selectedColumns = [preview.mapping.date, preview.mapping.payee, ...(preview.mapping.sourceId ? [preview.mapping.sourceId] : []), ...(preview.mapping.money.mode === "signed" ? [preview.mapping.money.amount] : [preview.mapping.money.debit, preview.mapping.money.credit])];
    for (const row of preview.rows) {
      const selected = Object.fromEntries(selectedColumns.map((name) => [name, row.fields[preview.headers.indexOf(name)] ?? ""]));
      connection.db.insert(importRows).values({ id: randomUUID(), sheetId, batchId: id, sourceRow: row.sourceRow,
        original: JSON.stringify(row.status === "valid" ? { status: "valid", source: row.source } : { status: "invalid", selected, errors: row.errors }),
        source: row.status === "valid" ? JSON.stringify(row.source) : null, proposed: row.status === "valid" ? JSON.stringify(row.proposed) : null,
        errors: JSON.stringify(row.status === "valid" ? [] : row.errors), matching: JSON.stringify({ status: "new", reason: "", candidates: [], earlierRow: null, occurrence: 0, existingOccurrences: 0 }) }).run();
    }
    const rows = storedRows(id, connection); const matching = matchRows(rows, matchingContext(userId, batch, connection));
    rows.forEach((row, index) => connection.db.update(importRows).set({ matching: JSON.stringify(matching[index]), decision: matching[index]?.status === "new" && row.source ? "keep" : "pending" }).where(eq(importRows.id, row.id)).run());
    return readImportReview(userId, sheetId, id, connection);
  }).immediate();
}
export function updateImportReview(userId: string, sheetId: string, id: string, input: unknown, connection: Connection = getDatabase()) {
  const parsed = rowUpdateSchema.parse(input);
  return connection.sqlite.transaction(() => {
    const batch = batchFor(userId, sheetId, id, connection);
    if (batch.state === "committed") throw new SheetError("This import has already finished.", 409);
    if (parsed.version !== batch.version) throw new SheetError("Someone changed this review. Reload it before saving.", 409);
    const sheet = activeContext(userId, sheetId, batch.accountId, connection);
    const row = storedRows(id, connection).find((r) => r.id === parsed.rowId);
    if (!row) throw new SheetError("Choose a row from this import.", 400);
    let source = row.source; let proposed = row.proposed; let errors = row.errors;
    if (parsed.correction) {
      if (source) throw new SheetError("Original source identity cannot be edited. Edit the proposed transaction instead.", 400);
      const original = originalSchema.parse(JSON.parse(row.original));
      if (original.status !== "invalid") throw new SheetError("This row does not need correction.", 400);
      if (Object.keys(parsed.correction).some((name) => !(name in original.selected))) throw new SheetError("Correct only the mapped source fields.", 400);
      const selected = { ...original.selected, ...parsed.correction };
      const category = sheet.categories.find((c) => c.isProtected); const bucket = sheet.buckets.find((b) => b.isProtected);
      if (!category || !bucket) throw new Error("Missing sheet defaults.");
      const mapping = mappingSchema.parse(JSON.parse(batch.mapping));
      const corrected = normalizeCsv({ headers: Object.keys(selected), records: [Object.values(selected)] }, mapping, sheet.currency, { accountId: batch.accountId, categoryId: category.id, bucketId: bucket.id })[0];
      if (!corrected || corrected.status !== "valid") throw new SheetError(corrected?.errors.join(" ") ?? "Correct this row.", 400);
      source = JSON.stringify(corrected.source); proposed = JSON.stringify(corrected.proposed); errors = "[]";
    }
    if (parsed.proposed) {
      if (!source) throw new SheetError("Correct or exclude this invalid row first.", 400);
      if (parsed.proposed.accountId !== batch.accountId) throw new SheetError("Use this import's financial account.", 400);
      proposed = JSON.stringify(validateNewTransaction(userId, sheetId, parsed.proposed, connection).parsed);
    }
    const kindReviewed = parsed.kindReviewed ?? (parsed.proposed ? true : row.kindReviewed);
    connection.db.update(importRows).set({ source, proposed, errors, kindReviewed, decision: parsed.decision ?? row.decision }).where(eq(importRows.id, row.id)).run();
    const rows = storedRows(id, connection); const matches = matchRows(rows, matchingContext(userId, batch, connection));
    rows.forEach((item, index) => {
      const next = matches[index]; const changed = JSON.stringify(next) !== item.matching;
      const decision = changed && next?.status === "possible" && item.decision !== "exclude" ? "pending" : item.decision;
      connection.db.update(importRows).set({ matching: JSON.stringify(next), decision }).where(eq(importRows.id, item.id)).run();
    });
    connection.db.update(importBatches).set({ version: batch.version + 1 }).where(eq(importBatches.id, id)).run();
    return readImportReview(userId, sheetId, id, connection);
  }).immediate();
}
export function confirmImportReview(userId: string, sheetId: string, id: string, input: unknown, connection: Connection = getDatabase()) {
  const { version } = z.object({ version: versionSchema }).strict().parse(input);
  return connection.sqlite.transaction(() => {
    const batch = batchFor(userId, sheetId, id, connection);
    if (batch.state === "committed") return { kind: "committed" as const, review: readImportReview(userId, sheetId, id, connection), changedRowIds: [] };
    if (version !== batch.version) throw new SheetError("Someone changed this review. Reload it before confirming.", 409);
    const rows = storedRows(id, connection); const repeated = repeatOf(batch, connection);
    if (repeated) {
      const previous = resultSchema.parse(JSON.parse(repeated.result ?? "null"));
      const excluded = rows.filter((row) => row.decision === "exclude").length;
      const result = { added: 0, skipped: rows.length - excluded, excluded, transactionIds: [], repeatedFile: true, viewBatchId: previous.viewBatchId };
      connection.db.update(importBatches).set({ state: "committed", committedAt: new Date(), result: JSON.stringify(result), version: batch.version + 1 }).where(eq(importBatches.id, id)).run();
      return { kind: "committed" as const, review: readImportReview(userId, sheetId, id, connection), changedRowIds: [] };
    }
    const current = matchingContext(userId, batch, connection); const matching = matchRows(rows, current);
    if (current.snapshot !== batch.snapshot) {
      const changedRowIds: string[] = [];
      const changedDecisions: { rowId: string; previousDecision: typeof importRows.$inferSelect["decision"]; decision: typeof importRows.$inferSelect["decision"] }[] = [];
      rows.forEach((row, index) => {
        const next = matching[index]; const changed = JSON.stringify(next) !== row.matching;
        if (changed) changedRowIds.push(row.id);
        const decision = changed && next?.status === "possible" && row.decision !== "exclude" ? "pending" : row.decision;
        if (decision !== row.decision) changedDecisions.push({ rowId: row.id, previousDecision: row.decision, decision });
        connection.db.update(importRows).set({ matching: JSON.stringify(next), decision }).where(eq(importRows.id, row.id)).run();
      });
      // Organization changes can affect proposals even when their duplicate candidates are unchanged.
      if (!changedRowIds.length) changedRowIds.push(...rows.map((r) => r.id));
      connection.db.update(importBatches).set({ snapshot: current.snapshot, version: batch.version + 1 }).where(eq(importBatches.id, id)).run();
      return { kind: "stale" as const, review: readImportReview(userId, sheetId, id, connection), changedRowIds, changedDecisions };
    }
    activeContext(userId, sheetId, batch.accountId, connection);
    const result = { added: 0, skipped: 0, excluded: 0, transactionIds: [] as string[], repeatedFile: false, viewBatchId: id };
    rows.forEach((row, index) => {
      if (row.decision === "exclude") { result.excluded++; return; }
      const source = sourceOf(row); const match = matching[index];
      if (!source || !row.proposed) throw new SheetError("Correct or exclude every invalid row before importing.", 400);
      if (match?.status === "definite" || row.decision === "skip") { result.skipped++; return; }
      if (row.decision !== "keep" || !row.kindReviewed) throw new SheetError("Review each transaction kind and choose keep or skip for possible duplicates.", 400);
      const proposal = transactionInput.parse(JSON.parse(row.proposed));
      if (proposal.accountId !== batch.accountId) throw new SheetError("Use this import's financial account.", 400);
      const transaction = saveTransaction(userId, sheetId, proposal, undefined, connection);
      connection.db.insert(transactionSources).values({ id: randomUUID(), sheetId, transactionId: transaction.id, accountId: batch.accountId, sourceProfile: batch.profileId,
        ...source, fingerprint: tuple(source), createdAt: new Date() }).run();
      connection.db.update(importRows).set({ transactionId: transaction.id }).where(eq(importRows.id, row.id)).run();
      result.added++; result.transactionIds.push(transaction.id);
    });
    connection.db.update(importBatches).set({ state: "committed", committedAt: new Date(), result: JSON.stringify(result), version: batch.version + 1 }).where(eq(importBatches.id, id)).run();
    return { kind: "committed" as const, review: readImportReview(userId, sheetId, id, connection), changedRowIds: [] };
  }).immediate();
}
