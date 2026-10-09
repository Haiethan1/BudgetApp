import { createRequire } from "node:module";
import { runManagedServer } from "../src/operations/server";

async function main() {
  const [mode, ...args] = process.argv.slice(2);
  if (mode !== "dev" && mode !== "start") throw new Error("Choose dev or start.");
  const require = createRequire(import.meta.url);
  await runManagedServer([require.resolve("next/dist/bin/next"), mode, ...args]);
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : "Startup failed."); process.exitCode = 1; });
