import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import Database from "better-sqlite3";
import { buildSync } from "esbuild";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { openDatabase } from "../db/client";
import { migrateDatabase } from "../db/migrate";
import { createAuth } from "../auth/server";
import { initializeInstance } from "../auth/setup";
import { createSheet } from "../sheets/service";
import { sheetMembers, user } from "../db/schema";
import { acquireLease } from "./lease";
import { createSnapshot, exportSnapshot, restoreSnapshot, validateDatabase, validateSnapshot } from "./snapshots";
import { startDatabase } from "./startup";

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true }); });
function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "homebooks-backup-")); directories.push(directory);
  const filename = path.join(directory, "source.sqlite"); migrateDatabase(filename);
  return { directory, filename, backupDirectory: path.join(directory, "backups") };
}
function bytes(filename: string) {
  return ["", "-wal", "-shm"].map((suffix) => fs.existsSync(`${filename}${suffix}`) ? createHash("sha256").update(fs.readFileSync(`${filename}${suffix}`)).digest("hex") : undefined);
}

function migrationFixture(directory: string, name: string, ending: "lf" | "crlf" | "mixed-final", count?: number) {
  const folder = path.join(directory, name);
  fs.cpSync("drizzle", folder, { recursive: true });
  const journalFile = path.join(folder, "meta/_journal.json");
  const journal = z.object({ entries: z.array(z.object({ tag: z.string() }).passthrough()) }).passthrough()
    .parse(JSON.parse(fs.readFileSync(journalFile, "utf8")));
  if (count !== undefined) journal.entries = journal.entries.slice(0, count);
  fs.writeFileSync(journalFile, JSON.stringify(journal));
  for (const entry of journal.entries) {
    const filename = path.join(folder, `${entry.tag}.sql`);
    const lf = fs.readFileSync(filename, "utf8").replace(/\r\n/g, "\n");
    const sql = ending === "crlf" ? lf.replace(/\n/g, "\r\n")
      : ending === "mixed-final" && lf.endsWith("\n") ? lf.slice(0, -1) + "\r\n" : lf;
    fs.writeFileSync(filename, sql);
  }
  return folder;
}

describe("validated database recovery", () => {
  it.each(["lf", "crlf", "mixed-final"] as const)("validates %s migration bytes across checkouts without rewriting history", (ending) => {
    const options = fixture();
    const source = migrationFixture(options.directory, "source-migrations", ending);
    const other = migrationFixture(options.directory, "other-migrations", ending === "crlf" ? "lf" : "crlf");
    const filename = path.join(options.directory, "cross-checkout.sqlite");
    migrateDatabase(filename, source);
    const sqlite = new Database(filename);
    try { sqlite.pragma("journal_mode = DELETE"); } finally { sqlite.close(); }
    const original = bytes(filename);
    expect(validateDatabase(filename, other)).toEqual(validateDatabase(filename, source));
    expect(bytes(filename)).toEqual(original);
  });

  it("rejects unknown hashes, changed timestamps, reordered history, future migrations and altered schema", () => {
    const options = fixture();
    for (const mutation of ["hash", "timestamp", "order", "future", "schema"]) {
      const filename = path.join(options.directory, `${mutation}.sqlite`);
      fs.copyFileSync(options.filename, filename);
      const sqlite = new Database(filename);
      try {
        if (mutation === "hash") sqlite.prepare("UPDATE __drizzle_migrations SET hash = ? WHERE rowid = 1").run("0".repeat(64));
        if (mutation === "timestamp") sqlite.exec("UPDATE __drizzle_migrations SET created_at = created_at + 1 WHERE rowid = 1");
        if (mutation === "order") sqlite.exec("UPDATE __drizzle_migrations SET id = -rowid");
        if (mutation === "future") sqlite.exec("INSERT INTO __drizzle_migrations(hash, created_at) VALUES('future', 9999999999999)");
        if (mutation === "schema") sqlite.exec("CREATE TABLE unexpected_data(value TEXT)");
      } finally { sqlite.close(); }
      expect(() => validateDatabase(filename)).toThrow(mutation === "schema" ? "Database schema is incompatible" : "Database migrations are incompatible");
    }
  });

  it("rejects changed migration content even when the resulting schema is identical", () => {
    const options = fixture();
    const folder = migrationFixture(options.directory, "changed-content", "lf");
    fs.appendFileSync(path.join(folder, "0000_foundation.sql"), "\n-- different migration content\n");
    const filename = path.join(options.directory, "changed.sqlite");
    migrateDatabase(filename, folder);
    expect(() => validateDatabase(filename)).toThrow("Database migrations are incompatible");
  });

  it("backs up and restores a mixed-checkout pending upgrade with original manifest hashes", async () => {
    const options = fixture();
    const oldFolder = migrationFixture(options.directory, "old-migrations", "lf", 11);
    for (const name of fs.readdirSync(oldFolder).filter((name) => name.endsWith(".sql"))) {
      const filename = path.join(oldFolder, name);
      const lf = fs.readFileSync(filename, "utf8");
      if (name < "0008") fs.writeFileSync(filename, lf.replace(/\n/g, "\r\n"));
      if (name.startsWith("0009") && lf.endsWith("\n")) fs.writeFileSync(filename, lf.slice(0, -1) + "\r\n");
    }
    const currentFolder = migrationFixture(options.directory, "current-migrations", "crlf");
    const filename = path.join(options.directory, "old.sqlite");
    migrateDatabase(filename, oldFolder);
    const original = validateDatabase(filename, currentFolder);
    expect(original.pendingMigrations).toBe(true);
    const runtime = await startDatabase(filename, options.backupDirectory, currentFolder);
    runtime.release();
    expect(validateDatabase(filename, currentFolder).pendingMigrations).toBe(false);
    const name = fs.readdirSync(options.backupDirectory).find((name) => name.startsWith("pre-upgrade-"));
    if (!name) throw new Error("Pre-upgrade snapshot missing.");
    const snapshot = path.join(options.backupDirectory, name);
    expect(validateSnapshot(snapshot, currentFolder).manifest.migrations).toEqual(original.migrations);
    const target = path.join(options.directory, "restored.sqlite");
    await restoreSnapshot(snapshot, { ...options, filename: target, migrationsFolder: currentFolder });
    expect(validateDatabase(target, currentFolder)).toEqual(original);
    const restoredRuntime = await startDatabase(target, options.backupDirectory, currentFolder);
    restoredRuntime.release();
    expect(validateDatabase(target, currentFolder).pendingMigrations).toBe(false);
    expect(fs.readdirSync(options.backupDirectory).filter((name) => name.startsWith("pre-upgrade-"))).toHaveLength(2);
    const manifestFile = path.join(snapshot, "manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
    manifest.migrations[0].hash = "0".repeat(64);
    fs.writeFileSync(manifestFile, JSON.stringify(manifest));
    expect(() => validateSnapshot(snapshot, currentFolder)).toThrow("Snapshot metadata does not match");
  });

  it("takes a consistent live WAL snapshot, publishes metadata together, and exports a validated bundle", async () => {
    const options = fixture();
    const live = openDatabase(options.filename);
    live.sqlite.pragma("wal_autocheckpoint = 0");
    try {
      live.sqlite.prepare("INSERT INTO foundation_records(key,value,created_at) VALUES(?,?,?)").run("wal-only", "committed", Date.now());
      expect(fs.existsSync(`${options.filename}-wal`)).toBe(true);
      const snapshot = await createSnapshot(options);
      const validated = validateSnapshot(snapshot);
      const sqlite = new Database(validated.filename, { readonly: true });
      try { expect(sqlite.prepare("SELECT value FROM foundation_records WHERE key='wal-only'").get()).toEqual({ value: "committed" }); }
      finally { sqlite.close(); }
      expect(fs.readdirSync(snapshot).sort()).toEqual(["database.sqlite", "manifest.json"]);
      const exported = exportSnapshot(snapshot, path.join(options.directory, "exported"));
      expect(validateSnapshot(exported).manifest.databaseDigest).toBe(validated.manifest.databaseDigest);
      expect(fs.readdirSync(options.backupDirectory).some((name) => name.includes("staging"))).toBe(false);
    } finally { live.sqlite.close(); }
  });

  it("restores users, credentials, sheets, membership and defaults into a fresh database while requiring new sign-in", async () => {
    const options = fixture(); const source = openDatabase(options.filename);
    const config = { origin: "http://localhost:3000", secret: "restore-test-secret-with-at-least-thirty-two-characters",
      setupToken: "restore-test-token-with-at-least-thirty-two-characters", registrationEnabled: true };
    try {
      const admin = await initializeInstance({ name: "Admin", username: "admin", email: "admin@example.test", password: "restore-long-password", setupToken: config.setupToken }, config, source);
      source.db.insert(user).values({ id: "member-fixture", name: "Member", email: "member@example.test", username: "member", createdAt: new Date(), updatedAt: new Date() }).run();
      const sheet = createSheet(admin.id, { name: "Known sheet", currency: "USD" }, source).sheet;
      source.db.insert(sheetMembers).values({ sheetId: sheet.id, userId: "member-fixture", acceptedAt: new Date() }).run();
      const auth = createAuth(source, config);
      const login = await auth.handler(new Request(`${config.origin}/api/auth/sign-in/email`, { method: "POST",
        headers: { origin: config.origin, "content-type": "application/json", "x-forwarded-for": "203.0.113.21" }, body: JSON.stringify({ email: "admin@example.test", password: "restore-long-password" }) }));
      expect(login.status).toBe(200);
      const cookie = login.headers.getSetCookie().map((item) => item.split(";")[0]).join("; ");
      const snapshot = await createSnapshot(options);
      const target = path.join(options.directory, "fresh-volume", "restored.sqlite");
      await restoreSnapshot(snapshot, { ...options, filename: target });
      const restored = openDatabase(target);
      try {
        expect(restored.sqlite.prepare("SELECT name,currency FROM sheets").all()).toEqual([{ name: "Known sheet", currency: "USD" }]);
        expect(restored.sqlite.prepare("SELECT user_id FROM sheet_members").all()).toEqual([{ user_id: "member-fixture" }]);
        expect(restored.sqlite.prepare("SELECT name FROM categories").all()).toEqual([{ name: "Uncategorized" }]);
        expect(restored.sqlite.prepare("SELECT name FROM buckets").all()).toEqual([{ name: "Unassigned" }]);
        expect(restored.sqlite.prepare("SELECT count(*) AS count FROM session").get()).toEqual({ count: 0 });
        const restoredAuth = createAuth(restored, config);
        expect(await (await restoredAuth.handler(new Request(`${config.origin}/api/auth/get-session`, { headers: { cookie } }))).json()).toBeNull();
        expect((await restoredAuth.handler(new Request(`${config.origin}/api/auth/sign-in/email`, { method: "POST",
          headers: { origin: config.origin, "content-type": "application/json", "x-forwarded-for": "203.0.113.22" }, body: JSON.stringify({ email: "admin@example.test", password: "restore-long-password" }) }))).status).toBe(200);
      } finally { restored.sqlite.close(); }
    } finally { source.sqlite.close(); }
  });

  it("rejects corrupted, foreign and incompatible bundles before touching target database or WAL sidecars", async () => {
    const options = fixture(); const snapshot = await createSnapshot(options);
    const target = path.join(options.directory, "target.sqlite"); migrateDatabase(target);
    const targetConnection = openDatabase(target);
    try {
      targetConnection.sqlite.prepare("INSERT INTO foundation_records(key,value,created_at) VALUES('keep','unchanged',1)").run();
      const original = bytes(target);
      for (const mutation of ["checksum", "application", "schema"]) {
        const candidate = path.join(options.directory, mutation); fs.cpSync(snapshot, candidate, { recursive: true });
        if (mutation === "checksum") fs.appendFileSync(path.join(candidate, "database.sqlite"), "corruption");
        else {
          const manifest = JSON.parse(fs.readFileSync(path.join(candidate, "manifest.json"), "utf8"));
          if (mutation === "application") manifest.application = "other-app";
          else manifest.schemaDigest = "0".repeat(64);
          fs.writeFileSync(path.join(candidate, "manifest.json"), JSON.stringify(manifest));
        }
        await expect(restoreSnapshot(candidate, { ...options, filename: target })).rejects.toThrow();
        expect(bytes(target)).toEqual(original);
      }
    } finally { targetConnection.sqlite.close(); }
  });

  it("rejects a live WAL overlay even when the hashed main file is unchanged", async () => {
    const options = fixture(); const snapshot = await createSnapshot(options);
    const filename = path.join(snapshot, "database.sqlite");
    const writer = new Database(filename);
    const target = path.join(options.directory, "target.sqlite"); migrateDatabase(target);
    const targetConnection = openDatabase(target);
    try {
      writer.pragma("journal_mode = WAL");
      writer.pragma("wal_autocheckpoint = 0");
      writer.pragma("wal_checkpoint(TRUNCATE)");
      const manifest = JSON.parse(fs.readFileSync(path.join(snapshot, "manifest.json"), "utf8"));
      manifest.databaseDigest = createHash("sha256").update(fs.readFileSync(filename)).digest("hex");
      fs.writeFileSync(path.join(snapshot, "manifest.json"), JSON.stringify(manifest));
      writer.prepare("INSERT INTO foundation_records(key,value,created_at) VALUES('overlay','only-in-WAL',1)").run();
      expect(createHash("sha256").update(fs.readFileSync(filename)).digest("hex")).toBe(manifest.databaseDigest);
      expect(fs.statSync(`${filename}-wal`).size).toBeGreaterThan(0);
      expect(writer.prepare("SELECT value FROM foundation_records WHERE key='overlay'").get()).toEqual({ value: "only-in-WAL" });
      targetConnection.sqlite.prepare("INSERT INTO foundation_records(key,value,created_at) VALUES('keep','unchanged',1)").run();
      const original = bytes(target);
      expect(() => validateSnapshot(snapshot)).toThrow("sidecars are not allowed");
      const destination = path.join(options.directory, "refused-export");
      expect(() => exportSnapshot(snapshot, destination)).toThrow("sidecars are not allowed");
      expect(fs.existsSync(destination)).toBe(false);
      await expect(restoreSnapshot(snapshot, { ...options, filename: target })).rejects.toThrow("sidecars are not allowed");
      expect(bytes(target)).toEqual(original);
    } finally { writer.close(); targetConnection.sqlite.close(); }
    const offlineManifest = JSON.parse(fs.readFileSync(path.join(snapshot, "manifest.json"), "utf8"));
    offlineManifest.databaseDigest = createHash("sha256").update(fs.readFileSync(filename)).digest("hex");
    fs.writeFileSync(path.join(snapshot, "manifest.json"), JSON.stringify(offlineManifest));
    expect(() => validateSnapshot(snapshot)).toThrow("offline rollback-journal format");
    expect(fs.readdirSync(snapshot).sort()).toEqual(["database.sqlite", "manifest.json"]);
    // Every recognized sidecar is forbidden, including a leftover rollback journal.
    for (const suffix of ["-wal", "-shm", "-journal"]) {
      const sidecar = `${filename}${suffix}`; fs.writeFileSync(sidecar, "untrusted sidecar");
      expect(() => validateSnapshot(snapshot)).toThrow("sidecars are not allowed");
      fs.unlinkSync(sidecar);
    }
  });

  it("preserves unreadable existing database and sidecars before replacing them", async () => {
    const options = fixture(); const snapshot = await createSnapshot(options);
    const target = path.join(options.directory, "broken.sqlite");
    fs.writeFileSync(target, "unreadable existing database"); fs.writeFileSync(`${target}-wal`, "old WAL bytes"); fs.writeFileSync(`${target}-shm`, "old SHM bytes");
    const restored = await restoreSnapshot(snapshot, { ...options, filename: target });
    expect(restored.preserved).toBeDefined();
    if (!restored.preserved) throw new Error("Existing database was not preserved.");
    expect(fs.readFileSync(path.join(restored.preserved, "database.sqlite"), "utf8")).toBe("unreadable existing database");
    expect(fs.readFileSync(path.join(restored.preserved, "database.sqlite-wal"), "utf8")).toBe("old WAL bytes");
    expect(fs.existsSync(`${target}-wal`)).toBe(false); expect(fs.existsSync(`${target}-shm`)).toBe(false);
    expect(validateDatabase(target).pendingMigrations).toBe(false);
  });

  it("excludes live runtime and concurrent operations, reuses lock files and rejects legacy directories", async () => {
    const options = fixture(); const snapshot = await createSnapshot(options);
    const runtime = await startDatabase(options.filename, options.backupDirectory);
    try {
      await expect(restoreSnapshot(snapshot, options)).rejects.toThrow("runtime lease exists");
      expect(validateSnapshot(await createSnapshot(options)).manifest.application).toBe("homebooks");
      await expect(startDatabase(options.filename, options.backupDirectory)).rejects.toThrow("runtime lease exists");
    } finally { runtime.release(); }
    const pending = createSnapshot(options);
    await expect(restoreSnapshot(snapshot, options)).rejects.toThrow("operations lease exists");
    await pending;
    const lock = acquireLease(options.filename, "operations");
    try { await expect(createSnapshot(options)).rejects.toThrow("operations lease exists"); }
    finally { lock.release(); }
    await restoreSnapshot(snapshot, options);
    fs.unlinkSync(`${options.filename}.runtime-lock`);
    fs.mkdirSync(`${options.filename}.runtime-lock`);
    await expect(restoreSnapshot(snapshot, options)).rejects.toThrow("Legacy database lease directory exists");
    fs.rmdirSync(`${options.filename}.runtime-lock`);
  });

  it("snapshots a known older schema prefix before applying an upgrade", async () => {
    const options = fixture();
    const folder = path.join(options.directory, "old-migrations"); fs.mkdirSync(path.join(folder, "meta"), { recursive: true });
    const journal = JSON.parse(fs.readFileSync("drizzle/meta/_journal.json", "utf8")); journal.entries = journal.entries.slice(0, 1);
    fs.writeFileSync(path.join(folder, "meta/_journal.json"), JSON.stringify(journal));
    fs.copyFileSync("drizzle/0000_foundation.sql", path.join(folder, "0000_foundation.sql"));
    const older = path.join(options.directory, "older.sqlite"); migrateDatabase(older, folder);
    expect(validateDatabase(older).pendingMigrations).toBe(true);
    const runtime = await startDatabase(older, options.backupDirectory);
    try {
      expect(validateDatabase(older).pendingMigrations).toBe(false);
      const snapshot = fs.readdirSync(options.backupDirectory).find((name) => name.startsWith("pre-upgrade-"));
      if (!snapshot) throw new Error("Pre-upgrade snapshot missing.");
      expect(validateSnapshot(path.join(options.backupDirectory, snapshot)).manifest.migrations).toHaveLength(1);
    } finally { runtime.release(); }
  });

  it("runs the compiled native ESM create/export/restore commands", async () => {
    const options = fixture();
    const operationRoot = path.join(process.cwd(), "operations"); fs.mkdirSync(operationRoot, { recursive: true });
    const directory = fs.mkdtempSync(path.join(operationRoot, "backup-test-")); directories.push(directory);
    const executable = path.join(directory, "backup.mjs");
    buildSync({ entryPoints: ["scripts/backup.ts"], outfile: executable, bundle: true, platform: "node", format: "esm", packages: "external" });
    const env = { ...process.env, DATABASE_URL: options.filename, BACKUP_DIR: options.backupDirectory };
    const created = spawnSync(process.execPath, [executable, "create"], { env, encoding: "utf8" });
    expect(created.status, created.stderr).toBe(0);
    const snapshot = created.stdout.trim();
    const exported = path.join(options.directory, "cli-export");
    expect(spawnSync(process.execPath, [executable, "export", snapshot, exported], { env, encoding: "utf8" }).status).toBe(0);
    const restored = spawnSync(process.execPath, [executable, "restore", exported], { env: { ...env, DATABASE_URL: path.join(options.directory, "cli-restored.sqlite") }, encoding: "utf8" });
    expect(restored.status, restored.stderr).toBe(0);
    expect(validateDatabase(path.join(options.directory, "cli-restored.sqlite")).pendingMigrations).toBe(false);
  });
});
