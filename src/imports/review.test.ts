import { sessionRowDraft, sessionRowInput, sessionReview } from "./session-review";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { buildSync } from "esbuild";
import { and, eq } from "drizzle-orm";
import { afterEach, expect, it } from "vitest";
import { openDatabase } from "../db/client";
import { migrateDatabase } from "../db/migrate";
import { financialAccounts, importBatches, importProfiles, importRows, sheetMembers, transactionSources, transactions, user } from "../db/schema";
import { createSheet, readSheet } from "../sheets/service";
import { mutateSettings } from "../sheets/settings";
import { deleteTransaction, listTransactions, saveTransaction } from "../ledger/service";
import { createSnapshot, restoreSnapshot, validateDatabase } from "../operations/snapshots";
import { mappingSchema } from "./csv";
import { applyImportAllocation, confirmImportReview, createImportReview, listImportProfiles, readImportReview, saveImportProfile, updateImportReview } from "./review";
import { inlineReviewDraft, inlineReviewInput } from "./inline-review";
import { reviewRowSchema } from "./presentation";

const connections: ReturnType<typeof openDatabase>[] = []; const directories: string[] = [];
afterEach(() => { for (const c of connections.splice(0)) c.sqlite.close(); for (const d of directories.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
const bytes = (text: string) => new TextEncoder().encode(text);
const mapping = mappingSchema.parse({ version: 1, profile: "Card CSV", date: "Date", payee: "Payee", dateFormat: "YYYY-MM-DD", decimalSeparator: ".", money: { mode: "signed", amount: "Amount", outflowSign: "negative" } });
function fixture(migrationsFolder?: string) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "homebooks-review-")); directories.push(directory);
  const filename = path.join(directory, "test.sqlite"); migrateDatabase(filename, migrationsFolder);
  const connection = openDatabase(filename); connections.push(connection);
  const owner = randomUUID(); const member = randomUUID(); const stranger = randomUUID();
  for (const id of [owner, member, stranger]) connection.db.insert(user).values({ id, name: id, email: `${id}@example.test`, updatedAt: new Date() }).run();
  const sheetId = createSheet(owner, { name: "Family", currency: "USD" }, connection).sheet.id;
  connection.db.insert(sheetMembers).values({ sheetId, userId: member, acceptedAt: new Date() }).run();
  mutateSettings(owner, sheetId, { kind: "create", entity: "account", name: "Card", sourceType: "credit_card" }, connection);
  const sheet = readSheet(owner, sheetId, connection); const accountId = sheet.accounts[0]?.id;
  if (!accountId) throw new Error("Missing fixture account.");
  const review = (rows = "2026-10-04,Shop,-10.00", config = mapping) => createImportReview(owner, sheetId, accountId, bytes(`Date,Payee,Amount${config.sourceId ? ",ID" : ""}\n${rows}`), config, connection);
  const proposal = { accountId, date: "2026-10-04", payee: "Shop", kind: "expense", amount: "-10.00", splits: [{ categoryId: sheet.categories[0]?.id, bucketId: sheet.buckets[0]?.id, amount: "-10.00" }] };
  return { directory, filename, connection, owner, member, stranger, sheetId, accountId, sheet, review, proposal };
}
type Fixture = ReturnType<typeof fixture>; type Review = ReturnType<typeof readImportReview>;
function update(f: Pick<Fixture, "connection" | "owner" | "sheetId">, r: Review, index = 0, extra: Record<string, unknown> = {}) {
  const row = r.rows[index]; if (!row) throw new Error("Missing fixture row.");
  return updateImportReview(f.owner, f.sheetId, r.id, { version: r.version, rowId: row.id, decision: "keep", kindReviewed: true, ...extra }, f.connection);
}
function confirm(f: Pick<Fixture, "connection" | "owner" | "sheetId">, r: Review) { return confirmImportReview(f.owner, f.sheetId, r.id, { version: r.version }, f.connection); }
function bulkLabels(f: Fixture) {
  mutateSettings(f.owner, f.sheetId, { kind: "create", entity: "category", name: "Groceries" }, f.connection);
  mutateSettings(f.owner, f.sheetId, { kind: "create", entity: "bucket", name: "Household" }, f.connection);
  const sheet = readSheet(f.owner, f.sheetId, f.connection);
  const category = sheet.categories.find((item) => item.name === "Groceries"); const bucket = sheet.buckets.find((item) => item.name === "Household");
  if (!category || !bucket) throw new Error("Missing bulk labels.");
  return { categoryId: category.id, bucketId: bucket.id };
}
it("applies either or both allocations across all pages while preserving signed amounts and other fields", () => {
  const f = fixture(); const labels = bulkLabels(f);
  const review = f.review(Array.from({ length: 101 }, (_, index) => `2026-10-04,Purchase ${index},${index % 2 ? "2.00" : "-10.00"}`).join("\n"));
  const category = applyImportAllocation(f.owner, f.sheetId, review.id, { version: review.version, categoryId: labels.categoryId }, f.connection);
  expect(category).toMatchObject({ kind: "updated", updated: 101, skipped: 0, unchanged: 0 });
  expect(category.review.rows.map((row) => row.proposed)).toEqual(review.rows.map((row) => ({ ...row.proposed, splits: row.proposed?.splits.map((split) => ({ ...split, categoryId: labels.categoryId })) })));
  const attribution = applyImportAllocation(f.member, f.sheetId, review.id, { version: category.review.version, bucketId: labels.bucketId }, f.connection);
  expect(attribution).toMatchObject({ kind: "updated", updated: 101, skipped: 0, unchanged: 0 });
  expect(attribution.review.rows.every((row) => row.proposed?.splits[0]?.categoryId === labels.categoryId && row.proposed.splits[0]?.bucketId === labels.bucketId)).toBe(true);
  expect(applyImportAllocation(f.owner, f.sheetId, review.id, { version: attribution.review.version, ...labels }, f.connection)).toMatchObject({ kind: "updated", updated: 0, skipped: 0, unchanged: 101 });
  expect(f.connection.db.select().from(transactions).all()).toEqual([]);
  const latest = readImportReview(f.owner, f.sheetId, review.id, f.connection);
  expect(confirm(f, latest).review.result?.added).toBe(101);
  expect(() => applyImportAllocation(f.owner, f.sheetId, review.id, { version: latest.version, ...labels }, f.connection)).toThrow("already finished");
});
it("skips split transactions, non-spending kinds, invalid rows and unresolved or excluded duplicate decisions", () => {
  const f = fixture(); const labels = bulkLabels(f);
  confirm(f, f.review("2026-10-04,Imported,-10.00,old", { ...mapping, sourceId: "ID" }));
  saveTransaction(f.owner, f.sheetId, { ...f.proposal, payee: "Manual" }, undefined, f.connection);
  let review = f.review("2026-10-04,Imported,-10.00,old\n2026-10-04,Eligible,-10.00,new\nwrong,Invalid,0,invalid\n2026-10-04,Skip,-10.00,skip\n2026-10-04,Exclude,-10.00,exclude\n2026-10-04,Manual,-10.00,manual\n2026-10-04,Split,-10.00,split\n2026-10-04,Income,10.00,income\n2026-10-04,Transfer,-10.00,transfer\n2026-10-04,Refund,2.00,refund", { ...mapping, sourceId: "ID" });
  review = update(f, review, 3, { decision: "skip" }); review = update(f, review, 4, { decision: "exclude" });
  const proposal = review.rows[6]?.proposed; if (!proposal) throw new Error("Missing split row.");
  review = update(f, review, 6, { proposed: { ...proposal, splits: proposal.splits.flatMap((split) => [{ ...split, amount: "-6.00" }, { ...split, amount: "-4.00" }]) } });
  review = update(f, review, 7, { proposed: { ...review.rows[7]?.proposed, kind: "income" } });
  review = update(f, review, 8, { proposed: { ...review.rows[8]?.proposed, kind: "transfer" } });
  const result = applyImportAllocation(f.owner, f.sheetId, review.id, { version: review.version, ...labels }, f.connection);
  expect(result).toMatchObject({ kind: "updated", updated: 2, skipped: 8, unchanged: 0 });
  for (const index of [0, 2, 3, 4, 5, 6, 7, 8]) expect(result.review.rows[index]).toEqual(review.rows[index]);
  expect(result.review.rows.map((row) => [row.original, row.source, row.decision])).toEqual(review.rows.map((row) => [row.original, row.source, row.decision]));
  expect(result.review.ready).toBe(false);
});
it("rejects invalid targets, lost access and stale batch versions without changing proposals", () => {
  const f = fixture(); const labels = bulkLabels(f); const review = f.review();
  const foreign = createSheet(f.owner, { name: "Other", currency: "USD" }, f.connection);
  const other = readSheet(f.owner, foreign.sheet.id, f.connection);
  expect(() => applyImportAllocation(f.owner, f.sheetId, review.id, { version: review.version, categoryId: other.categories[0]?.id }, f.connection)).toThrow("active spending category from this sheet");
  expect(() => applyImportAllocation(f.owner, f.sheetId, review.id, { version: review.version }, f.connection)).toThrow("Choose a spending category or spending group");
  expect(() => applyImportAllocation(f.owner, f.sheetId, review.id, { version: review.version + 1, ...labels }, f.connection)).toThrow("Someone changed");
  expect(() => applyImportAllocation(f.stranger, f.sheetId, review.id, { version: review.version, ...labels }, f.connection)).toThrow("unavailable");
  f.connection.db.delete(sheetMembers).where(eq(sheetMembers.userId, f.member)).run();
  expect(() => applyImportAllocation(f.member, f.sheetId, review.id, { version: review.version, ...labels }, f.connection)).toThrow("unavailable");
  mutateSettings(f.owner, f.sheetId, { kind: "archive", entity: "bucket", id: labels.bucketId }, f.connection);
  expect(() => applyImportAllocation(f.owner, f.sheetId, review.id, { version: review.version, ...labels }, f.connection)).toThrow("active spending group from this sheet");
  expect(readImportReview(f.owner, f.sheetId, review.id, f.connection)).toEqual(review);
});
it("refreshes an externally changed preview without applying allocations and skips the newly unresolved match on retry", () => {
  const f = fixture(); const labels = bulkLabels(f); const review = f.review("2026-10-04,Shop,-10.00\n2026-10-05,New,-2.00");
  saveTransaction(f.owner, f.sheetId, f.proposal, undefined, f.connection);
  const stale = applyImportAllocation(f.owner, f.sheetId, review.id, { version: review.version, ...labels }, f.connection);
  expect(stale.kind).toBe("stale"); expect(stale.review.rows[0]).toMatchObject({ decision: "pending", matching: { status: "possible" } });
  expect(stale.review.rows.map((row) => row.proposed)).toEqual(review.rows.map((row) => row.proposed));
  const result = applyImportAllocation(f.owner, f.sheetId, review.id, { version: stale.review.version, ...labels }, f.connection);
  expect(result).toMatchObject({ kind: "updated", updated: 1, skipped: 1, unchanged: 0 });
  expect(result.review.rows[0]?.proposed).toEqual(review.rows[0]?.proposed);
  expect(() => confirm(f, result.review)).toThrow("choose keep or skip");
});
it("rolls back all bulk allocation writes and the batch version when a later row fails", () => {
  const f = fixture(); const labels = bulkLabels(f); const review = f.review("2026-10-04,First,-10.00\n2026-10-05,Second,-2.00");
  f.connection.sqlite.exec("CREATE TRIGGER fail_bulk BEFORE UPDATE OF proposed ON import_rows WHEN NEW.source_row=3 BEGIN SELECT RAISE(ABORT,'Injected bulk failure'); END");
  expect(() => applyImportAllocation(f.owner, f.sheetId, review.id, { version: review.version, ...labels }, f.connection)).toThrow("Injected bulk failure");
  expect(readImportReview(f.owner, f.sheetId, review.id, f.connection)).toEqual(review);
  f.connection.sqlite.exec("DROP TRIGGER fail_bulk");
  expect(applyImportAllocation(f.owner, f.sheetId, review.id, { version: review.version, ...labels }, f.connection)).toMatchObject({ updated: 2 });
});
it("skips a row whose retained allocation became archived and skips repeated files", () => {
  const f = fixture(); const labels = bulkLabels(f); let review = f.review();
  review = update(f, review, 0, { proposed: { ...review.rows[0]?.proposed, splits: f.proposal.splits.map((split) => ({ ...split, bucketId: labels.bucketId })) } });
  mutateSettings(f.owner, f.sheetId, { kind: "archive", entity: "bucket", id: labels.bucketId }, f.connection);
  const stale = applyImportAllocation(f.owner, f.sheetId, review.id, { version: review.version, categoryId: labels.categoryId }, f.connection);
  expect(stale.kind).toBe("stale");
  const skipped = applyImportAllocation(f.owner, f.sheetId, review.id, { version: stale.review.version, categoryId: labels.categoryId }, f.connection);
  expect(skipped).toMatchObject({ kind: "updated", updated: 0, skipped: 1, unchanged: 0 });
  expect(skipped.review.rows[0]?.proposed).toEqual(review.rows[0]?.proposed);
  const fresh = f.review("2026-10-05,Repeat,-3.00"); confirm(f, fresh);
  const repeat = f.review("2026-10-05,Repeat,-3.00");
  expect(repeat.repeatedFile).toBe(true);
  expect(applyImportAllocation(f.owner, f.sheetId, repeat.id, { version: repeat.version, categoryId: labels.categoryId }, f.connection)).toMatchObject({ updated: 0, skipped: 1 });
});
it("preserves identical no-ID purchases, confirms atomically, and resolves retries through saved status", () => {
  const f = fixture(); const r = f.review("2026-10-04,Shop,-10.00\n2026-10-04,Shop,-10.00");
  expect(r.counts.new).toBe(2); expect(r.ready).toBe(true);
  expect(r.rows.every((row) => !row.kindReviewed)).toBe(true);
  const done = confirm(f, r);
  expect(done.review.result).toMatchObject({ added: 2, skipped: 0, excluded: 0, repeatedFile: false });
  expect(done.review).toMatchObject({ repeatedFile: false, counts: { new: 2, definite: 0, added: 2, skipped: 0 } });
  expect(f.connection.db.select().from(transactionSources).all()).toHaveLength(2);
  expect(confirm(f, r).review).toEqual(done.review);
  expect(readImportReview(f.member, f.sheetId, r.id, f.connection)).toEqual(done.review);
  expect(listTransactions(f.owner, f.sheetId, { batchId: r.id }, f.connection).total).toBe(2);
});
it("imports 1,000 untouched rows with proposed kinds and protected allocation defaults", () => {
  const f = fixture();
  const review = f.review(Array.from({ length: 1000 }, (_, index) => `2026-10-04,Purchase ${index},${index % 2 ? "2.00" : "-10.00"}`).join("\n"));
  expect(review.ready).toBe(true);
  expect(review.rows.every((row) => !row.kindReviewed)).toBe(true);
  expect(confirm(f, review).review.result).toMatchObject({ added: 1000, skipped: 0 });
  const ledger = listTransactions(f.owner, f.sheetId, { pageSize: 100 }, f.connection);
  expect(ledger.total).toBe(1000);
  expect(ledger.transactions.every((row) => row.splits.every((split) => split.categoryName === "Uncategorized" && split.bucketName === "Unassigned"))).toBe(true);
  expect(f.connection.db.select().from(transactions).all().filter((row) => row.kind === "refund" && row.amount === 200)).toHaveLength(500);
});
it("adds nothing for an exact file and mapping even when two reviews precede confirmation", () => {
  const f = fixture(); let a = f.review(); const b = f.review(); a = update(f, a); confirm(f, a);
  const repeated = confirm(f, b);
  expect(repeated.review.result).toMatchObject({ added: 0, skipped: 1, repeatedFile: true, viewBatchId: a.id });
  expect(f.connection.db.select().from(transactions).all()).toHaveLength(1);
});
it("reports consistent original and repeated outcomes when a file contains excluded invalid rows", () => {
  const f = fixture(); let first = f.review("2026-10-04,Shop,-10.00\nwrong,,0"); const second = f.review("2026-10-04,Shop,-10.00\nwrong,,0");
  first = update(f, first); first = update(f, first, 1, { decision: "exclude" });
  const original = confirm(f, first).review;
  expect(original).toMatchObject({ repeatedFile: false, counts: { new: 1, invalid: 0, excluded: 1, added: 1, skipped: 0 }, result: { added: 1, skipped: 0, excluded: 1, repeatedFile: false } });
  const repeated = confirm(f, second).review;
  expect(repeated).toMatchObject({ repeatedFile: true, counts: { new: 0, definite: 2, invalid: 0, excluded: 0, added: 0, skipped: 2 }, result: { added: 0, skipped: 2, excluded: 0, repeatedFile: true } });
  expect(readImportReview(f.owner, f.sheetId, first.id, f.connection)).toEqual(original);
  expect(readImportReview(f.owner, f.sheetId, second.id, f.connection)).toEqual(repeated);
  expect(confirm(f, second).review).toEqual(repeated);
  let third = f.review("2026-10-04,Shop,-10.00\nwrong,,0"); third = update(f, third, 1, { decision: "exclude" });
  expect(confirm(f, third).review).toMatchObject({ counts: { definite: 1, invalid: 0, excluded: 1, skipped: 1 }, result: { added: 0, skipped: 1, excluded: 1 } });
});
it("serializes simultaneous confirmations from separate processes and returns one saved result", async () => {
  const f = fixture(); let r = f.review(); r = update(f, r);
  const worker = path.join(f.directory, "confirm.cjs");
  buildSync({ stdin: { contents: 'import { openDatabase } from "./src/db/client"; import { confirmImportReview } from "./src/imports/review"; const [filename,actor,sheet,batch,version]=process.argv.slice(2); const c=openDatabase(filename); try { process.stdout.write(JSON.stringify(confirmImportReview(actor,sheet,batch,{version:Number(version)},c).review.result)); } finally { c.sqlite.close(); }', resolveDir: process.cwd() }, outfile: worker, bundle: true, platform: "node", format: "cjs", packages: "external", banner: { js: `require = require("node:module").createRequire(${JSON.stringify(path.join(process.cwd(), "package.json"))});` } });
  function run() { return new Promise<unknown>((resolve, reject) => {
    const child = spawn(process.execPath, [worker, f.filename, f.owner, f.sheetId, r.id, String(r.version)], { windowsHide: true });
    let output = ""; let errors = ""; child.stdout.on("data", (chunk) => { output += chunk; }); child.stderr.on("data", (chunk) => { errors += chunk; }); child.on("error", reject);
    child.on("close", (code) => { if (code !== 0) reject(new Error(errors)); else resolve(JSON.parse(output)); });
  }); }
  const results = await Promise.all([run(), run()]); expect(results[0]).toEqual(results[1]); expect(results[0]).toMatchObject({ added: 1 });
  expect(f.connection.db.select().from(transactions).all()).toHaveLength(1); expect(f.connection.db.select().from(transactionSources).all()).toHaveLength(1);
});
it("uses immutable stable ID identity after ledger edits and tombstones, and reviews ID conflicts", () => {
  const f = fixture(); const config = { ...mapping, sourceId: "ID" }; let r = f.review("2026-10-04,Shop,-10.00,stable", config);
  r = update(f, r); const done = confirm(f, r); const id = done.review.result?.transactionIds[0]; if (!id) throw new Error("Missing imported ID.");
  const record = saveTransaction(f.owner, f.sheetId, { ...f.proposal, payee: "Edited payee", amount: "-20.00", splits: f.proposal.splits.map((s) => ({ ...s, amount: "-20.00" })), version: 1 }, { id }, f.connection);
  deleteTransaction(f.owner, f.sheetId, id, { version: record.version }, f.connection);
  const next = f.review("2026-10-04,Shop,-10.00,stable\n2026-10-05,Other,-3.00,new", config);
  expect(next.rows[0]?.matching).toMatchObject({ status: "definite", candidates: [{ deleted: true, payee: "Edited payee", source: { payee: "Shop", amount: -1000 } }] });
  let conflict = f.review("2026-10-04,Shop,-11.00,stable", config);
  expect(conflict.rows[0]?.matching.status).toBe("possible"); expect(conflict.rows[0]?.decision).toBe("pending");
  expect(() => confirm(f, conflict)).toThrow("choose keep or skip"); conflict = update(f, conflict); expect(confirm(f, conflict).review.result?.added).toBe(1);
  expect(f.connection.db.select().from(transactionSources).all().map((s) => s.amount)).toEqual([-1000, -1100]);
});
it("does not silently exclude a kept stable-ID occurrence when the first occurrence was excluded or skipped", () => {
  for (const decision of ["exclude", "skip"]) {
    const f = fixture(); let r = f.review("2026-10-04,Shop,-10.00,same\n2026-10-04,Shop,-10.00,same", { ...mapping, sourceId: "ID" });
    expect(r.rows[1]?.matching.status).toBe("definite"); r = update(f, r, 0, { decision });
    expect(r.rows[1]?.matching.status).toBe("new"); r = update(f, r, 1); expect(confirm(f, r).review.result?.added).toBe(1);
  }
});
it("requires explicit choices for no-ID overlaps and manual matches while preserving occurrence counts", () => {
  const f = fixture(); let first = f.review(); first = update(f, first); confirm(f, first);
  let overlap = f.review("2026-10-04,Shop,-10.00\n2026-10-04,Shop,-10.00\n2026-10-05,New,-2.00");
  expect(overlap.rows.slice(0, 2).map((r) => [r.matching.status, r.matching.occurrence, r.matching.existingOccurrences])).toEqual([["possible", 1, 1], ["possible", 2, 1]]);
  overlap = update(f, overlap, 0, { decision: "skip" }); overlap = update(f, overlap, 1); overlap = update(f, overlap, 2);
  expect(confirm(f, overlap).review.result).toMatchObject({ added: 2, skipped: 1 });
  const manual = saveTransaction(f.owner, f.sheetId, { ...f.proposal, payee: "Manual" }, undefined, f.connection);
  deleteTransaction(f.owner, f.sheetId, manual.id, { version: 1 }, f.connection);
  expect(f.review("2026-10-04,Manual,-10.00").rows[0]?.matching).toMatchObject({ status: "possible", candidates: [{ deleted: true, source: null }] });
});
it("keeps account and interpretation scopes separate while names do not change source identity", () => {
  const f = fixture(); let first = f.review(); first = update(f, first); confirm(f, first);
  const other = f.review("2026-10-04,Shop,-10.00", { ...mapping, profile: "Other source" }); expect(other.repeatedFile).toBe(true); expect(other.rows[0]?.matching.status).toBe("possible");
  const profile = saveImportProfile(f.owner, f.sheetId, { accountId: f.accountId, mapping }, f.connection);
  expect(listImportProfiles(f.owner, f.sheetId, f.accountId, f.connection)).toHaveLength(1);
  const saved = saveImportProfile(f.owner, f.sheetId, { id: profile.id, version: profile.version, accountId: f.accountId, mapping: { ...mapping, dateFormat: "DD/MM/YYYY" } }, f.connection);
  expect(saved.id).toBe(profile.id); expect(saved.version).toBe(2); expect(readImportReview(f.owner, f.sheetId, first.id, f.connection).mapping.dateFormat).toBe("YYYY-MM-DD");
  expect(() => saveImportProfile(f.owner, f.sheetId, { id: profile.id, version: 1, accountId: f.accountId, mapping }, f.connection)).toThrow("Someone changed");
  mutateSettings(f.owner, f.sheetId, { kind: "create", entity: "account", name: "Other account", sourceType: "bank" }, f.connection);
  const account = readSheet(f.owner, f.sheetId, f.connection).accounts.find((a) => a.id !== f.accountId); if (!account) throw new Error("Missing other account.");
  expect(createImportReview(f.owner, f.sheetId, account.id, bytes("Date,Payee,Amount\n2026-10-04,Shop,-10.00"), mapping, f.connection).rows[0]?.matching.status).toBe("new");
});
it("corrects invalid mapped fields or excludes invalid rows without storing unmapped columns", () => {
  const f = fixture(); let r = createImportReview(f.owner, f.sheetId, f.accountId, bytes("Date,Payee,Amount,Card No.,Category\nwrong,,0,8622,Merchandise\nwrong,,0,8622,Merchandise"), mapping, f.connection);
  expect(r.counts.invalid).toBe(2); expect(r.ready).toBe(false); expect(() => confirm(f, r)).toThrow("invalid row");
  r = update(f, r, 0, { correction: { Date: "2026-10-04", Payee: "Corrected", Amount: "-1.00" } });
  r = update(f, r, 1, { decision: "exclude" }); expect(confirm(f, r).review.result).toMatchObject({ added: 1, excluded: 1 });
  const stored = f.connection.db.select().from(importRows).all(); expect(JSON.stringify(stored)).not.toContain("8622"); expect(JSON.stringify(stored)).not.toContain("Merchandise");
  expect(JSON.parse(stored[0]?.original ?? "null")).toMatchObject({ status: "invalid", selected: { Date: "wrong", Payee: "", Amount: "0" } });
});
it("persists inline kind and allocation edits through the normal versioned review and confirmation", () => {
  const f = fixture();
  mutateSettings(f.owner, f.sheetId, { kind: "create", entity: "category", name: "Groceries" }, f.connection);
  mutateSettings(f.owner, f.sheetId, { kind: "create", entity: "bucket", name: "Household" }, f.connection);
  const sheet = readSheet(f.owner, f.sheetId, f.connection);
  const category = sheet.categories.find((item) => item.name === "Groceries");
  const bucket = sheet.buckets.find((item) => item.name === "Household");
  if (!category || !bucket) throw new Error("Missing inline allocation fixture.");
  let review = f.review("2026-10-04,Payment,-10.00\n2026-10-05,Shopping,-3.00");
  const first = review.rows[0]; if (!first) throw new Error("Missing first row.");
  review = updateImportReview(f.owner, f.sheetId, review.id, { version: review.version, ...inlineReviewInput(first, { ...inlineReviewDraft(first), kind: "transfer" }, sheet) }, f.connection);
  const second = review.rows[1]; if (!second) throw new Error("Missing second row.");
  review = updateImportReview(f.owner, f.sheetId, review.id, { version: review.version, ...inlineReviewInput(second, { ...inlineReviewDraft(second), categoryId: category.id, bucketId: bucket.id }, sheet) }, f.connection);
  expect(review.ready).toBe(true);
  expect(review.rows.map((row) => [row.kindReviewed, row.source?.amount])).toEqual([[true, -1000], [true, -300]]);
  const result = confirm(f, review); expect(result.review.result?.added).toBe(2);
  const ledger = listTransactions(f.owner, f.sheetId, {}, f.connection);
  expect(ledger.transactions.map((row) => [row.payee, row.kind, row.splits[0]?.categoryName, row.splits[0]?.bucketName])).toEqual([["Shopping", "expense", "Groceries", "Household"], ["Payment", "transfer", "Uncategorized", "Unassigned"]]);
});
it("imports a valid source correction without a separate row save", () => {
  const f = fixture();
  let review = f.review("wrong,Card payment,0");
  const invalid = review.rows[0]; if (!invalid) throw new Error("Missing invalid row.");
  review = updateImportReview(f.owner, f.sheetId, review.id, { version: review.version, rowId: invalid.id, correction: { Date: "2026-10-04", Amount: "-10.00" } }, f.connection);
  expect(review.rows[0]?.kindReviewed).toBe(false);
  expect(review.ready).toBe(true);
  expect(review.rows[0]?.decision).toBe("keep");
  expect(confirm(f, review).review.result?.added).toBe(1);
  expect(f.connection.db.select().from(transactions).all().map((transaction) => [transaction.kind, transaction.amount])).toEqual([["expense", -1000]]);
});
it("retains an optional edited kind alongside untouched rows", () => {
  const f = fixture();
  let review = f.review("2026-10-04,Card payment,-10.00\n2026-10-05,Purchase,-2.00");
  const corrected = review.rows[0]; if (!corrected?.proposed) throw new Error("Missing corrected proposal.");
  review = updateImportReview(f.owner, f.sheetId, review.id, { version: review.version, rowId: corrected.id, decision: "keep", kindReviewed: true, proposed: { ...corrected.proposed, kind: "transfer" } }, f.connection);
  expect(review.ready).toBe(true);
  expect(review.rows[0]?.kindReviewed).toBe(true);
  expect(confirm(f, review).review.result?.added).toBe(2);
  expect(f.connection.db.select().from(transactions).all().map((transaction) => [transaction.kind, transaction.amount])).toEqual([["transfer", -1000], ["expense", -200]]);
});
it("edits a proposed transaction without rewriting source identity and validates exact splits and references", () => {
  const f = fixture(); let r = f.review();
  expect(() => update(f, r, 0, { proposed: { ...f.proposal, splits: f.proposal.splits.map((s) => ({ ...s, amount: "-9.00" })) } })).toThrow("add up exactly");
  const foreign = createSheet(f.owner, { name: "Other", currency: "USD" }, f.connection).sheet.id;
  const categoryId = readSheet(f.owner, foreign, f.connection).categories[0]?.id;
  expect(() => update(f, r, 0, { proposed: { ...f.proposal, splits: f.proposal.splits.map((s) => ({ ...s, categoryId })) } })).toThrow("from this sheet");
  r = update(f, r, 0, { proposed: { ...f.proposal, date: "2026-10-05", payee: "Payment", kind: "transfer" } }); confirm(f, r);
  expect(f.connection.db.select().from(transactions).get()).toMatchObject({ date: "2026-10-05", payee: "Payment", kind: "transfer" });
  expect(f.connection.db.select().from(transactionSources).get()).toMatchObject({ date: "2026-10-04", payee: "Shop", amount: -1000 });
});
it("returns stale review with changed decisions and retained proposals before another confirmation", () => {
  const f = fixture(); let r = f.review(); r = update(f, r, 0, { proposed: { ...f.proposal, payee: "Kept proposal" } });
  saveTransaction(f.owner, f.sheetId, f.proposal, undefined, f.connection);
  const stale = confirm(f, r); expect(stale.kind).toBe("stale"); expect(stale.changedRowIds).toEqual([r.rows[0]?.id]);
  expect(stale.review.rows[0]).toMatchObject({ decision: "pending", proposed: { payee: "Kept proposal" }, matching: { status: "possible" } });
  expect(() => confirm(f, stale.review)).toThrow("choose keep or skip");
  r = update(f, stale.review); expect(confirm(f, r).review.result?.added).toBe(1);
});
it("requires another duplicate choice when correction or a row edit reveals a new match", () => {
  const f = fixture(); saveTransaction(f.owner, f.sheetId, f.proposal, undefined, f.connection);
  let r = f.review("wrong,Shop,-10.00"); r = update(f, r, 0, { correction: { Date: "2026-10-04" } });
  expect(r.rows[0]).toMatchObject({ decision: "pending", matching: { status: "possible" } }); expect(r.ready).toBe(false); expect(() => confirm(f, r)).toThrow("choose keep or skip");
  r = update(f, r); expect(confirm(f, r).review.result?.added).toBe(1);
  let next = f.review("2026-10-05,Unrelated,-2.00"); saveTransaction(f.owner, f.sheetId, { ...f.proposal, date: "2026-10-05", payee: "Unrelated", amount: "-2.00", splits: f.proposal.splits.map((s) => ({ ...s, amount: "-2.00" })) }, undefined, f.connection);
  next = update(f, next); expect(next.rows[0]?.decision).toBe("pending"); const stale = confirm(f, next); expect(stale.kind).toBe("stale"); expect(() => confirm(f, stale.review)).toThrow("choose keep or skip");
});
it("rechecks account archive and membership on confirmation and isolates batch reads/filtering", () => {
  const f = fixture(); let r = f.review(); r = update(f, r);
  expect(() => readImportReview(f.stranger, f.sheetId, r.id, f.connection)).toThrow("unavailable");
  const foreign = createSheet(f.owner, { name: "Other", currency: "USD" }, f.connection).sheet.id;
  expect(() => listTransactions(f.owner, foreign, { batchId: r.id }, f.connection)).toThrow("unavailable");
  f.connection.db.delete(sheetMembers).where(eq(sheetMembers.userId, f.member)).run();
  expect(() => confirmImportReview(f.member, f.sheetId, r.id, { version: r.version }, f.connection)).toThrow("unavailable");
  f.connection.db.update(financialAccounts).set({ isArchived: true }).where(eq(financialAccounts.id, f.accountId)).run();
  const stale = confirm(f, r); expect(stale.kind).toBe("stale"); expect(() => confirm(f, stale.review)).toThrow("active transaction account");
  expect(f.connection.db.select().from(transactions).all()).toEqual([]);
});
it("rolls back every ledger/source/link write if a later untouched row fails and keeps the review retryable", () => {
  const f = fixture(); const r = f.review("2026-10-04,Shop,-10.00\n2026-10-05,Second,-2.00");
  f.connection.sqlite.exec("CREATE TRIGGER fail_second BEFORE INSERT ON transactions WHEN NEW.payee='Second' BEGIN SELECT RAISE(ABORT,'Injected failure'); END");
  expect(() => confirm(f, r)).toThrow("Injected failure"); expect(f.connection.db.select().from(transactions).all()).toEqual([]); expect(f.connection.db.select().from(transactionSources).all()).toEqual([]);
  expect(readImportReview(f.owner, f.sheetId, r.id, f.connection)).toMatchObject({ state: "review", result: null });
  expect(f.connection.db.select().from(importRows).all().every((row) => row.transactionId === null)).toBe(true);
  f.connection.sqlite.exec("DROP TRIGGER fail_second"); expect(confirm(f, r).review.result?.added).toBe(2);
});
it("prevents source and original review edits after recording identity", () => {
  const f = fixture(); let r = f.review(); const row = r.rows[0]; if (!row) throw new Error("Missing row.");
  expect(() => f.connection.db.update(importRows).set({ original: "{}" }).where(eq(importRows.id, row.id)).run()).toThrow("immutable");
  expect(() => f.connection.db.update(importRows).set({ source: null }).where(eq(importRows.id, row.id)).run()).toThrow("immutable");
  r = update(f, r); confirm(f, r);
  expect(() => f.connection.db.update(importRows).set({ decision: "exclude" }).where(eq(importRows.id, row.id)).run()).toThrow("immutable");
  expect(() => f.connection.db.update(importBatches).set({ state: "review" }).where(eq(importBatches.id, r.id)).run()).toThrow("immutable");
});
it("restores imported identities and outcomes after upgrading the existing migration prefix", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "homebooks-import-prefix-")); directories.push(directory);
  const folder = path.join(directory, "old-migrations"); fs.mkdirSync(path.join(folder, "meta"), { recursive: true });
  const journal = JSON.parse(fs.readFileSync("drizzle/meta/_journal.json", "utf8")); journal.entries = journal.entries.slice(0, -1);
  fs.writeFileSync(path.join(folder, "meta/_journal.json"), JSON.stringify(journal));
  for (const entry of journal.entries) fs.copyFileSync(path.join("drizzle", `${entry.tag}.sql`), path.join(folder, `${entry.tag}.sql`));
  // Seed the previous schema with SQL, rather than calling application code that requires the current schema.
  const filename = path.join(directory, "legacy.sqlite"); migrateDatabase(filename, folder);
  const connection = openDatabase(filename); connections.push(connection);
  const owner = randomUUID(); const sheetId = randomUUID(); const accountId = randomUUID(); const categoryId = randomUUID(); const bucketId = randomUUID(); const manual = { id: randomUUID() };
  connection.sqlite.prepare("INSERT INTO user (id, name, email) VALUES (?, ?, ?)").run(owner, "Legacy", `${owner}@example.test`);
  connection.sqlite.prepare("INSERT INTO sheets (id, name, currency, owner_id, created_at) VALUES (?, 'Family', 'USD', ?, 1)").run(sheetId, owner);
  connection.sqlite.prepare("INSERT INTO financial_accounts (id, sheet_id, name, source_type, created_at, updated_at) VALUES (?, ?, 'Card', 'credit_card', 1, 1)").run(accountId, sheetId);
  connection.sqlite.prepare("INSERT INTO categories (id, sheet_id, name, is_protected) VALUES (?, ?, 'Uncategorized', 1)").run(categoryId, sheetId);
  connection.sqlite.prepare("INSERT INTO buckets (id, sheet_id, name, is_protected) VALUES (?, ?, 'Unassigned', 1)").run(bucketId, sheetId);
  connection.sqlite.prepare("INSERT INTO transactions (id, sheet_id, account_id, date, payee, kind, amount, creator_id, created_at, updated_at) VALUES (?, ?, ?, '2026-10-04', 'Shop', 'expense', -1000, ?, 1, 1)").run(manual.id, sheetId, accountId, owner);
  connection.sqlite.prepare("INSERT INTO splits (id, sheet_id, transaction_id, category_id, bucket_id, amount, position) VALUES (?, ?, ?, ?, ?, -1000, 0)").run(randomUUID(), sheetId, manual.id, categoryId, bucketId);
  connection.db.insert(transactionSources).values({ id: randomUUID(), sheetId, transactionId: manual.id, accountId, sourceProfile: "legacy", sourceId: "legacy-id", date: "2026-10-04", payee: "Shop", amount: -1000, fingerprint: "legacy", createdAt: new Date() }).run();
  const legacyProfile = randomUUID(); const legacyBatch = randomUUID(); const legacyMapping = { ...mapping, sourceId: "ID" };
  const legacySource = { date: "2026-10-04", payee: "Shop", amount: -1000, sourceId: "legacy-id" };
  connection.sqlite.prepare("INSERT INTO import_profiles (id,sheet_id,account_id,name,name_key,mapping) VALUES (?,?,?,?,?,?)").run(legacyProfile, sheetId, accountId, "Card CSV", "card csv", JSON.stringify(legacyMapping));
  connection.sqlite.prepare("INSERT INTO import_batches (id,sheet_id,account_id,profile_id,mapping,file_hash,mapping_hash,state,snapshot,creator_id,created_at,result) VALUES (?,?,?,?,?,?,?,'committed','legacy',?,1,?)").run(legacyBatch, sheetId, accountId, legacyProfile, JSON.stringify(legacyMapping), "legacy-file", "legacy-mapping", owner, JSON.stringify({ added: 1, skipped: 0, excluded: 0, transactionIds: [manual.id], repeatedFile: false, viewBatchId: legacyBatch }));
  connection.sqlite.prepare("INSERT INTO import_rows (id,sheet_id,batch_id,source_row,original,source,errors,matching,transaction_id) VALUES (?,?,?,2,?,?,'[]',?,?)").run(randomUUID(), sheetId, legacyBatch, JSON.stringify({ status: "valid", source: legacySource }), JSON.stringify(legacySource), JSON.stringify({ status: "new", reason: "", candidates: [], earlierRow: null, occurrence: 1, existingOccurrences: 0 }), manual.id);
  connection.sqlite.prepare("UPDATE transactions SET deleted_at=2, payee='Edited legacy purchase' WHERE id=?").run(manual.id);
  expect(validateDatabase(filename).pendingMigrations).toBe(true);
  migrateDatabase(filename); expect(validateDatabase(filename).pendingMigrations).toBe(false);
  expect(listTransactions(owner, sheetId, {}, connection).transactions).toEqual([]);
  expect(listImportProfiles(owner, sheetId, accountId, connection)).toMatchObject([{ id: legacyProfile, reusable: true }]);
  const legacyOverlap = createImportReview(owner, sheetId, accountId, bytes("Date,Payee,Amount,ID\n2026-10-04,Shop,-10.00,legacy-id"), legacyMapping, connection);
  expect(legacyOverlap.rows[0]?.matching).toMatchObject({ status: "definite", candidates: [{ deleted: true }] });
  expect(readSheet(owner, sheetId, connection).buckets[0]).toMatchObject({ trackRepayment: false, trackingVersion: 1 });
  expect(connection.sqlite.pragma("foreign_key_check")).toEqual([]);
  const f = { filename, connection, owner, sheetId, accountId,
    review: (rows: string, config: typeof mapping) => createImportReview(owner, sheetId, accountId, bytes(`Date,Payee,Amount${config.sourceId ? ",ID" : ""}\n${rows}`), config, connection) };

  expect(() => f.connection.db.update(transactionSources).set({ payee: "Rewritten" }).where(eq(transactionSources.transactionId, manual.id)).run()).toThrow("immutable");
  let r = f.review("2026-10-05,New,-5.00,source-id", { ...mapping, sourceId: "ID" }); r = update(f, r); const result = confirm(f, r).review.result;
  const snapshot = await createSnapshot({ filename: f.filename, backupDirectory: path.join(directory, "backups") });
  const restoredFile = path.join(directory, "restored.sqlite"); await restoreSnapshot(snapshot, { filename: restoredFile, backupDirectory: path.join(directory, "preserved") });
  const restored = openDatabase(restoredFile); connections.push(restored);
  expect(readImportReview(f.owner, f.sheetId, r.id, restored).result).toEqual(result);
  expect(restored.db.select().from(transactionSources).all()).toHaveLength(2);
  expect(listImportProfiles(owner, sheetId, accountId, restored)).toMatchObject([{ id: legacyProfile, reusable: true }]);
  expect(createImportReview(owner, sheetId, accountId, bytes("Date,Payee,Amount,ID\n2026-10-04,Shop,-10.00,legacy-id"), legacyMapping, restored).rows[0]?.matching).toMatchObject({ status: "definite", candidates: [{ deleted: true }] });
  const next = createImportReview(f.owner, f.sheetId, f.accountId, bytes("Date,Payee,Amount,ID\n2026-10-05,New,-5.00,source-id\n2026-10-06,Another,-1.00,new-id"), { ...mapping, sourceId: "ID" }, restored);
  expect(next.rows[0]?.matching.status).toBe("definite");
  expect(restored.db.select().from(importProfiles).where(and(eq(importProfiles.sheetId, f.sheetId), eq(importProfiles.id, r.profileId))).get()).toBeDefined();
});

it("does not remember formats during review and preserves duplicate identity after edits and deletion", () => {
  const f = fixture();
  const config = { ...mapping, sourceId: "ID" };
  const original = f.review("2026-10-04,Shop,-10.00,stable", config);
  expect(listImportProfiles(f.owner, f.sheetId, f.accountId, f.connection)).toEqual([]);
  const result = confirm(f, original).review.result;
  const transactionId = result?.transactionIds[0]; if (!transactionId) throw new Error("Missing transaction.");
  const edited = saveTransaction(f.owner, f.sheetId, { ...f.proposal, payee: "Edited", version: 1 }, { id: transactionId }, f.connection);
  deleteTransaction(f.owner, f.sheetId, transactionId, { version: edited.version }, f.connection);
  const repeat = f.review("2026-10-04,Shop,-10.00,stable", { ...config, profile: "Different label" });
  expect(repeat.profileId).toBe(original.profileId); expect(repeat.repeatedFile).toBe(true);
  const overlap = f.review("2026-10-04,Shop,-10.00,stable\n2026-10-05,Other,-1.00,new", config);
  expect(overlap.rows[0]?.matching).toMatchObject({ status: "definite", candidates: [{ deleted: true }] });
  expect(listImportProfiles(f.owner, f.sheetId, f.accountId, f.connection)).toEqual([]);
  const incompatible = f.review("2026-10-04,Shop,-10.00,stable", { ...config, money: { mode: "signed", amount: "Amount", outflowSign: "positive" } });
  expect(incompatible.profileId).not.toBe(original.profileId); expect(incompatible.repeatedFile).toBe(false);
  expect(incompatible.rows[0]?.matching.status).toBe("new");
});
it("keeps import-specific changes separate from explicit saved updates", () => {
  const f = fixture(); const saved = saveImportProfile(f.owner, f.sheetId, { accountId: f.accountId, mapping }, f.connection);
  const changed = { ...mapping, money: { mode: "signed", amount: "Amount", outflowSign: "positive" } };
  createImportReview(f.owner, f.sheetId, f.accountId, bytes("Date,Payee,Amount\n2026-10-04,Shop,10.00"), changed, f.connection, saved.id);
  expect(listImportProfiles(f.owner, f.sheetId, f.accountId, f.connection)).toEqual([saved]);
  saveImportProfile(f.owner, f.sheetId, { id: saved.id, version: saved.version, accountId: f.accountId, mapping: changed }, f.connection);
  expect(() => saveImportProfile(f.owner, f.sheetId, { id: saved.id, version: saved.version, accountId: f.accountId, mapping }, f.connection)).toThrow("Someone changed");
});

it("submits edits across all pages atomically and retries the committed result once", () => {
  const f = fixture(); const r = f.review(Array.from({ length: 105 }, (_, i) => `2026-10-04,Purchase ${i},-10.00`).join("\n"));
  const drafts = Object.fromEntries([0, 53, 104].map((index) => { const row = r.rows[index]; const d = sessionRowDraft(row, "USD"); d.transaction.payee = `Edited ${index}`; return [row.id, d]; }));
  const payload = { version: r.version, edits: r.rows.filter((row) => drafts[row.id]).map((row) => sessionRowInput(r, row, drafts[row.id], f.sheet)) };
  expect(sessionReview(r, drafts, f.sheet).counts.added).toBe(105);
  expect(readImportReview(f.owner, f.sheetId, r.id, f.connection).rows[104].proposed?.payee).toBe("Purchase 104");
  const result = confirmImportReview(f.owner, f.sheetId, r.id, payload, f.connection);
  expect(result.review.result?.added).toBe(105);
  expect(result.review.rows[104].proposed?.payee).toBe("Edited 104");
  expect(confirmImportReview(f.member, f.sheetId, r.id, payload, f.connection).review.result).toEqual(result.review.result);
  expect(f.connection.db.select().from(transactions).all()).toHaveLength(105);
});
it("rolls back proposal edits and every transaction when a later proposal is invalid", () => {
  const f = fixture(); const r = f.review("2026-10-04,First,-10.00\n2026-10-05,Second,-10.00");
  const original = readImportReview(f.owner, f.sheetId, r.id, f.connection);
  expect(() => confirmImportReview(f.owner, f.sheetId, r.id, { version: r.version, edits: [
    { rowId: r.rows[0].id, decision: "keep", proposed: { ...r.rows[0].proposed, payee: "Pending change" } },
    { rowId: r.rows[1].id, decision: "keep", proposed: { ...r.rows[1].proposed, splits: [{ categoryId: randomUUID(), bucketId: f.sheet.buckets[0].id, amount: "-10.00" }] } },
  ] }, f.connection)).toThrow();
  expect(readImportReview(f.owner, f.sheetId, r.id, f.connection)).toEqual(original);
  expect(f.connection.db.select().from(transactions).all()).toEqual([]);
});
it("returns newly possible correction matches without persisting edits, then accepts an explicit decision", () => {
  const f = fixture(); saveTransaction(f.owner, f.sheetId, f.proposal, undefined, f.connection);
  const r = f.review("wrong,Shop,-10.00"); const row = r.rows[0];
  const correction = { Date: "2026-10-04", Payee: "Shop", Amount: "-10.00" };
  const first = confirmImportReview(f.owner, f.sheetId, r.id, { version: r.version, edits: [{ rowId: row.id, decision: "keep", correction, matching: JSON.stringify(row.matching) }] }, f.connection);
  expect(first.kind).toBe("stale"); expect(first.review.rows[0].matching.status).toBe("possible"); expect(first.review.rows[0].decision).toBe("pending");
  expect(readImportReview(f.owner, f.sheetId, r.id, f.connection).rows[0].source).toBeNull();
  expect(f.connection.db.select().from(transactions).all()).toHaveLength(1);
  const second = confirmImportReview(f.owner, f.sheetId, r.id, { version: r.version, edits: [{ rowId: row.id, decision: "keep", correction, matching: JSON.stringify(first.review.rows[0].matching) }] }, f.connection);
  expect(second.kind).toBe("committed"); expect(second.review.result?.added).toBe(1);
});
it("rechecks changed valid-looking corrections rather than reusing their previous duplicate decision", () => {
  const f = fixture(); saveTransaction(f.owner, f.sheetId, f.proposal, undefined, f.connection);
  saveTransaction(f.owner, f.sheetId, { ...f.proposal, payee: "Other" }, undefined, f.connection);
  const r = f.review("wrong,Other,-10.00");
  const first = confirmImportReview(f.owner, f.sheetId, r.id, { version: r.version, edits: [{ rowId: r.rows[0].id, decision: "keep", correction: { Date: "2026-10-04", Payee: "Shop", Amount: "-10.00" }, matching: JSON.stringify(r.rows[0].matching) }] }, f.connection);
  const changed = confirmImportReview(f.owner, f.sheetId, r.id, { version: r.version, edits: [{ rowId: r.rows[0].id, decision: "keep", correction: { Date: "2026-10-04", Payee: "Other", Amount: "-10.00" }, matching: JSON.stringify(first.review.rows[0].matching) }] }, f.connection);
  expect(first.kind).toBe("stale"); expect(changed.kind).toBe("stale"); expect(f.connection.db.select().from(transactions).all()).toHaveLength(2);
});
it("keeps raw incomplete drafts across page selection and uses magnitudes for controlled fields", () => {
  const f = fixture(); const r = f.review(); const row = r.rows[0]; const d = sessionRowDraft(row, "USD");
  expect(d.transaction.amount).toBe("10.00"); expect(d.transaction.splits[0].amount).toBe("10.00");
  const refund = sessionRowDraft({ ...row, proposed: { ...row.proposed!, kind: "refund", amount: "10.00" } }, "USD"); expect(refund.transaction.amount).toBe("10.00");
  const transfer = sessionRowDraft({ ...row, proposed: { ...row.proposed!, kind: "transfer" } }, "USD"); expect(transfer.transaction.direction).toBe("out"); expect(transfer.transaction.amount).toBe("10.00");
  d.transaction.splitMode = true; d.transaction.splits = [{ ...d.transaction.splits[0], amount: "1." }, { ...d.transaction.splits[0], key: "second", amount: "" }];
  const drafts = { [row.id]: d }; expect(sessionReview(r, drafts, f.sheet).ready).toBe(false); expect(drafts[row.id].transaction.splits.map((split) => split.amount)).toEqual(["1.", ""]);
});
it("describes an incomplete split amount in plain language without exposing validator details", () => {
  const f = fixture(); const r = f.review("2026-10-04,Shop,-100.00"); const row = r.rows[0];
  const draft = sessionRowDraft(row, "USD");
  draft.transaction.splitMode = true;
  draft.transaction.splits = [{ ...draft.transaction.splits[0], amount: "60.00" }, { ...draft.transaction.splits[0], key: "second", amount: "40." }];
  const result = sessionReview(r, { [row.id]: draft }, f.sheet);
  expect(result.ready).toBe(false);
  expect(result.errors[row.id]).toBe("Enter valid positive amounts with the currency's precision.");
  expect(draft.transaction.splits[1].amount).toBe("40.");
  for (const detail of ["origin", "code", "pattern", "path", "regex", "["]) expect(result.errors[row.id]).not.toContain(detail);
});

it("rejects stale review, ledger, configuration and revoked access before persisting submitted drafts", () => {
  for (const change of ["review", "ledger", "configuration", "access"]) {
    const f = fixture(); const r = f.review();
    const pending = { ...r.rows[0].proposed!, payee: "Never persist this pending edit" };
    if (change === "review") update(f, r, 0, { proposed: { ...r.rows[0].proposed!, payee: "Saved by another reviewer" } });
    if (change === "ledger") saveTransaction(f.owner, f.sheetId, { ...f.proposal, payee: "Other ledger activity" }, undefined, f.connection);
    if (change === "configuration") mutateSettings(f.owner, f.sheetId, { kind: "create", entity: "category", name: "New category" }, f.connection);
    if (change === "access") f.connection.db.delete(sheetMembers).where(and(eq(sheetMembers.sheetId, f.sheetId), eq(sheetMembers.userId, f.member))).run();
    const payload = { version: r.version, edits: [{ rowId: r.rows[0].id, decision: "keep", proposed: pending }] };
    if (change === "review" || change === "access") expect(() => confirmImportReview(change === "access" ? f.member : f.owner, f.sheetId, r.id, payload, f.connection)).toThrow();
    else expect(confirmImportReview(f.owner, f.sheetId, r.id, payload, f.connection).kind).toBe("stale");
    expect(readImportReview(f.owner, f.sheetId, r.id, f.connection).rows[0].proposed?.payee).not.toBe(pending.payee);
    expect(f.connection.db.select().from(transactions).all()).toHaveLength(change === "ledger" ? 1 : 0);
  }
});
it("resumes saved corrected sources without replaying their original invalid cells", () => {
  const f = fixture(); const r = f.review("wrong,Shop,-10.00");
  const saved = update(f, r, 0, { correction: { Date: "2026-10-04" } });
  expect(sessionRowDraft(saved.rows[0], "USD").correction).toBeNull();
  expect(sessionReview(saved, {}, f.sheet)).toMatchObject({ ready: true, counts: { added: 1, invalid: 0 } });
});
it("rechecks a pending correction changed away from a definite source and preserves edited parts", () => {
  const f = fixture(); const r = f.review("wrong,Shop,-10.00"); const row = r.rows[0];
  const draft = sessionRowDraft(row, "USD"); draft.decision = "keep";
  draft.correction = { Date: "2026-10-04", Payee: "Other purchase", Amount: "-10.00" };
  const valid = f.review().rows[0];
  const definiteRow = reviewRowSchema.parse({ ...row, source: valid.source, matching: { ...row.matching, status: "definite" } });
  draft.baseline = sessionRowDraft(definiteRow, "USD").baseline;
  expect(sessionReview({ ...r, rows: [definiteRow] }, { [row.id]: draft }, f.sheet)).toMatchObject({ ready: true, counts: { added: 1, skipped: 0 } });
  draft.proposalEdited = true; draft.transaction = { ...sessionRowDraft(valid, "USD").transaction, splitMode: true, splits: [{ key: "raw", categoryId: f.sheet.categories[0].id, bucketId: f.sheet.buckets[0].id, amount: "1." }] };
  expect(sessionReview({ ...r, rows: [definiteRow] }, { [row.id]: draft }, f.sheet).ready).toBe(false);
  expect(draft.transaction.splits[0].amount).toBe("1.");
});
