import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { z } from "zod";

export function databasePath(filename: string) {
  if (filename === ":memory:") throw new Error("Host operations require a persistent database path.");
  const absolute = path.resolve(filename);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  return fs.existsSync(absolute) ? fs.realpathSync(absolute) : path.join(fs.realpathSync(path.dirname(absolute)), path.basename(absolute));
}

function busy(error: unknown) {
  return error instanceof Database.SqliteError && (error.code === "SQLITE_BUSY" || error.code === "SQLITE_LOCKED");
}

function lockConnection(filename: string) {
  if (fs.existsSync(filename) && fs.statSync(filename).isDirectory()) {
    throw new Error(`Legacy database lease directory exists at ${filename}. Stop all app and database-operation processes, then remove only its owner.json and empty directory before upgrading.`);
  }
  const connection = new Database(filename, { timeout: 0 });
  try { fs.chmodSync(filename, 0o600); }
  catch (error) { connection.close(); throw error; }
  return connection;
}

export function acquireLease(filename: string, kind: "runtime" | "operations") {
  const database = databasePath(filename);
  const token = randomUUID();
  let claim: Database.Database | undefined;
  let connection: Database.Database | undefined;
  try {
    // Serialize the exclusive probe and conversion to a shared runtime lock.
    if (kind === "runtime") {
      claim = lockConnection(`${database}.runtime-claim`);
      claim.exec("BEGIN EXCLUSIVE");
    }
    connection = lockConnection(`${database}.${kind}-lock`);
    connection.exec("BEGIN EXCLUSIVE");
    if (kind === "runtime") {
      connection.exec("CREATE TABLE IF NOT EXISTS owner (token TEXT NOT NULL)");
      connection.prepare("DELETE FROM owner").run();
      connection.prepare("INSERT INTO owner VALUES (?)").run(token);
      connection.exec("COMMIT; BEGIN");
      connection.prepare("SELECT token FROM owner").get();
    }
    const held = connection;
    let released = false;
    return { database, token, release() {
      if (!released) { held.close(); released = true; }
    } };
  } catch (error) {
    connection?.close();
    if (busy(error)) throw new Error(`Database ${kind} lease exists. Stop the app or wait for the operation to finish.`, { cause: error });
    throw error;
  } finally { claim?.close(); }
}

export function runtimeLeaseIsActive(database: string, token: string) {
  const connection = new Database(`${database}.runtime-lock`, { timeout: 0, fileMustExist: true });
  try {
    // A retained file and owner token alone do not prove a live runtime.
    try { connection.exec("BEGIN EXCLUSIVE"); return false; }
    catch (error) { if (!busy(error)) throw error; }
    const owner = z.object({ token: z.string() }).parse(connection.prepare("SELECT token FROM owner").get());
    return owner.token === token;
  } finally { connection.close(); }
}
