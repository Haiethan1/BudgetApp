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
import { confirmImportReview, createImportReview, listImportProfiles, readImportReview, saveImportProfile, updateImportReview } from "./review";

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
function update(f: Fixture, r: Review, index = 0, extra: Record<string, unknown> = {}) {
  const row = r.rows[index]; if (!row) throw new Error("Missing fixture row.");
  return updateImportReview(f.owner, f.sheetId, r.id, { version: r.version, rowId: row.id, decision: "keep", kindReviewed: true, ...extra }, f.connection);
}
function confirm(f: Fixture, r: Review) { return confirmImportReview(f.owner, f.sheetId, r.id, { version: r.version }, f.connection); }
it("preserves identical no-ID purchases, confirms atomically, and resolves retries through saved status", () => {
  const f = fixture(); let r = f.review("2026-10-04,Shop,-10.00\n2026-10-04,Shop,-10.00");
  expect(r.counts.new).toBe(2); expect(r.ready).toBe(false);
  expect(() => confirm(f, r)).toThrow("Review each transaction kind");
  r = update(f, r); r = update(f, r, 1); const done = confirm(f, r);
  expect(done.review.result).toMatchObject({ added: 2, skipped: 0, excluded: 0, repeatedFile: false });
  expect(done.review).toMatchObject({ repeatedFile: false, counts: { new: 2, definite: 0, added: 2, skipped: 0 } });
  expect(f.connection.db.select().from(transactionSources).all()).toHaveLength(2);
  expect(confirm(f, r).review).toEqual(done.review);
  expect(readImportReview(f.member, f.sheetId, r.id, f.connection)).toEqual(done.review);
  expect(listTransactions(f.owner, f.sheetId, { batchId: r.id }, f.connection).total).toBe(2);
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
  buildSync({ stdin: { contents: 'import { openDatabase } from "./src/db/client"; import { confirmImportReview } from "./src/imports/review"; const [filename,actor,sheet,batch,version]=process.argv.slice(2); const c=openDatabase(filename); try { process.stdout.write(JSON.stringify(confirmImportReview(actor,sheet,batch,{version:Number(version)},c).review.result)); } finally { c.sqlite.close(); }', resolveDir: process.cwd() }, outfile: worker, bundle: true, platform: "node", format: "cjs", packages: "external" });
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
  expect(() => confirm(f, conflict)).toThrow("Review each"); conflict = update(f, conflict); expect(confirm(f, conflict).review.result?.added).toBe(1);
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
it("keeps account and saved-profile matching scopes separate and retains historical mapping snapshots", () => {
  const f = fixture(); let first = f.review(); first = update(f, first); confirm(f, first);
  const other = f.review("2026-10-04,Shop,-10.00", { ...mapping, profile: "Other source" }); expect(other.rows[0]?.matching.status).toBe("new");
  const profile = listImportProfiles(f.owner, f.sheetId, f.accountId, f.connection).find((p) => p.id === first.profileId); if (!profile) throw new Error("Missing profile.");
  const saved = saveImportProfile(f.owner, f.sheetId, { id: profile.id, version: profile.version, accountId: f.accountId, mapping: { ...mapping, dateFormat: "DD/MM/YYYY" } }, f.connection);
  expect(saved.id).toBe(profile.id); expect(saved.version).toBe(2); expect(readImportReview(f.owner, f.sheetId, first.id, f.connection).mapping.dateFormat).toBe("YYYY-MM-DD");
  expect(() => saveImportProfile(f.owner, f.sheetId, { id: profile.id, version: 1, accountId: f.accountId, mapping }, f.connection)).toThrow("Someone changed");
  mutateSettings(f.owner, f.sheetId, { kind: "create", entity: "account", name: "Other account", sourceType: "bank" }, f.connection);
  const account = readSheet(f.owner, f.sheetId, f.connection).accounts.find((a) => a.id !== f.accountId); if (!account) throw new Error("Missing other account.");
  expect(createImportReview(f.owner, f.sheetId, account.id, bytes("Date,Payee,Amount\n2026-10-04,Shop,-10.00"), mapping, f.connection).rows[0]?.matching.status).toBe("new");
});
it("corrects invalid mapped fields or excludes invalid rows without storing unmapped columns", () => {
  const f = fixture(); let r = createImportReview(f.owner, f.sheetId, f.accountId, bytes("Date,Payee,Amount,Card No.,Category\nwrong,,0,8622,Merchandise\nwrong,,0,8622,Merchandise"), mapping, f.connection);
  expect(r.counts.invalid).toBe(2); expect(() => confirm(f, r)).toThrow("invalid row");
  r = update(f, r, 0, { correction: { Date: "2026-10-04", Payee: "Corrected", Amount: "-1.00" } });
  r = update(f, r, 1, { decision: "exclude" }); expect(confirm(f, r).review.result).toMatchObject({ added: 1, excluded: 1 });
  const stored = f.connection.db.select().from(importRows).all(); expect(JSON.stringify(stored)).not.toContain("8622"); expect(JSON.stringify(stored)).not.toContain("Merchandise");
  expect(JSON.parse(stored[0]?.original ?? "null")).toMatchObject({ status: "invalid", selected: { Date: "wrong", Payee: "", Amount: "0" } });
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
  expect(r.rows[0]).toMatchObject({ decision: "pending", matching: { status: "possible" } }); expect(() => confirm(f, r)).toThrow("choose keep or skip");
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
  const stale = confirm(f, r); expect(stale.kind).toBe("stale"); expect(() => confirm(f, stale.review)).toThrow("active financial account");
  expect(f.connection.db.select().from(transactions).all()).toEqual([]);
});
it("rolls back every ledger/source/link write if a later row fails and keeps the review retryable", () => {
  const f = fixture(); let r = f.review("2026-10-04,Shop,-10.00\n2026-10-05,Second,-2.00"); r = update(f, r); r = update(f, r, 1);
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
  const f = fixture(folder); expect(validateDatabase(f.filename).pendingMigrations).toBe(true);
  const manual = saveTransaction(f.owner, f.sheetId, f.proposal, undefined, f.connection);
  f.connection.db.insert(transactionSources).values({ id: randomUUID(), sheetId: f.sheetId, transactionId: manual.id, accountId: f.accountId, sourceProfile: "legacy", sourceId: "legacy-id", date: "2026-10-04", payee: "Shop", amount: -1000, fingerprint: "legacy", createdAt: new Date() }).run();
  migrateDatabase(f.filename); expect(validateDatabase(f.filename).pendingMigrations).toBe(false);
  expect(() => f.connection.db.update(transactionSources).set({ payee: "Rewritten" }).where(eq(transactionSources.transactionId, manual.id)).run()).toThrow("immutable");
  let r = f.review("2026-10-05,New,-5.00,source-id", { ...mapping, sourceId: "ID" }); r = update(f, r); const result = confirm(f, r).review.result;
  const snapshot = await createSnapshot({ filename: f.filename, backupDirectory: path.join(directory, "backups") });
  const restoredFile = path.join(directory, "restored.sqlite"); await restoreSnapshot(snapshot, { filename: restoredFile, backupDirectory: path.join(directory, "preserved") });
  const restored = openDatabase(restoredFile); connections.push(restored);
  expect(readImportReview(f.owner, f.sheetId, r.id, restored).result).toEqual(result);
  expect(restored.db.select().from(transactionSources).all()).toHaveLength(2);
  const next = createImportReview(f.owner, f.sheetId, f.accountId, bytes("Date,Payee,Amount,ID\n2026-10-05,New,-5.00,source-id\n2026-10-06,Another,-1.00,new-id"), { ...mapping, sourceId: "ID" }, restored);
  expect(next.rows[0]?.matching.status).toBe("definite");
  expect(restored.db.select().from(importProfiles).where(and(eq(importProfiles.sheetId, f.sheetId), eq(importProfiles.id, r.profileId))).get()).toBeDefined();
});
