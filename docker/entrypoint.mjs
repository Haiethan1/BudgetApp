import Database from "better-sqlite3";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { drizzle } from "drizzle-orm/better-sqlite3";

const sqlite = new Database(process.env.DATABASE_URL ?? "/data/homebooks.sqlite");
sqlite.pragma("foreign_keys = ON");
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("busy_timeout = 5000");

try {
  migrate(drizzle(sqlite), { migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)) });
  console.log("Database migrations are up to date.");
} finally {
  sqlite.close();
}

await import("../server.js");
