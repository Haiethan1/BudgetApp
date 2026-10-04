import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, expect, it } from "vitest";
import { openDatabase } from "../db/client";
import { migrateDatabase } from "../db/migrate";
import { financialAccounts, sheetMembers, splits, transactions, user } from "../db/schema";
import { createAuth } from "../auth/server";
import { initializeInstance } from "../auth/setup";
import { createSheet, readSheet } from "../sheets/service";
import { mutateSettings } from "../sheets/settings";
import { mappingSchema } from "./csv";
import { inspectImport, previewImport } from "./service";
import { handleImportPreview } from "./http";

const connections: ReturnType<typeof openDatabase>[] = [];
const directories: string[] = [];
afterEach(() => {
  for (const connection of connections.splice(0)) connection.sqlite.close();
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});
const csv = new TextEncoder().encode("Date,Payee,Amount\n2026-10-04,Shop,-12.34\n2026-10-05,Refund,2.00\nwrong,,0");
const mapping = mappingSchema.parse({ version: 1, profile: "Explicit test profile", date: "Date", payee: "Payee", dateFormat: "YYYY-MM-DD", decimalSeparator: ".", money: { mode: "signed", amount: "Amount", outflowSign: "negative" } });
function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "homebooks-import-")); directories.push(directory);
  const filename = path.join(directory, "test.sqlite"); migrateDatabase(filename);
  const connection = openDatabase(filename); connections.push(connection);
  const ownerId = randomUUID(); const memberId = randomUUID(); const strangerId = randomUUID();
  for (const id of [ownerId, memberId, strangerId]) connection.db.insert(user).values({ id, name: id, email: `${id}@example.test`, updatedAt: new Date() }).run();
  const sheetId = createSheet(ownerId, { name: "Sample", currency: "USD" }, connection).sheet.id;
  connection.db.insert(sheetMembers).values({ sheetId, userId: memberId, acceptedAt: new Date() }).run();
  mutateSettings(ownerId, sheetId, { kind: "create", entity: "account", name: "Card", sourceType: "credit_card" }, connection);
  const sheet = readSheet(ownerId, sheetId, connection); const account = sheet.accounts[0];
  if (!account) throw new Error("Missing test account.");
  return { connection, ownerId, memberId, strangerId, sheetId, accountId: account.id, sheet };
}
it("previews normalized rows with real sheet defaults and no financial writes", () => {
  const f = fixture();
  const before = f.connection.sqlite.prepare("SELECT total_changes() AS changes").get();
  const result = previewImport(f.ownerId, f.sheetId, f.accountId, csv, mapping, f.connection);
  expect(result.validCount).toBe(2); expect(result.invalidCount).toBe(1);
  expect(result.rows[0]).toMatchObject({ proposed: { accountId: f.accountId, splits: [{ categoryId: f.sheet.categories[0]?.id, bucketId: f.sheet.buckets[0]?.id, amount: "-12.34" }] } });
  expect(f.connection.db.select().from(transactions).all()).toEqual([]);
  expect(f.connection.db.select().from(splits).all()).toEqual([]);
  expect(f.connection.sqlite.prepare("SELECT total_changes() AS changes").get()).toEqual(before);
  expect(inspectImport(f.ownerId, f.sheetId, f.accountId, csv, f.connection)).toMatchObject({ headers: ["Date", "Payee", "Amount"], rowCount: 3 });
});
it("binds previews to caller, sheet, account, file, and versioned mapping", () => {
  const f = fixture();
  const preview = (actor = f.ownerId, data = csv, config = mapping) => previewImport(actor, f.sheetId, f.accountId, data, config, f.connection);
  expect(preview().previewKey).toBe(preview().previewKey);
  expect(preview().previewKey).not.toBe(preview(f.memberId).previewKey);
  expect(preview().previewKey).not.toBe(preview(f.ownerId, new TextEncoder().encode("Date,Payee,Amount\n2026-10-04,Shop,-13.00")).previewKey);
  expect(preview().previewKey).not.toBe(preview(f.ownerId, csv, { ...mapping, profile: "Another profile" }).previewKey);
  expect(preview().normalizedFileHash).toBe(preview(f.ownerId, new TextEncoder().encode(new TextDecoder().decode(csv).replaceAll("\n", "\r\n"))).normalizedFileHash);
  mutateSettings(f.ownerId, f.sheetId, { kind: "create", entity: "account", name: "Checking", sourceType: "bank" }, f.connection);
  const another = readSheet(f.ownerId, f.sheetId, f.connection).accounts.find((item) => item.id !== f.accountId);
  if (!another) throw new Error("Missing second account.");
  expect(preview().previewKey).not.toBe(previewImport(f.ownerId, f.sheetId, another.id, csv, mapping, f.connection).previewKey);
});
it("rejects unrelated users, foreign/archived accounts, and revoked membership", () => {
  const f = fixture();
  expect(() => previewImport(f.strangerId, f.sheetId, f.accountId, csv, mapping, f.connection)).toThrow("unavailable");
  const foreign = createSheet(f.ownerId, { name: "Other", currency: "USD" }, f.connection).sheet.id;
  expect(() => previewImport(f.ownerId, foreign, f.accountId, csv, mapping, f.connection)).toThrow("active financial account");
  expect(previewImport(f.memberId, f.sheetId, f.accountId, csv, mapping, f.connection).validCount).toBe(2);
  f.connection.db.delete(sheetMembers).where(eq(sheetMembers.userId, f.memberId)).run();
  expect(() => previewImport(f.memberId, f.sheetId, f.accountId, csv, mapping, f.connection)).toThrow("unavailable");
  f.connection.db.update(financialAccounts).set({ isArchived: true }).where(eq(financialAccounts.id, f.accountId)).run();
  expect(() => inspectImport(f.ownerId, f.sheetId, f.accountId, csv, f.connection)).toThrow("active financial account");
});
it("serves authenticated multipart inspection and preview with origin and upload checks", async () => {
  const f = fixture();
  const config = { origin: "http://localhost:3000", secret: "import-test-secret-with-thirty-two-characters", setupToken: "import-test-token-with-thirty-two-characters", registrationEnabled: false };
  // First setup requires an empty auth database, so use the generated instance admin
  // only for authentication and give it explicit sheet membership.
  const cleanDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "homebooks-import-auth-")); directories.push(cleanDirectory);
  const filename = path.join(cleanDirectory, "auth.sqlite"); migrateDatabase(filename);
  const connection = openDatabase(filename); connections.push(connection);
  await initializeInstance({ name: "Admin", username: "admin", email: "admin@example.test", password: "import-long-password", setupToken: config.setupToken }, config, connection);
  const auth = createAuth(connection, config);
  const signedIn = await auth.handler(new Request(`${config.origin}/api/auth/sign-in/username`, { method: "POST", headers: { origin: config.origin, "content-type": "application/json" }, body: JSON.stringify({ username: "admin", password: "import-long-password" }) }));
  expect(signedIn.status).toBe(200);
  const cookie = signedIn.headers.getSetCookie().map((item) => item.split(";")[0]).join("; ");
  const admin = connection.db.select().from(user).where(eq(user.username, "admin")).get();
  if (!admin) throw new Error("Missing authenticated admin.");
  f.connection.db.insert(user).values({ id: admin.id, name: "Admin", email: "admin@example.test", updatedAt: new Date() }).run();
  f.connection.db.insert(sheetMembers).values({ sheetId: f.sheetId, userId: admin.id, acceptedAt: new Date() }).run();
  const dependencies = { auth, connection: f.connection, origin: config.origin };
  function upload(includeMapping = true, origin = config.origin, authenticated = true) {
    const form = new FormData(); form.set("file", new File([csv], "sample.csv")); form.set("accountId", f.accountId);
    if (includeMapping) form.set("mapping", JSON.stringify(mapping));
    return new Request(`${config.origin}/api/sheets/${f.sheetId}/imports/preview`, { method: "POST", headers: { origin, ...(authenticated ? { cookie } : {}) }, body: form });
  }
  expect((await handleImportPreview(upload(true, config.origin, false), f.sheetId, dependencies)).status).toBe(401);
  expect((await handleImportPreview(upload(true, "http://other.test"), f.sheetId, dependencies)).status).toBe(403);
  const inspected = await handleImportPreview(upload(false), f.sheetId, dependencies);
  expect(inspected.status).toBe(200); expect(await inspected.json()).toMatchObject({ rowCount: 3 });
  const previewed = await handleImportPreview(upload(), f.sheetId, dependencies);
  expect(previewed.status).toBe(200); expect(previewed.headers.get("cache-control")).toBe("no-store");
  expect(await previewed.json()).toMatchObject({ validCount: 2, invalidCount: 1 });
  const oversized = new Request(`${config.origin}/api/sheets`, { method: "POST", headers: { origin: config.origin, cookie, "content-type": "multipart/form-data; boundary=test" }, body: new Uint8Array(2 * 1024 * 1024 + 65537) });
  expect((await handleImportPreview(oversized, f.sheetId, dependencies)).status).toBe(413);
  f.connection.db.delete(sheetMembers).where(eq(sheetMembers.userId, admin.id)).run();
  expect((await handleImportPreview(upload(), f.sheetId, dependencies)).status).toBe(404);
  expect(f.connection.db.select().from(transactions).all()).toEqual([]);
});
