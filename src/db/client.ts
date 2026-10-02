import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

import * as schema from "./schema";
import "../config/environment";

export const defaultDatabaseUrl = "./data/homebooks.sqlite";

export function openDatabase(filename = process.env.DATABASE_URL ?? defaultDatabaseUrl) {
  if (filename !== ":memory:") {
    fs.mkdirSync(path.dirname(path.resolve(filename)), { recursive: true });
  }

  const sqlite = new Database(filename);
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("busy_timeout = 5000");
  sqlite.pragma("synchronous = NORMAL");

  return { sqlite, db: drizzle(sqlite, { schema }) };
}

type DatabaseConnection = ReturnType<typeof openDatabase>;

const globalDatabase = globalThis as typeof globalThis & {
  homebooksDatabase?: DatabaseConnection;
};

export function getDatabase() {
  globalDatabase.homebooksDatabase ??= openDatabase();
  return globalDatabase.homebooksDatabase;
}
