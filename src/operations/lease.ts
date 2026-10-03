import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";

export function databasePath(filename: string) {
  if (filename === ":memory:") throw new Error("Host operations require a persistent database path.");
  const absolute = path.resolve(filename);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  return fs.existsSync(absolute) ? fs.realpathSync(absolute) : path.join(fs.realpathSync(path.dirname(absolute)), path.basename(absolute));
}

export function acquireLease(filename: string, kind: "runtime" | "operations") {
  const database = databasePath(filename);
  const directory = `${database}.${kind}-lock`;
  try { fs.mkdirSync(directory, { mode: 0o700 }); }
  catch { throw new Error(`Database ${kind} lease exists. Stop the app or wait for the operation to finish. Stale leases require verified offline operator recovery.`); }
  const token = randomUUID();
  const owner = path.join(directory, "owner.json");
  try { fs.writeFileSync(owner, JSON.stringify({ token, pid: process.pid, startedAt: new Date().toISOString(), kind }), { mode: 0o600, flag: "wx" }); }
  catch (error) { fs.rmdirSync(directory); throw error; }
  let released = false;
  return { database, release() {
    if (released) return;
    // This process owns this exact directory; never clear another process's lease.
    if (z.object({ token: z.string() }).parse(JSON.parse(fs.readFileSync(owner, "utf8"))).token !== token) {
      throw new Error("Database lease ownership changed; refusing to release it.");
    }
    fs.unlinkSync(owner);
    fs.rmdirSync(directory);
    released = true;
  } };
}
