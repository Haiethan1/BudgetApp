import path from "node:path";
import { defaultDatabaseUrl } from "../src/db/client";
import { createSnapshot, exportSnapshot, restoreSnapshot, validateSnapshot } from "../src/operations/snapshots";

async function main() {
  const [command, source, destination] = process.argv.slice(2);
  const options = { filename: process.env.DATABASE_URL ?? defaultDatabaseUrl,
    backupDirectory: process.env.BACKUP_DIR ?? path.join(process.cwd(), "backups") };
  switch (command) {
    case "create": console.log(await createSnapshot(options)); break;
    case "validate": if (!source) throw new Error("Supply a snapshot directory."); validateSnapshot(source); console.log("Snapshot is valid."); break;
    case "export": if (!source || !destination) throw new Error("Supply source snapshot and new export directory."); console.log(exportSnapshot(source, destination)); break;
    case "restore": if (!source) throw new Error("Supply a snapshot directory."); console.log(JSON.stringify(await restoreSnapshot(source, options))); break;
    default: throw new Error("Usage: backup <create|validate SNAPSHOT|export SNAPSHOT DESTINATION|restore SNAPSHOT>");
  }
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : "Backup operation failed."); process.exitCode = 1; });
