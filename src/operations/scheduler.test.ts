import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openDatabase } from "../db/client";
import { migrateDatabase } from "../db/migrate";
import { acquireLease } from "./lease";
import { createSnapshot, createSnapshotUnderLease, validateSnapshot } from "./snapshots";
import { createDailyBackupScheduler } from "./scheduler";
import { startManagedDatabase } from "./startup";

const directories: string[] = [];
const schedulers: ReturnType<typeof createDailyBackupScheduler>[] = [];
afterEach(async () => {
  for (const scheduler of schedulers.splice(0)) await scheduler.stop();
  vi.restoreAllMocks();
  for (const directory of directories.splice(0)) {
    if (path.dirname(path.resolve(directory)) !== fs.realpathSync(os.tmpdir()) || !path.basename(directory).startsWith("homebooks-scheduler-")) {
      throw new Error("Unexpected test cleanup directory.");
    }
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
function fixture() {
  const directory = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "homebooks-scheduler-"));
  directories.push(directory);
  const filename = path.join(directory, "source.sqlite");
  migrateDatabase(filename);
  return { filename, backupDirectory: path.join(directory, "backups"), directory };
}
function schedulerFor(options: ReturnType<typeof fixture>, clock: () => Date) {
  const scheduler = createDailyBackupScheduler(options, clock); schedulers.push(scheduler); return scheduler;
}
function daily(options: ReturnType<typeof fixture>) {
  return fs.readdirSync(options.backupDirectory).filter((name) => name.startsWith("daily-"));
}

describe("daily backup lifecycle", () => {
  it("catches up once on startup, persists success in its bundle, and uses UTC midnight", async () => {
    const options = fixture(); let now = new Date("2026-10-08T23:59:59Z");
    const scheduler = schedulerFor(options, () => now);
    await scheduler.start();
    expect(daily(options)).toHaveLength(1);
    expect(scheduler.getStatus()).toMatchObject({ running: false, lastFailure: null, nextRun: "2026-10-09T00:00:00.000Z" });
    await scheduler.tick(); expect(daily(options)).toHaveLength(1);
    await scheduler.stop();
    const restarted = schedulerFor(options, () => now); await restarted.tick();
    expect(daily(options)).toHaveLength(1);
    now = new Date("2026-10-11T00:00:00Z"); await restarted.tick();
    expect(daily(options)).toHaveLength(2);
    expect(restarted.getStatus().lastSuccess?.createdAt).toBe("2026-10-11T00:00:00.000Z");
  });

  it("serializes simultaneous triggers and waits for the active backup on stop", async () => {
    const options = fixture(); const scheduler = schedulerFor(options, () => new Date("2026-10-08T12:00:00Z"));
    const first = scheduler.tick(); const second = scheduler.tick();
    expect(first).toBe(second);
    const stopped = scheduler.stop(); await stopped;
    expect(daily(options)).toHaveLength(1);
    expect(fs.existsSync(`${options.filename}.operations-lock`)).toBe(false);
    await scheduler.tick(); expect(daily(options)).toHaveLength(1);
  });

  it("reports lease and storage failures without stopping the app and retries after five minutes", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const options = fixture(); let now = new Date("2026-10-08T12:00:00Z");
    const scheduler = schedulerFor(options, () => now);
    const lease = acquireLease(options.filename, "operations");
    await scheduler.tick(); lease.release();
    expect(scheduler.getStatus()).toMatchObject({ lastSuccess: null, nextRun: "2026-10-08T12:05:00.000Z" });
    expect(scheduler.getStatus().lastFailure?.message).toContain("operations lease exists");
    await scheduler.tick(); expect(fs.existsSync(options.backupDirectory)).toBe(false);
    fs.writeFileSync(options.backupDirectory, "blocked path");
    now = new Date("2026-10-08T12:05:00Z"); await scheduler.tick();
    expect(scheduler.getStatus().lastSuccess).toBeNull();
    fs.unlinkSync(options.backupDirectory);
    now = new Date("2026-10-08T12:10:00Z"); await scheduler.tick();
    expect(daily(options)).toHaveLength(1);
    expect(scheduler.getStatus().lastSuccess?.createdAt).toBe("2026-10-08T12:10:00.000Z");
    expect(log).toHaveBeenCalledTimes(2);
  });

  it("keeps 14 successful dailies and preserves manual, upgrade, restore, invalid and unrelated paths", async () => {
    const options = fixture(); let now = new Date("2026-10-01T00:00:00Z");
    const manual = await createSnapshot(options);
    const lease = acquireLease(options.filename, "operations");
    let upgrade: string; let restore: string;
    try {
      upgrade = await createSnapshotUnderLease(options, "pre-upgrade");
      restore = await createSnapshotUnderLease(options, "pre-restore");
    } finally { lease.release(); }
    const invalid = path.join(options.backupDirectory, "daily-2026-09-01T00-00-00-000Z-00000000-0000-0000-0000-000000000000");
    fs.mkdirSync(invalid); fs.writeFileSync(path.join(invalid, "manifest.json"), "broken");
    const unrelated = path.join(options.backupDirectory, "family-notes"); fs.mkdirSync(unrelated);
    fs.writeFileSync(path.join(unrelated, "keep.txt"), "keep");
    const external = path.join(options.directory, "external"); fs.mkdirSync(external);
    fs.writeFileSync(path.join(external, "keep.txt"), "keep");
    const junction = path.join(options.backupDirectory, "daily-2026-08-01T00-00-00-000Z-00000000-0000-0000-0000-000000000000");
    fs.symlinkSync(external, junction, "junction");
    const scheduler = schedulerFor(options, () => now);
    for (let date = 1; date <= 14; date++) {
      now = new Date(`2026-10-${String(date).padStart(2, "0")}T00:00:00Z`); await scheduler.tick();
    }
    const unlink = fs.unlinkSync;
    const refusal = vi.spyOn(fs, "unlinkSync").mockImplementation((filename) => {
      if (String(filename).includes("daily-2026-10-01") && path.basename(String(filename)) === "manifest.json") throw new Error("Retention storage unavailable");
      unlink(filename);
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    now = new Date("2026-10-15T00:00:00Z"); await scheduler.tick();
    expect(scheduler.getStatus().lastFailure?.message).toBe("Retention storage unavailable");
    expect(scheduler.getStatus().lastCheck).toBe("failed");
    expect(daily(options).filter((name) => fs.existsSync(path.join(options.backupDirectory, name, "database.sqlite")))).toHaveLength(15);
    refusal.mockRestore();
    now = new Date("2026-10-15T00:05:00Z"); await scheduler.tick();
    expect(scheduler.getStatus().lastCheck).toBe("succeeded");
    expect(daily(options).filter((name) => fs.existsSync(path.join(options.backupDirectory, name, "database.sqlite")))).toHaveLength(14);
    expect(fs.readdirSync(options.backupDirectory).some((name) => name.startsWith("daily-2026-10-01"))).toBe(false);
    expect(fs.readdirSync(options.backupDirectory).some((name) => name.startsWith("daily-2026-10-02"))).toBe(true);
    for (const preserved of [manual, upgrade, restore, invalid, unrelated, junction]) expect(fs.existsSync(preserved)).toBe(true);
    expect(fs.readFileSync(path.join(external, "keep.txt"), "utf8")).toBe("keep");
    fs.unlinkSync(junction);
  });

  it("replaces an invalid current-day snapshot on restart without removing the corrupt evidence", async () => {
    const options = fixture(); const now = new Date("2026-10-08T12:00:00Z");
    const first = schedulerFor(options, () => now); await first.tick();
    const corrupt = first.getStatus().lastSuccess?.directory;
    if (!corrupt) throw new Error("First snapshot missing.");
    fs.appendFileSync(path.join(corrupt, "database.sqlite"), "broken checksum");
    await first.stop();
    const restarted = schedulerFor(options, () => now); await restarted.tick();
    expect(daily(options)).toHaveLength(2);
    const replacement = restarted.getStatus().lastSuccess;
    if (!replacement) throw new Error("Replacement snapshot missing.");
    expect(() => validateSnapshot(replacement.directory)).not.toThrow();
    expect(() => validateSnapshot(corrupt)).toThrow("checksum");
  });

  it("takes an integrity-checked daily snapshot while a live WAL writer commits atomically", async () => {
    const options = fixture(); const live = openDatabase(options.filename);
    try {
      live.sqlite.prepare("INSERT INTO foundation_records(key,value,created_at) VALUES('left','before',1),('right','before',1)").run();
      const scheduler = schedulerFor(options, () => new Date("2026-10-08T12:00:00Z"));
      const pending = scheduler.tick();
      live.sqlite.transaction(() => {
        live.sqlite.prepare("UPDATE foundation_records SET value='after' WHERE key IN ('left','right')").run();
      })();
      await pending;
      const success = scheduler.getStatus().lastSuccess;
      if (!success) throw new Error("Daily backup did not succeed.");
      const snapshot = validateSnapshot(success.directory);
      const copied = new Database(snapshot.filename, { readonly: true });
      try {
        const rows = copied.prepare("SELECT value FROM foundation_records WHERE key IN ('left','right') ORDER BY key").all();
        expect([[{ value: "before" }, { value: "before" }], [{ value: "after" }, { value: "after" }]]).toContainEqual(rows);
      } finally { copied.close(); }
    } finally { live.sqlite.close(); }
  });

  it("starts and stops the managed runtime with a reusable validated daily snapshot", async () => {
    const options = fixture();
    const first = await startManagedDatabase(options.filename, options.backupDirectory);
    expect(first.scheduler.getStatus().lastSuccess).not.toBeNull();
    await first.stop();
    const restarted = await startManagedDatabase(options.filename, options.backupDirectory);
    try { expect(daily(options)).toHaveLength(1); }
    finally { await restarted.stop(); }
    expect(fs.existsSync(`${options.filename}.runtime-lock`)).toBe(false);
  });
});
