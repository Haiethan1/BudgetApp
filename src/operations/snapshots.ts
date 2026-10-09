import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { z } from "zod";
import { acquireLease, databasePath } from "./lease";

const migrationSchema = z.object({ hash: z.string().regex(/^[a-f0-9]{64}$/), when: z.number().int() });
const manifestSchema = z.object({ format: z.literal(1), application: z.literal("homebooks"),
  createdAt: z.iso.datetime(), reason: z.enum(["manual", "daily", "pre-upgrade", "pre-restore"]),
  migrations: z.array(migrationSchema).min(1), schemaDigest: z.string().regex(/^[a-f0-9]{64}$/),
  databaseDigest: z.string().regex(/^[a-f0-9]{64}$/) });
const journalSchema = z.object({ entries: z.array(z.object({ tag: z.string().regex(/^[a-zA-Z0-9_-]+$/), when: z.number().int() })) });
type Reason = z.infer<typeof manifestSchema>["reason"];
type Options = { filename: string; backupDirectory: string; migrationsFolder?: string };
const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

function knownMigrations(migrationsFolder = path.join(process.cwd(), "drizzle")) {
  const journal = journalSchema.parse(JSON.parse(fs.readFileSync(path.join(migrationsFolder, "meta/_journal.json"), "utf8")));
  return journal.entries.map((entry) => {
    const sql = fs.readFileSync(path.join(migrationsFolder, `${entry.tag}.sql`), "utf8");
    return { hash: digest(sql), when: entry.when, sql };
  });
}

function schemaDigest(sqlite: Database.Database) {
  return digest(JSON.stringify(sqlite.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name != '__drizzle_migrations' ORDER BY type,name").all()));
}

export function validateDatabase(filename: string, migrationsFolder?: string) {
  const sqlite = new Database(filename, { readonly: true, fileMustExist: true });
  try {
    if (sqlite.pragma("integrity_check", { simple: true }) !== "ok") throw new Error("Snapshot integrity check failed.");
    if (z.array(z.unknown()).parse(sqlite.pragma("foreign_key_check")).length !== 0) throw new Error("Snapshot foreign-key check failed.");
    const migrations = z.array(z.object({ hash: z.string(), created_at: z.number().int() })).parse(
      sqlite.prepare("SELECT hash,created_at FROM __drizzle_migrations ORDER BY id").all());
    const known = knownMigrations(migrationsFolder);
    if (!migrations.length || migrations.length > known.length || migrations.some((entry, index) => entry.hash !== known[index].hash || entry.created_at !== known[index].when)) {
      throw new Error("Database migrations are incompatible with this application.");
    }
    const expected = new Database(":memory:");
    let expectedDigest: string;
    try {
      for (const entry of known.slice(0, migrations.length)) expected.exec(entry.sql);
      expectedDigest = schemaDigest(expected);
    } finally { expected.close(); }
    const actualDigest = schemaDigest(sqlite);
    if (actualDigest !== expectedDigest) throw new Error("Database schema is incompatible with this application.");
    return { migrations: migrations.map((entry) => ({ hash: entry.hash, when: entry.created_at })), schemaDigest: actualDigest,
      pendingMigrations: known.length > migrations.length };
  } finally { sqlite.close(); }
}

export function validateSnapshot(directory: string, migrationsFolder?: string) {
  const files = fs.readdirSync(directory).sort();
  if (JSON.stringify(files) !== JSON.stringify(["database.sqlite", "manifest.json"])) {
    throw new Error("Snapshot must be an offline bundle containing only database.sqlite and manifest.json; database sidecars are not allowed.");
  }
  const manifest = manifestSchema.parse(JSON.parse(fs.readFileSync(path.join(directory, "manifest.json"), "utf8")));
  const filename = path.join(directory, "database.sqlite");
  const database = fs.readFileSync(filename);
  if (digest(database) !== manifest.databaseDigest) throw new Error("Snapshot checksum mismatch.");
  // SQLite header bytes 18/19 select write/read format: 1 is rollback, 2 is WAL.
  // Reject WAL before opening so validation cannot create its own sidecars.
  if (database[18] !== 1 || database[19] !== 1) throw new Error("Snapshot database must use offline rollback-journal format.");
  const result = validateDatabase(filename, migrationsFolder);
  if (result.schemaDigest !== manifest.schemaDigest || JSON.stringify(result.migrations) !== JSON.stringify(manifest.migrations)) {
    throw new Error("Snapshot metadata does not match its database.");
  }
  return { filename, manifest };
}

function removeStaging(directory: string) {
  for (const name of ["database.sqlite", "database.sqlite-wal", "database.sqlite-shm", "database.sqlite-journal", "manifest.json"]) {
    fs.rmSync(path.join(directory, name), { force: true });
  }
  fs.rmdirSync(directory);
}

// Caller holds the per-database operations lease; startup/restore use this to avoid nested leases.
export async function createSnapshotUnderLease(options: Options, reason: Reason, createdAt = new Date()) {
  fs.mkdirSync(options.backupDirectory, { recursive: true, mode: 0o700 });
  const name = `${reason}-${createdAt.toISOString().replace(/[:.]/g, "-")}-${randomUUID()}`;
  const staging = path.join(options.backupDirectory, `.${name}.staging`);
  const final = path.join(options.backupDirectory, name);
  fs.mkdirSync(staging, { mode: 0o700 });
  let source: Database.Database | undefined;
  try {
    source = new Database(options.filename, { readonly: true, fileMustExist: true });
    const filename = path.join(staging, "database.sqlite");
    await source.backup(filename);
    const copied = new Database(filename, { fileMustExist: true });
    try { copied.pragma("journal_mode = DELETE"); } finally { copied.close(); }
    fs.chmodSync(filename, 0o600);
    const result = validateDatabase(filename, options.migrationsFolder);
    const manifest = { format: 1, application: "homebooks", createdAt: createdAt.toISOString(), reason,
      migrations: result.migrations, schemaDigest: result.schemaDigest, databaseDigest: digest(fs.readFileSync(filename)) };
    fs.writeFileSync(path.join(staging, "manifest.json"), JSON.stringify(manifest, null, 2), { mode: 0o600, flag: "wx" });
    validateSnapshot(staging, options.migrationsFolder);
    fs.renameSync(staging, final);
    return final;
  } catch (error) { removeStaging(staging); throw error; }
  finally { source?.close(); }
}

export async function createSnapshot(options: Options) {
  const lease = acquireLease(options.filename, "operations");
  try { return await createSnapshotUnderLease({ ...options, filename: lease.database }, "manual"); }
  finally { lease.release(); }
}

export function exportSnapshot(directory: string, destination: string, migrationsFolder?: string) {
  validateSnapshot(directory, migrationsFolder);
  const absolute = path.resolve(destination);
  if (fs.existsSync(absolute)) throw new Error("Export destination already exists.");
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  const staging = fs.mkdtempSync(path.join(path.dirname(absolute), ".homebooks-export-"));
  fs.chmodSync(staging, 0o700);
  try {
    for (const name of ["database.sqlite", "manifest.json"]) {
      fs.copyFileSync(path.join(directory, name), path.join(staging, name));
      fs.chmodSync(path.join(staging, name), 0o600);
    }
    validateSnapshot(staging, migrationsFolder);
    fs.renameSync(staging, absolute);
  } catch (error) { removeStaging(staging); throw error; }
  return absolute;
}

export async function restoreSnapshot(directory: string, options: Options) {
  const runtime = acquireLease(options.filename, "runtime");
  let operations: ReturnType<typeof acquireLease> | undefined;
  let staging: string | undefined;
  try {
    operations = acquireLease(runtime.database, "operations");
    const candidate = validateSnapshot(directory, options.migrationsFolder);
    const filename = databasePath(options.filename);
    if (fs.realpathSync(candidate.filename) === filename) throw new Error("The restore source cannot be the target database.");
    // Offline preservation also works when the existing database is unreadable.
    let preserved: string | undefined;
    if (fs.existsSync(filename)) {
      fs.mkdirSync(options.backupDirectory, { recursive: true, mode: 0o700 });
      preserved = path.join(options.backupDirectory, `preserved-before-restore-${randomUUID()}`);
      fs.mkdirSync(preserved, { mode: 0o700 });
      const components: { name: string; digest: string }[] = [];
      for (const suffix of ["", "-wal", "-shm", "-journal"]) {
        if (fs.existsSync(`${filename}${suffix}`)) {
          const name = `database.sqlite${suffix}`;
          fs.copyFileSync(`${filename}${suffix}`, path.join(preserved, name));
          fs.chmodSync(path.join(preserved, name), 0o600);
          components.push({ name, digest: digest(fs.readFileSync(path.join(preserved, name))) });
        }
      }
      fs.writeFileSync(path.join(preserved, "preservation.json"), JSON.stringify({ application: "homebooks",
        kind: "offline-preservation", createdAt: new Date().toISOString(), components }, null, 2), { mode: 0o600 });
    }
    staging = `${filename}.restore-${randomUUID()}`;
    fs.copyFileSync(candidate.filename, staging);
    const restored = new Database(staging, { fileMustExist: true });
    try {
      restored.pragma("journal_mode = DELETE");
      if (restored.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='session'").get()) restored.exec("DELETE FROM session");
    } finally { restored.close(); }
    validateDatabase(staging, options.migrationsFolder);
    // Preserve raw offline components until replacement succeeds. No live file is copied.
    const rollback = `${filename}.pre-restore-${randomUUID()}`;
    fs.mkdirSync(rollback, { mode: 0o700 });
    const moved: string[] = [];
    try {
      for (const suffix of ["", "-wal", "-shm", "-journal"]) {
        if (fs.existsSync(`${filename}${suffix}`)) {
          fs.renameSync(`${filename}${suffix}`, path.join(rollback, `database${suffix}`)); moved.push(suffix);
        }
      }
      fs.renameSync(staging, filename); staging = undefined;
    } catch (error) {
      for (const suffix of moved.reverse()) fs.renameSync(path.join(rollback, `database${suffix}`), `${filename}${suffix}`);
      fs.rmdirSync(rollback); throw error;
    }
    for (const suffix of moved) fs.unlinkSync(path.join(rollback, `database${suffix}`));
    fs.rmdirSync(rollback);
    return { filename, preserved };
  } finally {
    if (staging) fs.rmSync(staging, { force: true });
    operations?.release(); runtime.release();
  }
}
