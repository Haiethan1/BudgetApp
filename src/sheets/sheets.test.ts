import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { createAuth } from "../auth/server";
import { initializeInstance } from "../auth/setup";
import { type AuthConfig } from "../auth/config";
import { openDatabase } from "../db/client";
import { migrateDatabase } from "../db/migrate";
import { buckets, categories, sheetMembers, sheets, user } from "../db/schema";
import { handleSheetRequest } from "./http";
import { activeOrganization } from "./settings";
import { accessibleSelection, createSheet, listSheets, readSheet, requireSheetAccess, requireSheetReferences } from "./service";

const config: AuthConfig = { origin: "http://localhost:3000", secret: "sheet-test-secret-with-thirty-two-characters",
  setupToken: "sheet-test-token-with-thirty-two-characters", registrationEnabled: true };
const connections: ReturnType<typeof openDatabase>[] = [];
const directories: string[] = [];
afterEach(() => { for (const connection of connections.splice(0)) connection.sqlite.close();
  for (const directory of directories.splice(0)) fs.rmSync(directory, { force: true, recursive: true }); });
let ip = 100;
async function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "homebooks-sheets-")); directories.push(directory);
  const filename = path.join(directory, "sheets.sqlite"); migrateDatabase(filename);
  const connection = openDatabase(filename); connections.push(connection);
  const adminIdentity = { name: "Admin", username: "admin", email: "admin@example.test", password: "test-long-password" };
  await initializeInstance({ ...adminIdentity, setupToken: config.setupToken }, config, connection);
  const auth = createAuth(connection, config);
  async function login(username: string) {
    const identity = { name: username, username, email: `${username}@example.test`, password: "test-long-password" };
    const headers = { origin: config.origin, "content-type": "application/json", "x-forwarded-for": `198.51.100.${++ip}` };
    if (username !== "admin") expect((await auth.handler(new Request(`${config.origin}/api/auth/sign-up/email`, {
      method: "POST", headers, body: JSON.stringify(identity) }))).status).toBe(200);
    const response = await auth.handler(new Request(`${config.origin}/api/auth/sign-in/username`, {
      method: "POST", headers, body: JSON.stringify({ username, password: identity.password }) }));
    expect(response.status).toBe(200);
    const cookie = response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
    const found = connection.db.select().from(user).where(eq(user.username, username)).get();
    if (!found) throw new Error("Test login did not create a user.");
    return { id: found.id, cookie };
  }
  const [admin, alice, bob] = await Promise.all([login("admin"), login("alice"), login("bob")]);
  return { connection, auth, admin, alice, bob, dependencies: { connection, auth, origin: config.origin } };
}
function request(cookie?: string, body?: unknown, origin = config.origin) {
  return new Request(`${config.origin}/api/sheets`, { method: body ? "POST" : "GET",
    headers: { origin, "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}) });
}

describe("sheet authorization and creation", () => {
  it("creates protected defaults atomically and derives owner from the authenticated actor", async () => {
    const { connection, alice, bob, dependencies } = await fixture();
    const response = await handleSheetRequest(request(alice.cookie, { name: "  Personal  ", currency: "USD", ownerId: bob.id }), { kind: "create" }, dependencies);
    expect(response.status).toBe(201);
    const created = connection.db.select().from(sheets).get();
    expect(created?.name).toBe("Personal"); expect(created?.currency).toBe("USD"); expect(created?.ownerId).toBe(alice.id);
    expect(connection.db.select().from(categories).all().map((row) => [row.name, row.isProtected, row.isArchived])).toEqual([["Uncategorized", true, false]]);
    expect(connection.db.select().from(buckets).all().map((row) => [row.name, row.isProtected, row.isArchived])).toEqual([["Unassigned", true, false]]);
    expect(connection.db.select().from(sheetMembers).all()).toEqual([]);
    expect(response.headers.get("set-cookie")).toContain("HttpOnly; SameSite=Lax");
  });

  it("rejects unauthorized, guessed-ID and administrator requests without leaking unrelated sheets", async () => {
    const { connection, alice, bob, admin, dependencies } = await fixture();
    const personal = createSheet(alice.id, { name: "Alice private", currency: "USD" }, connection).sheet;
    const other = createSheet(bob.id, { name: "Bob private", currency: "EUR" }, connection).sheet;
    expect((await handleSheetRequest(request(), { kind: "list" }, dependencies)).status).toBe(401);
    expect((await handleSheetRequest(request(undefined, { name: "No session", currency: "USD" }), { kind: "create" }, dependencies)).status).toBe(401);
    expect((await handleSheetRequest(request(alice.cookie), { kind: "read", sheetId: other.id }, dependencies)).status).toBe(404);
    expect((await handleSheetRequest(request(admin.cookie), { kind: "read", sheetId: personal.id }, dependencies)).status).toBe(404);
    expect((await handleSheetRequest(request(bob.cookie), { kind: "read", sheetId: randomUUID() }, dependencies)).status).toBe(404);
    expect(await (await handleSheetRequest(request(admin.cookie), { kind: "list" }, dependencies)).json()).toEqual({ sheets: [] });
    expect(listSheets(alice.id, connection).map((sheet) => sheet.name)).toEqual(["Alice private"]);
  });

  it("rejects foreign-origin mutations and invalid input with no partial sheet", async () => {
    const { connection, alice, dependencies } = await fixture();
    expect((await handleSheetRequest(request(alice.cookie, { name: "Unsafe", currency: "USD" }, "http://foreign.test"), { kind: "create" }, dependencies)).status).toBe(403);
    expect((await handleSheetRequest(request(alice.cookie, { name: " ", currency: "XYZ" }), { kind: "create" }, dependencies)).status).toBe(400);
    expect(connection.db.select().from(sheets).all()).toEqual([]);
    connection.sqlite.exec("CREATE TRIGGER fail_default BEFORE INSERT ON buckets BEGIN SELECT RAISE(ABORT, 'test rollback'); END");
    expect((await handleSheetRequest(request(alice.cookie, { name: "Rollback", currency: "USD" }), { kind: "create" }, dependencies)).status).toBe(500);
    expect(connection.db.select().from(sheets).all()).toEqual([]);
    expect(connection.db.select().from(categories).all()).toEqual([]);
    expect(connection.db.select().from(buckets).all()).toEqual([]);
  });

  it("rechecks accepted membership on every operation and drops revoked remembered selection", async () => {
    const { connection, alice, bob, dependencies } = await fixture();
    const shared = createSheet(alice.id, { name: "Shared", currency: "USD" }, connection).sheet;
    const personal = createSheet(bob.id, { name: "Personal", currency: "USD" }, connection).sheet;
    connection.db.insert(sheetMembers).values({ sheetId: shared.id, userId: bob.id, acceptedAt: new Date() }).run();
    expect(requireSheetAccess({ userId: bob.id, sheetId: shared.id }, connection).role).toBe("member");
    expect(() => requireSheetAccess({ userId: bob.id, sheetId: shared.id, ownerOnly: true }, connection)).toThrow("Only the sheet owner");
    const selected = await handleSheetRequest(request(bob.cookie), { kind: "select", sheetId: shared.id }, dependencies);
    expect(selected.status).toBe(200);
    expect(selected.headers.get("set-cookie")).toContain(shared.id);
    connection.db.delete(sheetMembers).where(eq(sheetMembers.userId, bob.id)).run();
    expect((await handleSheetRequest(request(bob.cookie), { kind: "read", sheetId: shared.id }, dependencies)).status).toBe(404);
    expect((await handleSheetRequest(request(bob.cookie), { kind: "select", sheetId: shared.id }, dependencies)).status).toBe(404);
    expect(accessibleSelection(bob.id, shared.id, connection)?.id).toBe(personal.id);
    expect(accessibleSelection(alice.id, personal.id, connection)?.id).toBe(shared.id);
    expect(() => connection.db.insert(sheetMembers).values({ sheetId: shared.id, userId: alice.id, acceptedAt: new Date() }).run()).toThrow();
  });

  it("rejects cross-sheet category and attribution references even when the actor owns both sheets", async () => {
    const { connection, alice } = await fixture();
    const first = createSheet(alice.id, { name: "First", currency: "USD" }, connection).sheet;
    const second = createSheet(alice.id, { name: "Second", currency: "USD" }, connection).sheet;
    const firstData = readSheet(alice.id, first.id, connection);
    const secondData = readSheet(alice.id, second.id, connection);
    expect(() => requireSheetReferences({ userId: alice.id, sheetId: first.id,
      references: [{ kind: "category", id: firstData.categories[0].id }, { kind: "bucket", id: firstData.buckets[0].id }] }, connection)).not.toThrow();
    for (const references of [[{ kind: "category", id: secondData.categories[0].id }] as const,
      [{ kind: "bucket", id: secondData.buckets[0].id }] as const]) {
      expect(() => requireSheetReferences({ userId: alice.id, sheetId: first.id, references: [...references] }, connection)).toThrow("does not belong");
    }
  });
});

describe("organization Settings", () => {
  it("creates accounts as accepted members, validates source/name, reserves archived names, and retains rows on restore", async () => {
    const { connection, alice, bob, dependencies } = await fixture();
    const sheet = createSheet(alice.id, { name: "Shared", currency: "USD" }, connection).sheet;
    connection.db.insert(sheetMembers).values({ sheetId: sheet.id, userId: bob.id, acceptedAt: new Date() }).run();
    async function change(input: unknown, cookie = bob.cookie) { return handleSheetRequest(request(cookie, input), { kind: "settings", sheetId: sheet.id }, dependencies); }
    expect((await change({ kind: "create", entity: "account", name: "  Checking  ", sourceType: "bank" })).status).toBe(200);
    const account = readSheet(alice.id, sheet.id, connection).accounts[0];
    expect(account).toMatchObject({ name: "Checking", sourceType: "bank", isArchived: false });
    if (!account) throw new Error("Missing test account");
    expect((await change({ kind: "create", entity: "account", name: "checking", sourceType: "cash" })).status).toBe(409);
    expect((await change({ kind: "create", entity: "account", name: " ", sourceType: "bank" })).status).toBe(400);
    expect((await change({ kind: "create", entity: "account", name: "Bad", sourceType: "invalid" })).status).toBe(400);
    expect((await change({ kind: "create", entity: "account", name: "Bad" })).status).toBe(400);
    expect((await change({ kind: "create", entity: "account", name: "x".repeat(81), sourceType: "bank" })).status).toBe(400);
    expect((await change({ kind: "archive", entity: "account", id: account.id })).status).toBe(200);
    expect(activeOrganization(alice.id, sheet.id, connection).accounts).toEqual([]);
    expect(readSheet(alice.id, sheet.id, connection).accounts[0]?.name).toBe("Checking");
    expect(() => requireSheetReferences({ userId: alice.id, sheetId: sheet.id, references: [{ kind: "account", id: account.id }] }, connection)).toThrow("active");
    expect((await change({ kind: "create", entity: "account", name: "CHECKING", sourceType: "other" })).status).toBe(409);
    expect((await change({ kind: "restore", entity: "account", id: account.id })).status).toBe(200);
    expect(activeOrganization(alice.id, sheet.id, connection).accounts.map((row) => row.id)).toEqual([account.id]);
    expect((await change({ kind: "rename", entity: "account", id: account.id, name: "Household checking" })).status).toBe(200);
    expect(readSheet(alice.id, sheet.id, connection).accounts[0]?.name).toBe("Household checking");
    connection.sqlite.exec("CREATE TABLE account_history (account_id TEXT REFERENCES financial_accounts(id), description TEXT NOT NULL)");
    connection.sqlite.prepare("INSERT INTO account_history VALUES (?, ?)").run(account.id, "Prior purchase");
    expect((await change({ kind: "archive", entity: "account", id: account.id })).status).toBe(200);
    expect(connection.sqlite.prepare("SELECT description, name FROM account_history JOIN financial_accounts ON account_id = id").get()).toEqual({ description: "Prior purchase", name: "Household checking" });
    for (const entity of ["category", "bucket"] satisfies ("category" | "bucket")[]) {
      expect((await change({ kind: "create", entity, name: "Household" })).status).toBe(200);
      const organization = readSheet(alice.id, sheet.id, connection);
      const item = (entity === "category" ? organization.categories : organization.buckets).find((row) => row.name === "Household");
      if (!item) throw new Error("Missing organization item");
      expect((await change({ kind: "archive", entity, id: item.id })).status).toBe(200);
      expect(() => requireSheetReferences({ userId: alice.id, sheetId: sheet.id, references: [{ kind: entity, id: item.id }] }, connection)).toThrow("active");
      expect((await change({ kind: "restore", entity, id: item.id })).status).toBe(200);
      expect((await change({ kind: "rename", entity, id: item.id, name: "Renamed" })).status).toBe(200);
    }
    connection.sqlite.exec("CREATE TRIGGER fail_account BEFORE INSERT ON financial_accounts BEGIN SELECT RAISE(ABORT, 'failed save'); END");
    expect((await change({ kind: "create", entity: "account", name: "Failure", sourceType: "cash" })).status).toBe(500);
    expect(readSheet(alice.id, sheet.id, connection).accounts).toHaveLength(1);
  });

  it("protects defaults, rejects other-sheet mutations even for a common owner, and rechecks revoked access", async () => {
    const { connection, alice, bob, admin, dependencies } = await fixture();
    const first = createSheet(alice.id, { name: "First", currency: "USD" }, connection).sheet;
    const other = createSheet(alice.id, { name: "Other", currency: "USD" }, connection).sheet;
    const current = readSheet(alice.id, first.id, connection);
    for (const entity of ["category", "bucket"] satisfies ("category" | "bucket")[]) {
      const row = entity === "category" ? current.categories[0] : current.buckets[0];
      if (!row) throw new Error("Missing default");
      for (const kind of ["rename", "archive"] ) {
        expect((await handleSheetRequest(request(alice.cookie, { kind, entity, id: row.id, name: "Changed" }), { kind: "settings", sheetId: first.id }, dependencies)).status).toBe(400);
      }
      expect((await handleSheetRequest(request(alice.cookie, { kind: "rename", entity, id: row.id, name: "Foreign" }), { kind: "settings", sheetId: other.id }, dependencies)).status).toBe(404);
      expect((await handleSheetRequest(request(alice.cookie, { kind: "create", entity, name: "  Family  " }), { kind: "settings", sheetId: first.id }, dependencies)).status).toBe(200);
      expect((await handleSheetRequest(request(alice.cookie, { kind: "create", entity, name: "ＦＡＭＩＬＹ" }), { kind: "settings", sheetId: first.id }, dependencies)).status).toBe(409);
    }
    for (const cookie of [undefined, bob.cookie, admin.cookie]) {
      expect((await handleSheetRequest(request(cookie, { kind: "create", entity: "category", name: "Intruder" }), { kind: "settings", sheetId: first.id }, dependencies)).status).toBe(cookie ? 404 : 401);
    }
    connection.db.insert(sheetMembers).values({ sheetId: first.id, userId: bob.id, acceptedAt: new Date() }).run();
    expect((await handleSheetRequest(request(bob.cookie, { kind: "create", entity: "bucket", name: "Bob" }), { kind: "settings", sheetId: first.id }, dependencies)).status).toBe(200);
    connection.db.delete(sheetMembers).where(eq(sheetMembers.userId, bob.id)).run();
    expect((await handleSheetRequest(request(bob.cookie, { kind: "create", entity: "bucket", name: "Again" }), { kind: "settings", sheetId: first.id }, dependencies)).status).toBe(404);
    expect((await handleSheetRequest(request(alice.cookie, { kind: "create", entity: "category", name: "Forged" }, "https://foreign.test"), { kind: "settings", sheetId: first.id }, dependencies)).status).toBe(403);
    expect(readSheet(alice.id, first.id, connection).categories.map((row) => row.name).sort()).toEqual(["Family", "Uncategorized"]);
  });

  it("restricts sheet rename/delete to owners, requires exact deletion confirmation, and changes only the actor profile", async () => {
    const { connection, alice, bob, dependencies } = await fixture();
    const sheet = createSheet(alice.id, { name: "Shared", currency: "USD" }, connection).sheet;
    connection.db.insert(sheetMembers).values({ sheetId: sheet.id, userId: bob.id, acceptedAt: new Date() }).run();
    for (const input of [{ kind: "renameSheet", name: "Hijacked" }, { kind: "deleteSheet", confirmation: "Shared" }]) {
      expect((await handleSheetRequest(request(bob.cookie, input), { kind: "settings", sheetId: sheet.id }, dependencies)).status).toBe(403);
    }
    expect((await handleSheetRequest(request(alice.cookie, { kind: "renameSheet", name: "New name", currency: "EUR", ownerId: bob.id }), { kind: "settings", sheetId: sheet.id }, dependencies)).status).toBe(200);
    expect(readSheet(alice.id, sheet.id, connection)).toMatchObject({ name: "New name", currency: "USD", role: "owner" });
    expect((await handleSheetRequest(request(alice.cookie, { kind: "deleteSheet", confirmation: "Shared" }), { kind: "settings", sheetId: sheet.id }, dependencies)).status).toBe(400);
    expect((await handleSheetRequest(request(alice.cookie, { name: "  Alice Home  ", userId: bob.id, isInstanceAdmin: true }), { kind: "profile" }, dependencies)).status).toBe(200);
    expect(connection.db.select().from(user).where(eq(user.id, alice.id)).get()).toMatchObject({ name: "Alice Home", isInstanceAdmin: false });
    expect(connection.db.select().from(user).where(eq(user.id, bob.id)).get()?.name).toBe("bob");
    expect((await dependencies.auth.api.getSession({ headers: request(alice.cookie).headers }))?.user.name).toBe("Alice Home");
    expect((await handleSheetRequest(request(alice.cookie, { name: " " }), { kind: "profile" }, dependencies)).status).toBe(400);
    expect((await handleSheetRequest(request(alice.cookie, { kind: "deleteSheet", confirmation: "New name" }), { kind: "settings", sheetId: sheet.id }, dependencies)).status).toBe(200);
    expect(connection.db.select().from(categories).where(eq(categories.sheetId, sheet.id)).all()).toEqual([]);
    expect(connection.db.select().from(buckets).where(eq(buckets.sheetId, sheet.id)).all()).toEqual([]);
    expect(connection.db.select().from(sheetMembers).where(eq(sheetMembers.sheetId, sheet.id)).all()).toEqual([]);
  });
});
