import path from "node:path";
import { pathToFileURL } from "node:url";

import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { openDatabase } from "./client";

export function migrateDatabase(
  filename = process.env.DATABASE_URL,
  migrationsFolder = path.join(process.cwd(), "drizzle"),
) {
  const connection = openDatabase(filename);
  try {
    migrate(connection.db, { migrationsFolder });
  } finally {
    connection.sqlite.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  import("../operations/startup").then(async ({ startDatabase }) => {
    const lease = await startDatabase();
    lease.release();
    console.log("Database migrations are up to date.");
  }).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Migration failed.");
    process.exitCode = 1;
  });
}
