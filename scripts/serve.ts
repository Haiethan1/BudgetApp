import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { startDatabase } from "../src/operations/startup";

async function main() {
  const [mode, ...args] = process.argv.slice(2);
  if (mode !== "dev" && mode !== "start") throw new Error("Choose dev or start.");
  const lease = await startDatabase();
  const require = createRequire(import.meta.url);
  const child = spawn(process.execPath, [require.resolve("next/dist/bin/next"), mode, ...args], { stdio: "inherit", env: process.env });
  process.once("exit", () => lease.release());
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => child.kill(signal));
  child.once("error", () => { lease.release(); process.exitCode = 1; });
  child.once("exit", (code) => { lease.release(); process.exitCode = code ?? 1; });
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : "Startup failed."); process.exitCode = 1; });
