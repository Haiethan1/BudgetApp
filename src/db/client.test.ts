import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { openDatabase } from "./client";
import { migrateDatabase } from "./migrate";
import { foundationRecords } from "./schema";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

describe("SQLite foundation", () => {
  it("loads .env.local for the migration CLI like the development server", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "homebooks env "));
    temporaryDirectories.push(directory);
    const filename = path.join(directory, "from-env.sqlite");
    fs.writeFileSync(path.join(directory, ".env.local"), "DATABASE_URL=./from-env.sqlite\n");
    fs.cpSync(path.join(process.cwd(), "drizzle"), path.join(directory, "drizzle"), { recursive: true });
    const environment: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: "development" };
    delete environment.DATABASE_URL;
    const require = createRequire(import.meta.url);
    const result = spawnSync(process.execPath, ["--import", pathToFileURL(require.resolve("tsx")).href,
      path.join(process.cwd(), "src/db/migrate.ts")], { cwd: directory, env: environment, encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
    expect(fs.existsSync(filename)).toBe(true);
  });
  it("runs the migration CLI as a real process with a path containing spaces", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "homebooks CLI "));
    temporaryDirectories.push(directory);
    const filename = path.join(directory, "cli.sqlite");
    const result = spawnSync(process.execPath, ["--import", "tsx", "src/db/migrate.ts"], {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: filename },
      encoding: "utf8",
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("Database migrations are up to date.");
    const connection = openDatabase(filename);
    expect(connection.sqlite.prepare("SELECT name FROM sqlite_master WHERE name='foundation_records'").get())
      .toEqual({ name: "foundation_records" });
    connection.sqlite.close();
  });
  it("enables foreign keys, WAL, and a busy timeout", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "homebooks-"));
    temporaryDirectories.push(directory);
    const connection = openDatabase(path.join(directory, "settings.sqlite"));

    expect(connection.sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(connection.sqlite.pragma("journal_mode", { simple: true })).toBe("wal");
    expect(connection.sqlite.pragma("busy_timeout", { simple: true })).toBe(5000);
    connection.sqlite.close();
  });

  it("applies migrations safely and preserves a record after reopening", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "homebooks-"));
    temporaryDirectories.push(directory);
    const filename = path.join(directory, "persistent.sqlite");

    migrateDatabase(filename);
    migrateDatabase(filename);

    const first = openDatabase(filename);
    first.db.insert(foundationRecords).values({ key: "restart", value: "retained" }).run();
    first.sqlite.close();

    const restarted = openDatabase(filename);
    const record = restarted.db
      .select()
      .from(foundationRecords)
      .where(eq(foundationRecords.key, "restart"))
      .get();
    expect(record?.value).toBe("retained");
    restarted.sqlite.close();
  });
});
