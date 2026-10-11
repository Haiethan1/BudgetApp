import Database from "better-sqlite3";

// Preloads also run in Next's development workers. Each database user keeps a
// shared lock, including when its launcher dies before it does.
const { HOMEBOOKS_RUNTIME_DATABASE: filename, HOMEBOOKS_RUNTIME_TOKEN: token } = process.env;
if (!filename || !token) throw new Error("Managed server runtime lease is missing.");
export const runtimeLease = new Database(`${filename}.runtime-lock`, { timeout: 0, fileMustExist: true });
try {
  runtimeLease.exec("BEGIN");
  const owner = runtimeLease.prepare("SELECT token FROM owner").get();
  if (owner?.token !== token) throw new Error("Database runtime lease ownership changed before the server started.");
} catch (error) { runtimeLease.close(); throw error; }
// Keep the connection reachable even when the preload's module namespace is
// discarded. Closing on ordinary exit is optional for OS lock recovery.
process.once("exit", () => runtimeLease.close());
