import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { buildSync } from "esbuild";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "../db/client";
import { migrateDatabase } from "../db/migrate";
import { account, instanceSetup, session, user } from "../db/schema";
import { createAuth } from "./server";
import { type AuthConfig } from "./config";
import { handleSetup, initializeInstance } from "./setup";
import { recoverPassword } from "./recovery";

const config: AuthConfig = { origin: "http://localhost:3000", secret: "test-only-secret-with-at-least-thirty-two-characters",
  setupToken: "test-only-setup-with-at-least-thirty-two-characters", registrationEnabled: true };
const identity = { name: "First admin", username: "First_Admin", email: "admin@example.test", password: "long-test-password" };
const connections: ReturnType<typeof openDatabase>[] = [];
const directories: string[] = [];
afterEach(() => { for (const connection of connections.splice(0)) connection.sqlite.close();
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true }); });
function database() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "homebooks-auth-"));
  directories.push(directory);
  const filename = path.join(directory, "auth.sqlite");
  migrateDatabase(filename);
  const connection = openDatabase(filename);
  connections.push(connection);
  return { connection, filename };
}
let requestNumber = 0;
function request(endpoint: string, body?: unknown, cookie?: string) {
  return new Request(`${config.origin}/api/auth${endpoint}`, { method: body ? "POST" : "GET",
    headers: { origin: config.origin, "content-type": "application/json", "x-forwarded-for": `192.0.2.${++requestNumber}`, ...(cookie ? { cookie } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}) });
}
function cookie(response: Response) { return response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; "); }

describe("instance authentication", () => {
  it("executes the compiled native ESM recovery command and revokes established sessions", async () => {
    const { connection, filename } = database();
    await initializeInstance({ ...identity, setupToken: config.setupToken }, config, connection);
    const auth = createAuth(connection, config);
    const login = await auth.handler(request("/sign-in/email", { email: identity.email, password: identity.password }));
    expect(login.status).toBe(200);
    const operations = path.join(process.cwd(), "operations");
    fs.mkdirSync(operations, { recursive: true });
    const directory = fs.mkdtempSync(path.join(operations, "recovery-test-"));
    directories.push(directory);
    const executable = path.join(directory, "recover-password.mjs");
    buildSync({ entryPoints: ["scripts/recover-password.ts"], outfile: executable,
      bundle: true, platform: "node", format: "esm", packages: "external" });
    const result = spawnSync(process.execPath, [executable, "first_admin"], {
      env: { ...process.env, DATABASE_URL: filename }, input: "compiled-new-password\n", encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("All sessions for this user were revoked.");
    expect(`${result.stdout}${result.stderr}`).not.toContain("compiled-new-password");
    expect(connection.db.select().from(session).all()).toEqual([]);
    expect(await (await auth.handler(request("/get-session", undefined, cookie(login)))).json()).toBeNull();
    expect((await auth.handler(request("/sign-in/email", { email: identity.email, password: "compiled-new-password" }))).status).toBe(200);
    expect((await auth.handler(request("/sign-in/email", { email: identity.email, password: identity.password }))).status).toBe(401);
  });
  it("blocks direct signup before setup and creates exactly one admin across concurrent setup requests", async () => {
    const { connection, filename } = database();
    const auth = createAuth(connection, config);
    expect((await auth.handler(request("/sign-up/email", identity))).status).toBe(403);
    const second = openDatabase(filename); connections.push(second);
    const results = await Promise.allSettled([
      initializeInstance({ ...identity, setupToken: config.setupToken }, config, connection),
      initializeInstance({ ...identity, username: "otheradmin", email: "other@example.test", setupToken: config.setupToken }, config, second),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(connection.db.select().from(user).all()).toHaveLength(1);
    expect(connection.db.select().from(account).all()).toHaveLength(1);
    expect(connection.db.select().from(instanceSetup).all()).toHaveLength(1);
    expect(connection.db.select().from(user).get()?.isInstanceAdmin).toBe(true);
  });

  it("rejects wrong tokens and foreign/missing origins without writing users", async () => {
    const { connection } = database();
    await expect(initializeInstance({ ...identity, setupToken: "wrong" }, config, connection)).rejects.toThrow("token is invalid");
    for (const origin of [undefined, "http://foreign.test"]) {
      const response = await handleSetup(new Request(`${config.origin}/api/setup`, { method: "POST",
        headers: { "content-type": "application/json", ...(origin ? { origin } : {}) },
        body: JSON.stringify({ ...identity, setupToken: config.setupToken }) }), config, connection);
      expect(response.status).toBe(403);
    }
    expect(connection.db.select().from(user).all()).toEqual([]);
  });

  it("rolls back bootstrap if a credential write fails", async () => {
    const { connection } = database();
    connection.sqlite.exec("CREATE TRIGGER fail_credential BEFORE INSERT ON account BEGIN SELECT RAISE(ABORT, 'test failure'); END");
    await expect(initializeInstance({ ...identity, setupToken: config.setupToken }, config, connection)).rejects.toThrow();
    expect(connection.db.select().from(user).all()).toEqual([]);
    expect(connection.db.select().from(instanceSetup).all()).toEqual([]);
  });

  it("enforces configured registration, required username, and server-owned admin flag through direct endpoints", async () => {
    const { connection } = database();
    await initializeInstance({ ...identity, setupToken: config.setupToken }, config, connection);
    const disabled = createAuth(connection, { ...config, registrationEnabled: false });
    const member = { ...identity, name: "Household member", username: "member", email: "member@example.test", isInstanceAdmin: true };
    expect((await disabled.handler(request("/sign-up/email", member))).status).toBe(403);
    const auth = createAuth(connection, config);
    expect((await auth.handler(request("/sign-up/email", { ...member, username: undefined }))).status).toBe(400);
    expect((await auth.handler(request("/sign-up/email", member))).status).toBe(200);
    expect(connection.db.select().from(user).where(eq(user.username, "member")).get()?.isInstanceAdmin).toBe(false);
    const login = await auth.handler(request("/sign-in/username", { username: "member", password: member.password }));
    expect(login.status).toBe(200);
    expect((await auth.handler(request("/update-user", { isInstanceAdmin: true, name: "Updated" }, cookie(login)))).status).toBe(400);
    expect(connection.db.select().from(user).where(eq(user.username, "member")).get()?.isInstanceAdmin).toBe(false);
  });

  it("handles signup races using unique identity constraints", async () => {
    const { connection } = database();
    await initializeInstance({ ...identity, setupToken: config.setupToken }, config, connection);
    const auth = createAuth(connection, config);
    const member = { ...identity, username: "member", email: "member@example.test" };
    const results = await Promise.all([auth.handler(request("/sign-up/email", member)), auth.handler(request("/sign-up/email", member))]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    const created = connection.db.select().from(user).where(eq(user.username, "member")).all();
    expect(created).toHaveLength(1);
    expect(connection.db.select().from(account).where(eq(account.userId, created[0].id)).all()).toHaveLength(1);
  });

  it("signs in by email and username, rejects unauthorized/expired sessions, and revokes sessions during recovery", async () => {
    const { connection, filename } = database();
    await initializeInstance({ ...identity, setupToken: config.setupToken }, config, connection);
    const auth = createAuth(connection, config);
    expect(await (await auth.handler(request("/get-session"))).json()).toBeNull();
    const email = await auth.handler(request("/sign-in/email", { email: identity.email, password: identity.password }));
    expect(email.status).toBe(200);
    const byUsername = await auth.handler(request("/sign-in/username", { username: "FIRST_ADMIN", password: identity.password }));
    expect(byUsername.status).toBe(200);
    const before = await (await auth.handler(request("/get-session", undefined, cookie(email)))).json();
    expect(before.user.name).toBe("First admin");
    await recoverPassword("first_admin", "new-long-test-password", connection);
    expect(connection.db.select().from(session).all()).toEqual([]);
    expect(await (await auth.handler(request("/get-session", undefined, cookie(email)))).json()).toBeNull();
    expect((await auth.handler(request("/sign-in/email", { email: identity.email, password: identity.password }))).status).toBe(401);
    const login = await auth.handler(request("/sign-in/email", { email: identity.email, password: "new-long-test-password" }));
    expect(login.status).toBe(200);
    connection.db.update(session).set({ expiresAt: new Date(0) }).run();
    expect(await (await auth.handler(request("/get-session", undefined, cookie(login)))).json()).toBeNull();
    const cli = spawnSync(process.execPath, ["--import", "tsx", "scripts/recover-password.ts", "first_admin"], {
      cwd: process.cwd(), env: { ...process.env, DATABASE_URL: filename }, input: "cli-new-long-password\n", encoding: "utf8" });
    expect(cli.status, cli.stderr).toBe(0);
    expect(cli.stdout).not.toContain("cli-new-long-password");
    expect((await auth.handler(request("/sign-in/email", { email: identity.email, password: "cli-new-long-password" }))).status).toBe(200);
  });
});
