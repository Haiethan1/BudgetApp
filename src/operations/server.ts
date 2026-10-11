import { spawn } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { startManagedDatabase } from "./startup";

// Keep scheduler work alive while Next performs its own graceful HTTP shutdown.
export async function runManagedServer(args: string[]) {
  let runtime: Awaited<ReturnType<typeof startManagedDatabase>> | undefined;
  let child: ReturnType<typeof spawn> | undefined;
  let signal: "SIGINT" | "SIGTERM" | undefined;
  let draining: Promise<void> | undefined;
  function terminate(received: "SIGINT" | "SIGTERM") {
    signal ??= received;
    if (runtime && !draining) {
      const scheduler = runtime.scheduler;
      draining = scheduler.stop().then(() => { child?.kill(signal); });
    }
  }
  const interrupt = () => terminate("SIGINT");
  const terminateSignal = () => terminate("SIGTERM");
  // Install before migrations and startup catch-up can acquire operations leases.
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", terminateSignal);
  try {
    runtime = await startManagedDatabase();
    if (signal) {
      process.exitCode = signal === "SIGINT" ? 130 : 143;
      return;
    }
    child = spawn(process.execPath, ["--import", pathToFileURL(path.resolve("docker/runtime-lock.mjs")).href, ...args], {
      stdio: "inherit", env: { ...process.env, HOMEBOOKS_RUNTIME_DATABASE: runtime.database, HOMEBOOKS_RUNTIME_TOKEN: runtime.token },
    });
    const server = child;
    process.exitCode = await new Promise<number>((resolve, reject) => {
      server.once("error", reject);
      server.once("exit", (code, received) => resolve(code ?? (received === "SIGINT" ? 130 : 143)));
    });
  } finally {
    await draining;
    await runtime?.stop();
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", terminateSignal);
  }
}
