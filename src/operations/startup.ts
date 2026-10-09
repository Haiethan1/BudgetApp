import fs from "node:fs";
import path from "node:path";
import { defaultDatabaseUrl } from "../db/client";
import { migrateDatabase } from "../db/migrate";
import { acquireLease } from "./lease";
import { createSnapshotUnderLease, validateDatabase } from "./snapshots";
import { createDailyBackupScheduler } from "./scheduler";

export async function startDatabase(filename = process.env.DATABASE_URL ?? defaultDatabaseUrl,
  backupDirectory = process.env.BACKUP_DIR ?? path.join(process.cwd(), "backups"), migrationsFolder = path.join(process.cwd(), "drizzle")) {
  const runtime = acquireLease(filename, "runtime");
  let operations: ReturnType<typeof acquireLease> | undefined;
  try {
    operations = acquireLease(runtime.database, "operations");
    if (fs.existsSync(runtime.database) && fs.statSync(runtime.database).size > 0) {
      const state = validateDatabase(runtime.database, migrationsFolder);
      if (state.pendingMigrations) await createSnapshotUnderLease({ filename: runtime.database, backupDirectory, migrationsFolder }, "pre-upgrade");
    }
    migrateDatabase(runtime.database, migrationsFolder);
    operations.release(); operations = undefined;
    return runtime;
  } catch (error) { operations?.release(); runtime.release(); throw error; }
}

export async function startManagedDatabase(filename = process.env.DATABASE_URL ?? defaultDatabaseUrl,
  backupDirectory = process.env.BACKUP_DIR ?? path.join(process.cwd(), "backups"), migrationsFolder = path.join(process.cwd(), "drizzle")) {
  const runtime = await startDatabase(filename, backupDirectory, migrationsFolder);
  const scheduler = createDailyBackupScheduler({ filename: runtime.database, backupDirectory, migrationsFolder });
  try { await scheduler.start(); }
  catch (error) { await scheduler.stop(); runtime.release(); throw error; }
  return { ...runtime, scheduler, async stop() { await scheduler.stop(); runtime.release(); } };
}
