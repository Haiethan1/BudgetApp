import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { openDatabase } from "../db/client";
import { user } from "../db/schema";
import { createAuth } from "../auth/server";
import { initializeInstance } from "../auth/setup";
import { startManagedDatabase } from "./startup";
import { readBackupStatus } from "./status";
import { handleBackupStatus } from "./http";

const directories: string[] = [];
const runtimes: Awaited<ReturnType<typeof startManagedDatabase>>[] = [];
const connections: ReturnType<typeof openDatabase>[] = [];
afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.stop();
  for (const connection of connections.splice(0)) connection.sqlite.close();
  vi.restoreAllMocks();
  for (const directory of directories.splice(0)) {
    const target = fs.realpathSync(directory);
    if (path.dirname(target) !== fs.realpathSync(os.tmpdir()) || !path.basename(target).startsWith("homebooks-status-")) throw new Error("Unexpected status test directory.");
    fs.rmSync(target, { recursive: true, force: true });
  }
});
function fixture() {
  const directory = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "homebooks-status-")); directories.push(directory);
  return { filename: path.join(directory, "instance.sqlite"), backups: path.join(directory, "backups") };
}
async function start(options: ReturnType<typeof fixture>) {
  const runtime = await startManagedDatabase(options.filename, options.backups); runtimes.push(runtime); return runtime;
}
it("publishes validated status across processes, rejects stale or stopped status, and distrusts damaged snapshots", async () => {
  const options = fixture(); const runtime = await start(options);
  const status = readBackupStatus(options.filename);
  expect(status).toMatchObject({ kind: "available", running: false, lastCheck: "succeeded", lastFailure: null });
  expect(JSON.stringify(status)).not.toContain(options.filename);
  expect(readBackupStatus(options.filename, new Date(Date.now() + 180_000))).toEqual({ kind: "unavailable" });
  const success = runtime.scheduler.getStatus().lastSuccess;
  if (!success) throw new Error("Missing daily snapshot.");
  fs.appendFileSync(path.join(success.directory, "database.sqlite"), "damaged");
  expect(readBackupStatus(options.filename)).toMatchObject({ kind: "available", lastSuccess: null });
  await runtime.stop();
  expect(readBackupStatus(options.filename)).toEqual({ kind: "unavailable" });
});
it("reports a blocked backup destination separately from status storage and preserves failure history after restart", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const options = fixture(); fs.writeFileSync(options.backups, "private storage failure");
  const first = await start(options);
  const failed = readBackupStatus(options.filename);
  expect(failed).toMatchObject({ kind: "available", lastCheck: "failed", lastSuccess: null });
  if (failed.kind !== "available" || !failed.lastFailure || !failed.nextRun) throw new Error("Missing retry status.");
  expect(Date.parse(failed.nextRun) - Date.parse(failed.lastFailure)).toBe(300_000);
  expect(fs.readFileSync(`${options.filename}.backup-status.json`, "utf8")).not.toContain("ENOTDIR");
  await first.stop(); fs.unlinkSync(options.backups);
  await start(options);
  expect(readBackupStatus(options.filename)).toMatchObject({ kind: "available", lastCheck: "succeeded", lastFailure: failed.lastFailure });
  const raw: unknown = JSON.parse(fs.readFileSync(`${options.filename}.backup-status.json`, "utf8"));
  const replaced = { ...(typeof raw === "object" && raw !== null ? raw : {}), token: "previous-runtime" };
  fs.writeFileSync(`${options.filename}.backup-status.json`, JSON.stringify(replaced));
  expect(readBackupStatus(options.filename)).toEqual({ kind: "unavailable" });
});
it("allows an admin without sheets, denies anonymous and regular users, and rechecks a removed admin grant", async () => {
  const options = fixture(); await start(options);
  const connection = openDatabase(options.filename); connections.push(connection);
  const config = { origin: "http://localhost:3000", secret: "test-only-secret-with-at-least-thirty-two-characters", setupToken: "test-only-setup-with-at-least-thirty-two-characters", registrationEnabled: true };
  const identity = { name: "Admin", username: "adminstatus", email: "adminstatus@example.test", password: "status-test-password" };
  await initializeInstance({ ...identity, setupToken: config.setupToken }, config, connection);
  const auth = createAuth(connection, config);
  async function authRequest(endpoint: string, body: unknown) {
    return auth.handler(new Request(`${config.origin}/api/auth/${endpoint}`, { method: "POST", headers: { origin: config.origin, "content-type": "application/json" }, body: JSON.stringify(body) }));
  }
  const adminLogin = await authRequest("sign-in/email", { email: identity.email, password: identity.password });
  expect(adminLogin.status).toBe(200);
  const cookie = (response: Response) => response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
  const request = (value?: string) => new Request(`${config.origin}/api/admin/backups`, { headers: value ? { cookie: value } : {} });
  const dependencies = { auth, connection, filename: options.filename };
  expect((await handleBackupStatus(request(), dependencies)).status).toBe(401);
  const allowed = await handleBackupStatus(request(cookie(adminLogin)), dependencies);
  expect(allowed.status).toBe(200); expect(allowed.headers.get("cache-control")).toBe("no-store");
  const body: unknown = await allowed.json();
  expect(body).toMatchObject({ kind: "available", lastCheck: "succeeded" });
  expect(JSON.stringify(body)).not.toContain(options.backups);
  const member = { ...identity, username: "memberstatus", email: "memberstatus@example.test" };
  expect((await authRequest("sign-up/email", member)).status).toBe(200);
  const memberLogin = await authRequest("sign-in/email", { email: member.email, password: member.password });
  expect((await handleBackupStatus(request(cookie(memberLogin)), dependencies)).status).toBe(403);
  connection.db.update(user).set({ isInstanceAdmin: false }).where(eq(user.username, identity.username)).run();
  expect((await handleBackupStatus(request(cookie(adminLogin)), dependencies)).status).toBe(403);
});
