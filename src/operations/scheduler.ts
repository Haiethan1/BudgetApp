import fs from "node:fs";
import path from "node:path";
import { acquireLease } from "./lease";
import { createSnapshotUnderLease, validateSnapshot } from "./snapshots";

const retryDelay = 5 * 60_000;
const day = 24 * 60 * 60_000;
type Options = Parameters<typeof createSnapshotUnderLease>[0];
type DailySnapshot = { directory: string; createdAt: string };
type Failure = { at: string; message: string };
export type SchedulerStatus = { running: boolean; lastCheck: "pending" | "succeeded" | "failed"; lastSuccess: DailySnapshot | null; lastFailure: Failure | null; nextRun: string | null };

function dailySnapshots(options: Options): DailySnapshot[] {
  const root = fs.realpathSync(options.backupDirectory);
  const snapshots: DailySnapshot[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^daily-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[a-f0-9-]{36}$/.test(entry.name)) continue;
    const directory = path.join(root, entry.name);
    // Never follow links or junctions during automatic deletion, including bundle files.
    if (fs.lstatSync(directory).isSymbolicLink() || fs.realpathSync(directory) !== directory) continue;
    if (!["database.sqlite", "manifest.json"].every((name) => {
      const file = path.join(directory, name);
      return fs.existsSync(file) && fs.lstatSync(file).isFile() && !fs.lstatSync(file).isSymbolicLink();
    })) continue;
    try {
      const { manifest } = validateSnapshot(directory, options.migrationsFolder);
      if (manifest.reason === "daily" && entry.name.startsWith(`daily-${manifest.createdAt.replace(/[:.]/g, "-")}-`)) {
        snapshots.push({ directory, createdAt: manifest.createdAt });
      }
    } catch { /* Invalid or foreign bundles belong to the operator, never retention. */ }
  }
  return snapshots.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function pruneDailySnapshots(options: Options, snapshots: DailySnapshot[]) {
  const root = fs.realpathSync(options.backupDirectory);
  for (const snapshot of snapshots.slice(14)) {
    // Recheck the resolved absolute target immediately before deleting only known files.
    const target = fs.realpathSync(snapshot.directory);
    if (target !== snapshot.directory || path.dirname(target) !== root || fs.lstatSync(target).isSymbolicLink()) {
      throw new Error("Daily snapshot moved outside its managed backup directory.");
    }
    validateSnapshot(target, options.migrationsFolder);
    fs.unlinkSync(path.join(target, "manifest.json"));
    fs.unlinkSync(path.join(target, "database.sqlite"));
    fs.rmdirSync(target);
  }
}

// The managed launcher owns one scheduler and the database runtime lease.
export function createDailyBackupScheduler(options: Options, clock: () => Date = () => new Date(), reporting?: {
  publish: (status: SchedulerStatus, stopped: boolean) => void;
  history: Pick<SchedulerStatus, "lastSuccess" | "lastFailure">;
}) {
  let active: Promise<void> | undefined;
  let stopped = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  let nextRun = 0;
  let lastSuccess: DailySnapshot | null = reporting?.history.lastSuccess ?? null;
  let lastFailure: Failure | null = reporting?.history.lastFailure ?? null;
  let lastCheck: SchedulerStatus["lastCheck"] = "pending";
  function status(): SchedulerStatus {
    return { running: active !== undefined, lastCheck, lastSuccess: lastSuccess && { ...lastSuccess },
      lastFailure: lastFailure && { ...lastFailure }, nextRun: nextRun ? new Date(nextRun).toISOString() : null };
  }
  function publish() { reporting?.publish(status(), stopped); }

  async function run(now: Date) {
    let lease: ReturnType<typeof acquireLease> | undefined;
    try {
      lease = acquireLease(options.filename, "operations");
      fs.mkdirSync(options.backupDirectory, { recursive: true, mode: 0o700 });
      const managed = { ...options, filename: lease.database };
      let snapshots = dailySnapshots(managed);
      const today = now.toISOString().slice(0, 10);
      if (!snapshots.some((snapshot) => snapshot.createdAt.slice(0, 10) === today)) {
        const directory = await createSnapshotUnderLease(managed, "daily", now);
        snapshots = [{ directory: fs.realpathSync(directory), createdAt: now.toISOString() }, ...snapshots]
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      }
      lastSuccess = snapshots[0] ?? null;
      pruneDailySnapshots(managed, snapshots);
      nextRun = Date.parse(`${today}T00:00:00.000Z`) + day;
      lastCheck = "succeeded";
    } catch (error) {
      lastFailure = { at: now.toISOString(), message: error instanceof Error ? error.message : "Daily backup failed." };
      nextRun = now.getTime() + retryDelay;
      lastCheck = "failed";
      console.error(JSON.stringify({ event: "daily-backup-failed", ...lastFailure }));
    } finally { lease?.release(); }
  }

  function tick() {
    const now = clock();
    if (stopped || active || now.getTime() < nextRun) { publish(); return active ?? Promise.resolve(); }
    active = run(now).finally(() => { active = undefined; publish(); });
    publish();
    return active;
  }

  return {
    tick,
    async start() {
      if (stopped) throw new Error("A stopped backup scheduler cannot restart.");
      await tick();
      if (stopped) return;
      timer ??= setInterval(() => { void tick(); }, 60_000);
      timer.unref();
    },
    async stop() { stopped = true; clearInterval(timer); await active; publish(); },
    getStatus: status,
  };
}
