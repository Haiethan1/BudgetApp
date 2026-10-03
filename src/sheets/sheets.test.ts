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
