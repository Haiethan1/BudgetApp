import { z } from "zod";

const timestamp = z.iso.datetime();
export const backupStatusSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("unavailable") }),
  z.object({ kind: z.literal("available"), running: z.boolean(), lastCheck: z.enum(["pending", "succeeded", "failed"]), checkedAt: timestamp,
    lastSuccess: timestamp.nullable(), lastFailure: timestamp.nullable(), nextRun: timestamp.nullable() }),
]);
export type BackupStatus = z.infer<typeof backupStatusSchema>;
