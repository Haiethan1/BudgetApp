import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { defaultDatabaseUrl } from "../db/client";
import type { SchedulerStatus } from "./scheduler";
import { validateSnapshot } from "./snapshots";
import type { BackupStatus } from "./status-input";

const storedSchema = z.object({ version: z.literal(1), token: z.string(), stopped: z.boolean(),
  checkedAt: z.iso.datetime(), running: z.boolean(), lastCheck: z.enum(["pending", "succeeded", "failed"]), nextRun: z.iso.datetime().nullable(),
  lastSuccess: z.object({ directory: z.string(), createdAt: z.iso.datetime() }).nullable(),
  lastFailure: z.object({ at: z.iso.datetime() }).nullable() });
function stored(filename: string) {
  return storedSchema.parse(JSON.parse(fs.readFileSync(`${filename}.backup-status.json`, "utf8")));
}
function validatedSuccess(success: z.infer<typeof storedSchema>["lastSuccess"], migrationsFolder?: string) {
  if (!success) return null;
  try {
    const { manifest } = validateSnapshot(success.directory, migrationsFolder);
    return manifest.reason === "daily" && manifest.createdAt === success.createdAt ? success : null;
  } catch { return null; }
}
export function backupStatusReporter(filename: string, token: string, migrationsFolder?: string) {
  let history: Pick<SchedulerStatus, "lastSuccess" | "lastFailure"> = { lastSuccess: null, lastFailure: null };
  try {
    const previous = stored(filename);
    history = { lastSuccess: validatedSuccess(previous.lastSuccess, migrationsFolder),
      lastFailure: previous.lastFailure && { ...previous.lastFailure, message: "Previous backup failed. See host logs." } };
  } catch { /* First startup or an unreadable status has no trusted history. */ }
  return { history, publish(status: SchedulerStatus, stopped: boolean) {
    const temporary = `${filename}.backup-status.${token}.tmp`;
    try {
      fs.writeFileSync(temporary, JSON.stringify({ version: 1, token, stopped, checkedAt: new Date().toISOString(),
        ...status, lastFailure: status.lastFailure && { at: status.lastFailure.at } }), { mode: 0o600 });
      fs.renameSync(temporary, `${filename}.backup-status.json`);
    } catch (error) {
      console.error(JSON.stringify({ event: "backup-status-write-failed", message: error instanceof Error ? error.message : "Status unavailable." }));
      try { fs.unlinkSync(temporary); } catch { /* The write may not have created a file. */ }
    }
  } };
}
export function readBackupStatus(filename = process.env.DATABASE_URL ?? defaultDatabaseUrl, now = new Date()): BackupStatus {
  try {
    const database = fs.realpathSync(path.resolve(filename));
    const value = stored(database);
    const owner = z.object({ token: z.string() }).parse(JSON.parse(fs.readFileSync(`${database}.runtime-lock/owner.json`, "utf8")));
    const age = now.getTime() - Date.parse(value.checkedAt);
    if (owner.token !== value.token || value.stopped || age < 0 || age > 120_000) return { kind: "unavailable" };
    return { kind: "available", running: value.running, lastCheck: value.lastCheck, checkedAt: value.checkedAt,
      lastSuccess: validatedSuccess(value.lastSuccess)?.createdAt ?? null,
      lastFailure: value.lastFailure?.at ?? null, nextRun: value.nextRun };
  } catch { return { kind: "unavailable" }; }
}
