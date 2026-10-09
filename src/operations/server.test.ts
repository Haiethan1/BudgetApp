import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { buildSync } from "esbuild";
import { expect, it } from "vitest";
import { validateSnapshot } from "./snapshots";
import { startManagedDatabase } from "./startup";

it("drains a real active startup backup on SIGTERM and permits the next startup", async () => {
  const root = path.resolve("operations"); fs.mkdirSync(root, { recursive: true });
  const directory = fs.mkdtempSync(path.join(root, "shutdown-test-"));
  const filename = path.join(directory, "instance.sqlite");
  const backupDirectory = path.join(directory, "backups");
  let child: ReturnType<typeof spawn> | undefined;
  try {
    const executable = path.join(directory, "server.mjs");
    buildSync({ entryPoints: ["src/operations/server.ts"], outfile: executable, bundle: true, platform: "node", format: "esm", packages: "external" });
    const harness = path.join(directory, "harness.mjs");
    fs.writeFileSync(harness, `
      import Database from "better-sqlite3";
      import { runManagedServer } from "./server.mjs";
      let released = false;
      process.on("SIGTERM", () => { released = true; });
      // Windows does not deliver POSIX SIGTERM; dispatch the same Node event via stdin.
      process.stdin.once("data", () => { process.stdin.destroy(); process.emit("SIGTERM"); });
      const original = Database.prototype.backup;
      Database.prototype.backup = function (filename) {
        let announced = false;
        return original.call(this, filename, { progress() {
          if (!announced) { announced = true; process.stdout.write("backup-active\\n"); }
          return released ? 100 : 0;
        }});
      };
      await runManagedServer(["-e", "process.exit(99)"]);
    `);
    child = spawn(process.execPath, [harness], { env: { ...process.env, DATABASE_URL: filename, BACKUP_DIR: backupDirectory }, stdio: ["pipe", "pipe", "pipe"] });
    const running = child;
    let stderr = "";
    running.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    const exit = new Promise<number | null>((resolve, reject) => {
      running.once("exit", resolve); running.once("error", reject);
    });
    await new Promise<void>((resolve, reject) => {
      let output = "";
      running.stdout?.on("data", (chunk: Buffer) => {
        output += chunk.toString(); if (output.includes("backup-active")) resolve();
      });
      running.once("exit", (code) => reject(new Error(`Backup did not start: ${code} ${stderr}`)));
      running.once("error", reject);
    });
    expect(fs.existsSync(`${filename}.operations-lock`)).toBe(true);
    running.stdin?.end("terminate");
    expect(await exit, stderr).toBe(143);
    expect(fs.existsSync(`${filename}.operations-lock`)).toBe(false);
    expect(fs.existsSync(`${filename}.runtime-lock`)).toBe(false);
    const snapshots = fs.readdirSync(backupDirectory);
    expect(snapshots).toHaveLength(1);
    expect(validateSnapshot(path.join(backupDirectory, snapshots[0])).manifest.reason).toBe("daily");
    const restarted = await startManagedDatabase(filename, backupDirectory);
    try { expect(fs.readdirSync(backupDirectory)).toHaveLength(1); }
    finally { await restarted.stop(); }
  } finally {
    if (child && child.exitCode === null) {
      const exited = new Promise<void>((resolve) => child?.once("exit", () => resolve()));
      child.kill(); await exited;
    }
    const target = fs.realpathSync(directory);
    if (path.dirname(target) !== fs.realpathSync(root) || !path.basename(target).startsWith("shutdown-test-")) throw new Error("Unexpected shutdown test directory.");
    fs.rmSync(target, { recursive: true, force: true });
  }
}, 15_000);

it("holds the runtime lease while the server runs and releases it after an unexpected server exit", async () => {
  const root = path.resolve("operations"); fs.mkdirSync(root, { recursive: true });
  const directory = fs.mkdtempSync(path.join(root, "shutdown-test-"));
  const filename = path.join(directory, "instance.sqlite");
  const backupDirectory = path.join(directory, "backups");
  try {
    buildSync({ entryPoints: ["src/operations/server.ts"], outfile: path.join(directory, "server.mjs"), bundle: true, platform: "node", format: "esm", packages: "external" });
    const harness = path.join(directory, "harness.mjs");
    const serverScript = `
      const fs = require("node:fs");
      const filename = process.env.DATABASE_URL;
      if (!fs.existsSync(filename + ".runtime-lock")) process.exit(98);
      if (fs.existsSync(filename + ".operations-lock")) process.exit(97);
      process.exit(37);
    `;
    fs.writeFileSync(harness, `
      import { runManagedServer } from "./server.mjs";
      await runManagedServer(["-e", ${JSON.stringify(serverScript)}]);
    `);
    const child = spawn(process.execPath, [harness], { env: { ...process.env, DATABASE_URL: filename, BACKUP_DIR: backupDirectory }, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once("exit", resolve); child.once("error", reject);
    });
    expect(code, stderr).toBe(37);
    expect(fs.existsSync(`${filename}.runtime-lock`)).toBe(false);
    expect(fs.existsSync(`${filename}.operations-lock`)).toBe(false);
    const restarted = await startManagedDatabase(filename, backupDirectory);
    await restarted.stop();
  } finally {
    const target = fs.realpathSync(directory);
    if (path.dirname(target) !== fs.realpathSync(root) || !path.basename(target).startsWith("shutdown-test-")) throw new Error("Unexpected shutdown test directory.");
    fs.rmSync(target, { recursive: true, force: true });
  }
}, 15_000);
